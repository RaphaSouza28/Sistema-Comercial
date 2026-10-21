import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../electron/database'
import { sqliteUrl } from '../../electron/database/connection'
import { BackupService, type SecretStore } from '../../electron/services/backup.service'
import { createTestDatabase, MIGRATIONS_DIR, type TestDatabase } from '../helpers/db'
import { actors } from '../helpers/actors'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})
const rid = () => randomUUID()

function memorySecrets(): SecretStore {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k) ?? null, set: (k, v) => (v === null ? m.delete(k) : m.set(k, v)) }
}

async function scenario(now?: () => Date) {
  t = await createTestDatabase()
  const a = await actors(t.db)
  const backup = new BackupService(t.db, { databasePath: t.databasePath, defaultDir: t.backupsDir, tempDir: path.join(t.dir, 'tmp'), migrationsDir: MIGRATIONS_DIR }, memorySecrets(), now)
  const produto = await a.s.products.create(a.admin, { name: 'Caderno', costCents: 800, salePriceCents: 2000, initialStockMilli: 10000 })
  return { ...a, backup, produto }
}

/** O driver libSQL só libera o arquivo após a coleta de lixo; na vida real a troca ocorre em um novo processo. */
async function restart(): Promise<void> {
  await t.db.$disconnect()
  for (let i = 0; i < 5; i++) {
    globalThis.gc?.()
    await new Promise((r) => setTimeout(r, 50))
  }
  t.db = await initializeDatabase({ databasePath: t.databasePath, migrationsDir: MIGRATIONS_DIR, backupsDir: t.backupsDir })
}

describe('backup', () => {
  it('backup manual consistente, íntegro e com assinatura SHA-256; só com permissão', async () => {
    const { backup, admin, manager } = await scenario()
    await expect(backup.create(manager)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const b = await backup.create(admin)
    expect(b).toMatchObject({ kind: 'MANUAL', status: 'OK', encrypted: false, exists: true })
    expect(b.fileName).toMatch(/^backup-manual-\d{8}-\d{6}\.db$/)
    const copy = createClient({ url: sqliteUrl(b.path) })
    expect((await copy.execute('PRAGMA integrity_check')).rows[0][0]).toBe('ok')
    expect(Number((await copy.execute('SELECT COUNT(*) AS n FROM "Product"')).rows[0].n)).toBe(1)
    copy.close()
    // Dois backups no mesmo segundo não se sobrescrevem
    const [x, y] = await Promise.all([backup.create(admin), backup.create(admin)])
    expect(new Set([b.path, x.path, y.path]).size).toBe(3)
    expect((await backup.verify(admin, { id: b.id })).verifiedAt).not.toBeNull()
    // Arquivo alterado é detectado
    fs.appendFileSync(b.path, 'x')
    await expect(backup.verify(admin, { id: b.id })).rejects.toThrow(/SHA-256/)
    expect((await backup.history(admin)).length).toBe(3)
    expect(await t.db.auditLog.count({ where: { action: 'backup.create' } })).toBe(3)
  })

  it('criptografia AES-256-GCM: arquivo ilegível sem a senha, senha errada recusada', async () => {
    const { backup, admin } = await scenario()
    await expect(backup.updateSettings(admin, { encrypt: true })).rejects.toThrow(/senha do backup/)
    await expect(backup.setPassword(admin, { password: 'curta', passwordConfirm: 'curta' })).rejects.toThrow()
    await backup.setPassword(admin, { password: 'SenhaDoBackup1', passwordConfirm: 'SenhaDoBackup1' })
    expect((await backup.updateSettings(admin, { encrypt: true })).passwordConfigured).toBe(true)
    const b = await backup.create(admin)
    expect(b).toMatchObject({ encrypted: true })
    expect(b.fileName).toMatch(/\.scbak$/)
    const raw = fs.readFileSync(b.path)
    expect(raw.subarray(0, 6).toString()).toBe('SCBAK1')
    expect(raw.includes(Buffer.from('SQLite format 3'))).toBe(false)
    expect(raw.includes(Buffer.from('Caderno'))).toBe(false)
    // Senha guardada no cofre do computador: verificação e leitura funcionam
    await backup.verify(admin, { id: b.id })
    const inspected = await backup.inspectFile(admin, b.path)
    expect(inspected.counts.products).toBe(1)
    // Em outro computador (sem o cofre), a senha é exigida e conferida
    const other = new BackupService(t.db, { databasePath: t.databasePath, defaultDir: t.backupsDir, tempDir: path.join(t.dir, 'tmp2'), migrationsDir: MIGRATIONS_DIR }, memorySecrets())
    await expect(other.inspectFile(admin, b.path)).rejects.toThrow(/criptografado/)
    await expect(other.inspectFile(admin, b.path, 'errada123')).rejects.toThrow(/Senha do backup incorreta/)
    expect((await other.inspectFile(admin, b.path, 'SenhaDoBackup1')).companyName).toBe('Loja Teste LTDA')
  })

  it('automático: respeita o intervalo, registra falha de dispositivo sem repetir a cada minuto e aplica a retenção', async () => {
    let clock = new Date(2026, 9, 20, 8, 0)
    const { backup, admin } = await scenario(() => clock)
    await backup.updateSettings(admin, { automatic: true, intervalHours: 6, retention: 3 })
    const first = await backup.runAutomaticIfDue()
    expect(first).toMatchObject({ kind: 'AUTOMATIC', status: 'OK' })
    clock = new Date(2026, 9, 20, 10, 0)
    expect(await backup.runAutomaticIfDue()).toBeNull() // dentro do intervalo
    for (let h = 14; h <= 32; h += 6) {
      clock = new Date(2026, 9, 20, h, 0)
      expect(await backup.runAutomaticIfDue()).not.toBeNull()
    }
    const autos = (await backup.history(admin)).filter((b) => b.kind === 'AUTOMATIC')
    expect(autos.filter((b) => b.status === 'OK')).toHaveLength(3)
    expect(autos.filter((b) => b.status === 'REMOVED')).toHaveLength(2)
    expect(autos.filter((b) => b.status === 'REMOVED').every((b) => !fs.existsSync(b.path))).toBe(true)

    // Pendrive desconectado: falha registrada, alerta no painel e nova tentativa só depois de 1 hora
    const usb = path.join(t.dir, 'pendrive')
    fs.mkdirSync(usb)
    await backup.updateSettings(admin, { automatic: true, intervalHours: 6, retention: 3, directory: usb })
    fs.rmSync(usb, { recursive: true })
    fs.writeFileSync(usb, 'não é pasta') // destino inválido
    clock = new Date(2026, 9, 21, 20, 0)
    expect(await backup.runAutomaticIfDue()).toBeNull()
    const overview = await backup.overview(admin)
    expect(overview.directoryAvailable).toBe(false)
    expect(overview.lastFailure?.message).toMatch(/Pasta de backup indisponível/)
    clock = new Date(2026, 9, 21, 20, 10)
    await backup.runAutomaticIfDue()
    expect(await t.db.backupRecord.count({ where: { status: 'FAILED' } })).toBe(1)
    await expect(backup.updateSettings(admin, { directory: 'relativo/pasta' })).rejects.toMatchObject({ code: 'VALIDATION' })
  })
})

describe('restauração', () => {
  it('exige senha e confirmação, guarda cópia do banco atual e troca na próxima inicialização', async () => {
    const { s, backup, admin, produto } = await scenario()
    await s.cash.open(admin, { requestId: rid(), openingCents: 0 })
    const b = await backup.create(admin)
    // Depois do backup: uma venda e um cliente novos
    await s.sales.finalize(admin, { requestId: rid(), items: [{ productId: produto.id, quantityMilli: 2000 }], payments: [{ method: 'PIX', amountCents: 4000 }] })
    await s.customers.create(admin, { name: 'Cliente Novo' })

    const inspection = await backup.inspectRecord(admin, { id: b.id })
    expect(inspection).toMatchObject({ counts: { products: 1, sales: 0, customers: 0, users: 3 }, needsUpgrade: false, encrypted: false })
    await expect(backup.restore(admin, { recordId: b.id, userPassword: 'errada', confirmText: 'RESTAURAR' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(backup.restore(admin, { recordId: b.id, userPassword: 'senhaForte1', confirmText: 'sim' })).rejects.toThrow(/RESTAURAR/)
    expect(await t.db.auditLog.count({ where: { action: 'backup.restore.denied' } })).toBe(1)

    expect(await backup.restore(admin, { token: inspection.token, userPassword: 'senhaForte1', confirmText: 'RESTAURAR' })).toEqual({ restarting: true })
    expect((await backup.overview(admin)).restorePending).toBe(true)
    // Até reiniciar, nada muda
    expect(await t.db.sale.count()).toBe(1)

    await restart()
    expect(await t.db.sale.count()).toBe(0)
    expect(await t.db.customer.count()).toBe(0)
    expect((await t.db.product.findFirstOrThrow()).stockMilli).toBe(10000)
    expect(await t.db.auditLog.count({ where: { action: 'backup.restore.applied' } })).toBe(1)
    // A cópia de antes da restauração está no histórico do banco restaurado e contém a venda
    const safety = await t.db.backupRecord.findFirstOrThrow({ where: { kind: 'PRE_RESTORE' } })
    const c = createClient({ url: sqliteUrl(safety.path) })
    expect(Number((await c.execute('SELECT COUNT(*) AS n FROM "Sale"')).rows[0].n)).toBe(1)
    c.close()
    // O banco substituído foi preservado (nunca apagado)
    expect(fs.readdirSync(t.backupsDir).some((f) => /^substituido-\d{8}-\d{6}\.db$/.test(f))).toBe(true)
  })

  it('recusa arquivos de outro sistema e backups de versão mais nova', async () => {
    const { backup, admin } = await scenario()
    const foreign = path.join(t.dir, 'outro.db')
    const c = createClient({ url: sqliteUrl(foreign) })
    await c.execute('CREATE TABLE x (id INTEGER)')
    c.close()
    await expect(backup.inspectFile(admin, foreign)).rejects.toThrow(/não é um backup do Sistema Comercial/)
    fs.writeFileSync(path.join(t.dir, 'texto.db'), 'isto não é um banco')
    await expect(backup.inspectFile(admin, path.join(t.dir, 'texto.db'))).rejects.toThrow(/não é um banco de dados válido/)

    const b = await backup.create(admin)
    const newer = createClient({ url: sqliteUrl(b.path) })
    await newer.execute("INSERT INTO _app_migrations (name, checksum, appliedAt) VALUES ('29991231000000_futuro', 'x', '2999-01-01')")
    newer.close()
    await expect(backup.inspectFile(admin, b.path)).rejects.toThrow(/versão mais nova/)
  })
})
