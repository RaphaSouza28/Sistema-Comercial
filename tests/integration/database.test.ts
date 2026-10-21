import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeDatabase } from '../../electron/database'
import { snapshotDatabase, verifyDatabaseFile } from '../../electron/database/backup'
import { migrate } from '../../electron/database/migrator'
import { createClient } from '@libsql/client'
import { SingleConnectionClient, sqliteUrl } from '../../electron/database/connection'
import { createServices } from '../../electron/services'
import { createTestDatabase, MIGRATIONS_DIR, setupAdmin, type TestDatabase } from '../helpers/db'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

describe('banco de dados', () => {
  it('aplica migrations, cria perfis do sistema e usa WAL', async () => {
    t = await createTestDatabase()
    const roles = await t.db.role.findMany({ orderBy: { id: 'asc' } })
    expect(roles.map((r) => r.key)).toEqual(['ADMIN', 'MANAGER', 'OPERATOR'])
    const journal = await t.db.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode')
    expect(journal[0].journal_mode).toBe('wal')
  })

  it('não reaplica migrations já aplicadas', async () => {
    t = await createTestDatabase()
    await t.db.$disconnect()
    const again = await migrate(t.databasePath, MIGRATIONS_DIR)
    expect(again.applied).toEqual([])
    expect(again.previouslyApplied).toBeGreaterThan(0)
    t.db = await initializeDatabase({ databasePath: t.databasePath, migrationsDir: MIGRATIONS_DIR, backupsDir: t.backupsDir })
  })

  it('persiste os dados após fechar e reabrir o banco', async () => {
    t = await createTestDatabase()
    await setupAdmin(t.db)
    const db = await t.reopen()
    const services = createServices(db)
    expect(await services.setup.status()).toEqual({ needsSetup: false })
    const user = await services.auth.login({ username: 'admin', password: 'senhaForte1' })
    expect(user.role.key).toBe('ADMIN')
    expect((await db.company.findFirst())?.legalName).toBe('Loja Teste LTDA')
  })

  it('impõe chaves estrangeiras, inclusive dentro de transações', async () => {
    t = await createTestDatabase()
    await expect(
      t.db.user.create({ data: { name: 'X', username: 'x', passwordHash: 'h', roleId: 9999 } })
    ).rejects.toThrow()
    await expect(
      t.db.$transaction((tx) => tx.user.create({ data: { name: 'Y', username: 'y', passwordHash: 'h', roleId: 9999 } }))
    ).rejects.toThrow()
    expect(await t.db.user.count()).toBe(0)
  })

  it('executa transações na mesma conexão (sem abrir conexões extras)', async () => {
    t = await createTestDatabase()
    // Tabelas TEMP existem apenas na conexão que as criou.
    await t.db.$executeRawUnsafe('CREATE TEMP TABLE conexao (id INTEGER)')
    for (let i = 0; i < 5; i++) {
      await t.db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('INSERT INTO conexao (id) VALUES (1)')
        await tx.setting.upsert({ where: { key: 'k' }, create: { key: 'k', value: String(i) }, update: { value: String(i) } })
      })
    }
    await expect(t.db.$transaction(async () => { throw new Error('x') })).rejects.toThrow()
    const rows = await t.db.$queryRawUnsafe<{ n: number | bigint }[]>('SELECT COUNT(*) AS n FROM conexao')
    expect(Number(rows[0].n)).toBe(5)
    expect((await t.db.setting.findUnique({ where: { key: 'k' } }))?.value).toBe('4')
  })

  it('transação encerrada por tempo esgotado não grava nada fora dela', async () => {
    t = await createTestDatabase()
    await expect(
      t.db.$transaction(
        async (tx) => {
          await new Promise((r) => setTimeout(r, 300))
          await tx.setting.create({ data: { key: 'tardio', value: '1' } })
        },
        { timeout: 100 }
      )
    ).rejects.toThrow()
    expect(await t.db.setting.findUnique({ where: { key: 'tardio' } })).toBeNull()
    // a conexão continua utilizável e fora de transação
    await t.db.setting.create({ data: { key: 'depois', value: '1' } })
    expect(await t.db.setting.count({ where: { key: 'depois' } })).toBe(1)
  })

  it('cliente de conexão única recusa comandos após o fim da transação', async () => {
    t = await createTestDatabase()
    const client = new SingleConnectionClient(createClient({ url: sqliteUrl(path.join(t.dir, 'raw.db')) }))
    await client.execute('CREATE TABLE x (a INTEGER)')
    const tx = await client.transaction('write')
    await tx.execute('INSERT INTO x VALUES (1)')
    await tx.rollback()
    await expect(tx.execute('INSERT INTO x VALUES (2)')).rejects.toThrow(/encerrada/)
    const rows = await client.execute('SELECT COUNT(*) AS n FROM x')
    expect(Number(rows.rows[0].n)).toBe(0)
    client.close()
  })

  it('libera o arquivo do banco ao desconectar', async () => {
    t = await createTestDatabase()
    await t.db.$transaction((tx) => tx.setting.create({ data: { key: 'a', value: '1' } }))
    await t.db.$disconnect()
    for (let i = 0; i < 5; i++) {
      ;(globalThis as { gc?: () => void }).gc?.()
      await new Promise((r) => setTimeout(r, 30))
    }
    // No Windows, renomear falha se algum handle do arquivo continuar aberto.
    fs.renameSync(t.databasePath, t.databasePath + '.moved')
    fs.renameSync(t.databasePath + '.moved', t.databasePath)
    t.db = await initializeDatabase({ databasePath: t.databasePath, migrationsDir: MIGRATIONS_DIR, backupsDir: t.backupsDir })
    expect((await t.db.setting.findUnique({ where: { key: 'a' } }))?.value).toBe('1')
  })

  it('desfaz a transação inteira quando uma etapa falha', async () => {
    t = await createTestDatabase()
    await expect(
      t.db.$transaction(async (tx) => {
        await tx.company.create({ data: { legalName: 'Parcial' } })
        throw new Error('falha simulada')
      })
    ).rejects.toThrow('falha simulada')
    expect(await t.db.company.count()).toBe(0)
  })

  it('impede chaves de idempotência duplicadas (proteção contra baixa/finalização duplicada)', async () => {
    t = await createTestDatabase()
    const actor = await setupAdmin(t.db)
    const product = await t.db.product.create({ data: { internalCode: 'P1', name: 'Produto' } })
    const movement = {
      productId: product.id,
      type: 'SALE' as const,
      quantityMilli: -1000,
      balanceAfterMilli: -1000,
      idempotencyKey: 'SALE:1:ITEM:1',
      userId: actor.userId
    }
    await t.db.stockMovement.create({ data: movement })
    await expect(t.db.stockMovement.create({ data: movement })).rejects.toThrow()
    expect(await t.db.stockMovement.count()).toBe(1)
  })

  it('gera snapshot íntegro com VACUUM INTO e faz backup automático antes de nova migration', async () => {
    t = await createTestDatabase()
    await setupAdmin(t.db)

    const snap = await snapshotDatabase((sql) => t.db.$executeRawUnsafe(sql), path.join(t.dir, 'snap.db'))
    expect(snap.sizeBytes).toBeGreaterThan(0)
    expect(snap.checksum).toMatch(/^[0-9a-f]{64}$/)
    await verifyDatabaseFile(snap.path)

    // Simula uma atualização do aplicativo que traz uma migration nova.
    const migrationsCopy = path.join(t.dir, 'migrations')
    fs.cpSync(MIGRATIONS_DIR, migrationsCopy, { recursive: true })
    fs.mkdirSync(path.join(migrationsCopy, '99999999999999_teste'))
    fs.writeFileSync(
      path.join(migrationsCopy, '99999999999999_teste', 'migration.sql'),
      'CREATE TABLE "TesteAtualizacao" ("id" INTEGER NOT NULL PRIMARY KEY);'
    )
    await t.db.$disconnect()
    t.db = await initializeDatabase({ databasePath: t.databasePath, migrationsDir: migrationsCopy, backupsDir: t.backupsDir })

    const backups = fs.readdirSync(t.backupsDir)
    expect(backups.some((f) => f.startsWith('pre-atualizacao-'))).toBe(true)
    const record = await t.db.backupRecord.findFirst({ where: { kind: 'PRE_MIGRATION' } })
    expect(record).not.toBeNull()
    expect(await t.db.user.count()).toBe(1) // dados preservados após a migration
  })

  it('desfaz migration com erro sem aplicar parcialmente', async () => {
    t = await createTestDatabase()
    const migrationsCopy = path.join(t.dir, 'migrations')
    fs.cpSync(MIGRATIONS_DIR, migrationsCopy, { recursive: true })
    fs.mkdirSync(path.join(migrationsCopy, '99999999999999_quebrada'))
    fs.writeFileSync(
      path.join(migrationsCopy, '99999999999999_quebrada', 'migration.sql'),
      'CREATE TABLE "Parcial" ("id" INTEGER PRIMARY KEY);\nCOMANDO INVALIDO;'
    )
    await t.db.$disconnect()
    await expect(migrate(t.databasePath, migrationsCopy)).rejects.toThrow(/99999999999999_quebrada/)
    t.db = await initializeDatabase({ databasePath: t.databasePath, migrationsDir: MIGRATIONS_DIR, backupsDir: t.backupsDir })
    const tables = await t.db.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='Parcial'`
    )
    expect(tables).toHaveLength(0)
  })
})
