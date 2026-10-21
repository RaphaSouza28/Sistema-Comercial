import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { BackupDto, BackupInspection, BackupOverview } from '@shared/api'
import { backupPasswordSchema, backupSettingsSchema, restoreSchema, type BackupSettings } from '@shared/backupSchemas'
import { idSchema } from '@shared/catalogSchemas'
import { decryptFile, encryptFile, isEncryptedBackup, WrongBackupPasswordError } from '../database/backupCrypto'
import { sha256File, snapshotDatabase, timestampForFile } from '../database/backup'
import type { Db } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { readMigrations } from '../database/migrator'
import { hasPendingRestore, stagePendingRestore } from '../database/restore'
import { writeAudit } from '../repositories/audit.repository'
import { getSetting, setSetting } from '../repositories/setting.repository'
import { verifyPassword } from '../utils/password'
import { AppError, conflict, forbidden, notFound, validationError } from '../utils/errors'
import { logger } from '../utils/logger'
import { requirePermission, type Actor } from './context'

/** Armazenamento protegido de segredos (no aplicativo: DPAPI do Windows via safeStorage). */
export interface SecretStore {
  get(name: string): string | null
  set(name: string, value: string | null): void
}

export interface BackupPaths {
  databasePath: string
  defaultDir: string
  /** Pasta de trabalho para arquivos temporários (fica dentro da pasta de dados do usuário). */
  tempDir: string
  migrationsDir: string
}

const KEY = 'backup'
const SECRET = 'backup-password'
const AUTO_RETRY_MINUTES = 60
const INSPECTION_TTL_MS = 15 * 60 * 1000

const include = { user: { select: { name: true } } } as const satisfies Prisma.BackupRecordInclude
type BackupRow = Prisma.BackupRecordGetPayload<{ include: typeof include }>

function toDto(r: BackupRow): BackupDto {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    path: r.path,
    fileName: path.basename(r.path),
    sizeBytes: r.sizeBytes,
    encrypted: r.encrypted,
    verifiedAt: r.verifiedAt?.toISOString() ?? null,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
    userName: r.user?.name ?? null,
    exists: r.status === 'OK' && fs.existsSync(r.path)
  }
}

function freeBytes(dir: string): number | null {
  try {
    const s = fs.statfsSync(dir)
    return s.bavail * s.bsize
  } catch {
    return null
  }
}

function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true })
    fs.accessSync(dir, fs.constants.W_OK)
    return fs.statSync(dir).isDirectory()
  } catch {
    return false
  }
}

/**
 * Backup e restauração: cópia consistente (VACUUM INTO na mesma conexão serializada do sistema,
 * portanto sem escrita em andamento), verificação de integridade e SHA-256, criptografia opcional,
 * agendamento automático com retenção e restauração confirmada com a senha do usuário.
 */
export class BackupService {
  private running: Promise<unknown> | null = null
  private attachLock: Promise<unknown> = Promise.resolve()
  private readonly inspections = new Map<string, { file: string; source: string; expires: number; encrypted: boolean }>()

  constructor(
    private readonly db: Db,
    private readonly paths: BackupPaths,
    private readonly secrets: SecretStore,
    private readonly now: () => Date = () => new Date()
  ) {}

  async readSettings(): Promise<BackupSettings> {
    return backupSettingsSchema.parse(await getSetting<object>(this.db, KEY, {}))
  }

  private directory(settings: BackupSettings): string {
    return settings.directory ?? this.paths.defaultDir
  }

  async overview(actorInput: Actor | null): Promise<BackupOverview> {
    requirePermission(actorInput, 'backup.manage')
    const settings = await this.readSettings()
    const directory = this.directory(settings)
    const available = isWritableDir(directory)
    const [lastSuccess, lastFailure, lastAuto] = await Promise.all([
      this.db.backupRecord.findFirst({ where: { status: { in: ['OK', 'REMOVED'] } }, include, orderBy: { id: 'desc' } }),
      this.db.backupRecord.findFirst({ where: { status: 'FAILED' }, include, orderBy: { id: 'desc' } }),
      this.db.backupRecord.findFirst({ where: { kind: 'AUTOMATIC', status: 'OK' }, orderBy: { id: 'desc' } })
    ])
    return {
      settings,
      defaultDirectory: this.paths.defaultDir,
      directory,
      directoryAvailable: available,
      freeBytes: available ? freeBytes(directory) : null,
      // Banco + WAL (dados ainda não incorporados ao arquivo principal)
      databaseBytes: ['', '-wal'].reduce((a, s) => a + (fs.existsSync(this.paths.databasePath + s) ? fs.statSync(this.paths.databasePath + s).size : 0), 0),
      passwordConfigured: !!this.secrets.get(SECRET),
      lastSuccess: lastSuccess ? toDto(lastSuccess) : null,
      // Só alerta a falha se ela for mais recente que o último backup bem-sucedido
      lastFailure: lastFailure && (!lastSuccess || lastFailure.id > lastSuccess.id) ? toDto(lastFailure) : null,
      nextAutomaticAt: settings.automatic ? new Date((lastAuto?.createdAt ?? this.now()).getTime() + (lastAuto ? settings.intervalHours * 3600_000 : 0)).toISOString() : null,
      restorePending: hasPendingRestore(this.paths.databasePath)
    }
  }

  async history(actorInput: Actor | null): Promise<BackupDto[]> {
    requirePermission(actorInput, 'backup.manage')
    const rows = await this.db.backupRecord.findMany({ include, orderBy: { id: 'desc' }, take: 200 })
    return rows.map(toDto)
  }

  async updateSettings(actorInput: Actor | null, input: unknown): Promise<BackupOverview> {
    const actor = requirePermission(actorInput, 'backup.manage')
    const data = backupSettingsSchema.parse(input)
    if (data.directory && !path.isAbsolute(data.directory)) throw validationError('Escolha uma pasta válida.', { directory: 'Pasta inválida' })
    if (data.directory && !isWritableDir(data.directory)) throw validationError('Não é possível gravar nesta pasta. Verifique se o dispositivo está conectado.', { directory: 'Pasta indisponível' })
    if (data.encrypt && !this.secrets.get(SECRET)) throw validationError('Defina a senha do backup antes de ativar a criptografia.', { encrypt: 'Defina a senha' })
    const before = await this.readSettings()
    await setSetting(this.db, KEY, data)
    await writeAudit(this.db, { userId: actor.userId, action: 'settings.backup', details: { before, after: data } })
    return this.overview(actor)
  }

  async setPassword(actorInput: Actor | null, input: unknown): Promise<void> {
    const actor = requirePermission(actorInput, 'backup.manage')
    const { password } = backupPasswordSchema.parse(input)
    this.secrets.set(SECRET, password)
    // A senha nunca vai para o banco nem para a auditoria
    await writeAudit(this.db, { userId: actor.userId, action: 'backup.password' })
  }

  // ───────────── Criação ─────────────

  /** Um backup por vez: chamadas simultâneas (manual + automático) aguardam a anterior. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.running ?? Promise.resolve()
    const next = prev.catch(() => undefined).then(fn)
    this.running = next.finally(() => {
      if (this.running === next) this.running = null
    })
    return next
  }

  async create(actorInput: Actor | null): Promise<BackupDto> {
    const actor = requirePermission(actorInput, 'backup.manage')
    return this.exclusive(() => this.write('MANUAL', actor.userId))
  }

  /** Executado pelo agendador do aplicativo: faz o backup se estiver na hora. */
  async runAutomaticIfDue(): Promise<BackupDto | null> {
    const settings = await this.readSettings()
    if (!settings.automatic) return null
    const now = this.now().getTime()
    const [lastOk, lastAttempt] = await Promise.all([
      this.db.backupRecord.findFirst({ where: { kind: 'AUTOMATIC', status: { in: ['OK', 'REMOVED'] } }, orderBy: { id: 'desc' } }),
      this.db.backupRecord.findFirst({ where: { kind: 'AUTOMATIC' }, orderBy: { id: 'desc' } })
    ])
    if (lastOk && now - lastOk.createdAt.getTime() < settings.intervalHours * 3600_000) return null
    // Falhou há pouco (ex.: pendrive desconectado): tenta de novo mais tarde, sem encher o histórico
    if (lastAttempt?.status === 'FAILED' && now - lastAttempt.createdAt.getTime() < AUTO_RETRY_MINUTES * 60_000) return null
    return this.exclusive(async () => {
      const dto = await this.write('AUTOMATIC', null).catch(() => null)
      if (dto) await this.applyRetention(settings.retention)
      return dto
    })
  }

  /** Cópia de segurança antes de uma restauração (sempre na pasta padrão, sem depender de pendrive). */
  private preRestore(userId: number): Promise<BackupDto> {
    return this.write('PRE_RESTORE', userId, this.paths.defaultDir)
  }

  private async write(kind: 'MANUAL' | 'AUTOMATIC' | 'PRE_RESTORE', userId: number | null, forceDir?: string): Promise<BackupDto> {
    const settings = await this.readSettings()
    const dir = forceDir ?? this.directory(settings)
    const password = settings.encrypt ? this.secrets.get(SECRET) : null
    const ext = password ? 'scbak' : 'db'
    const base = path.join(dir, `backup-${kind === 'AUTOMATIC' ? 'auto' : kind === 'PRE_RESTORE' ? 'antes-da-restauracao' : 'manual'}-${timestampForFile(this.now())}`)
    let target = `${base}.${ext}`
    for (let n = 2; fs.existsSync(target); n++) target = `${base}-${n}.${ext}`
    const tmp = path.join(this.paths.tempDir, `snapshot-${randomUUID()}.db`)
    const fail = async (message: string): Promise<never> => {
      await this.db.backupRecord.create({ data: { kind, status: 'FAILED', path: target, sizeBytes: 0, checksum: '', userId, message, createdAt: this.now() } })
      await writeAudit(this.db, { userId, action: 'backup.failed', details: { kind, target, message } })
      logger.warn('Backup não realizado', { kind, target, message })
      throw new AppError('CONFLICT', message)
    }
    try {
      if (settings.encrypt && !password) return await fail('Criptografia ativada, mas a senha do backup não está definida neste computador.')
      if (!isWritableDir(dir)) return await fail(`Pasta de backup indisponível: ${dir}. Verifique se o pendrive/HD externo está conectado.`)
      const dbSize = ['', '-wal'].reduce((a, s) => a + (fs.existsSync(this.paths.databasePath + s) ? fs.statSync(this.paths.databasePath + s).size : 0), 0)
      const free = freeBytes(dir)
      if (free !== null && free < dbSize * 2 + 10 * 1024 * 1024) return await fail(`Espaço insuficiente em ${dir}.`)

      fs.mkdirSync(this.paths.tempDir, { recursive: true })
      await snapshotDatabase((sql) => this.db.$executeRawUnsafe(sql), tmp, this.verifyFile)
      if (password) await encryptFile(tmp, target, password)
      else fs.copyFileSync(tmp, target, fs.constants.COPYFILE_EXCL)
      // Confere a cópia gravada no destino (pendrives podem gravar com erro)
      const checksum = await sha256File(target)
      if (!password) await this.verifyFile(target)
      const row = await this.db.backupRecord.create({
        data: { kind, status: 'OK', path: target, sizeBytes: fs.statSync(target).size, checksum, encrypted: !!password, verifiedAt: this.now(), userId, createdAt: this.now() },
        include
      })
      await writeAudit(this.db, { userId, action: 'backup.create', entity: 'BackupRecord', entityId: row.id, details: { kind, path: target, encrypted: !!password } })
      return toDto(row)
    } catch (error) {
      if (error instanceof AppError) throw error
      fs.rmSync(target, { force: true })
      return fail(`Falha ao gravar o backup: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      fs.rmSync(tmp, { force: true })
    }
  }

  /** Mantém os N backups automáticos mais recentes; apaga apenas arquivos criados pelo próprio sistema. */
  private async applyRetention(keep: number): Promise<void> {
    const old = await this.db.backupRecord.findMany({ where: { kind: 'AUTOMATIC', status: 'OK' }, orderBy: { id: 'desc' }, skip: keep })
    for (const r of old) {
      try {
        if (/^backup-auto-\d{8}-\d{6}(-\d+)?\.(db|scbak)$/.test(path.basename(r.path))) fs.rmSync(r.path, { force: true })
        await this.db.backupRecord.update({ where: { id: r.id }, data: { status: 'REMOVED', message: 'Removido pela retenção de backups automáticos.' } })
      } catch (error) {
        logger.warn('Não foi possível remover backup antigo', { path: r.path, error: String(error) })
      }
    }
  }

  // ───────────── Verificação e inspeção ─────────────

  /** Decifra (se preciso) para um arquivo temporário e confere a integridade do SQLite. */
  private async openForReading(file: string, password: string | null): Promise<{ plain: string; encrypted: boolean }> {
    if (!fs.existsSync(file)) throw notFound('Arquivo de backup não encontrado. Verifique se o dispositivo está conectado.')
    fs.mkdirSync(this.paths.tempDir, { recursive: true })
    const plain = path.join(this.paths.tempDir, `leitura-${randomUUID()}.db`)
    const encrypted = isEncryptedBackup(file)
    try {
      if (encrypted) {
        if (!password) throw validationError('Este backup é criptografado. Informe a senha do backup.', { backupPassword: 'Informe a senha' })
        await decryptFile(file, plain, password)
      } else fs.copyFileSync(file, plain)
      await this.verifyFile(plain)
      return { plain, encrypted }
    } catch (error) {
      fs.rmSync(plain, { force: true })
      if (error instanceof WrongBackupPasswordError) throw validationError(error.message, { backupPassword: 'Senha incorreta' })
      throw error
    }
  }

  async verify(actorInput: Actor | null, input: unknown): Promise<BackupDto> {
    const actor = requirePermission(actorInput, 'backup.manage')
    const { id } = idSchema.parse(input)
    const r = await this.db.backupRecord.findUnique({ where: { id } })
    if (!r || r.status !== 'OK') throw notFound('Backup não disponível.')
    if (!fs.existsSync(r.path)) throw notFound('Arquivo de backup não encontrado. Verifique se o dispositivo está conectado.')
    if ((await sha256File(r.path)) !== r.checksum) {
      await writeAudit(this.db, { userId: actor.userId, action: 'backup.verify.failed', entity: 'BackupRecord', entityId: id })
      throw conflict('O arquivo foi alterado ou está corrompido (assinatura SHA-256 diferente da gravada).')
    }
    const { plain } = await this.openForReading(r.path, r.encrypted ? this.secrets.get(SECRET) : null)
    fs.rmSync(plain, { force: true })
    const row = await this.db.backupRecord.update({ where: { id }, data: { verifiedAt: this.now() }, include })
    await writeAudit(this.db, { userId: actor.userId, action: 'backup.verify', entity: 'BackupRecord', entityId: id })
    return toDto(row)
  }

  /** Lê o conteúdo do backup para o usuário conferir antes de restaurar. */
  async inspectFile(actorInput: Actor | null, file: string, backupPassword?: string): Promise<BackupInspection> {
    requirePermission(actorInput, 'backup.manage')
    this.pruneInspections()
    const { plain, encrypted } = await this.openForReading(file, backupPassword || this.secrets.get(SECRET))
    try {
      const summary = await this.summarize(plain)
      const token = randomUUID()
      this.inspections.set(token, { file: plain, source: file, expires: Date.now() + INSPECTION_TTL_MS, encrypted })
      const stat = fs.statSync(file)
      return { token, fileName: path.basename(file), sizeBytes: stat.size, encrypted, modifiedAt: stat.mtime.toISOString(), ...summary }
    } catch (error) {
      fs.rmSync(plain, { force: true })
      throw error
    }
  }

  async inspectRecord(actorInput: Actor | null, input: unknown): Promise<BackupInspection> {
    requirePermission(actorInput, 'backup.manage')
    const { id, backupPassword } = idSchema.extend({ backupPassword: z.string().max(128).optional() }).parse(input)
    const r = await this.db.backupRecord.findUnique({ where: { id } })
    if (!r || r.status !== 'OK') throw notFound('Backup não disponível.')
    return this.inspectFile(actorInput, r.path, backupPassword)
  }

  /**
   * Abre outro arquivo SQLite na própria conexão do sistema (ATTACH) e o libera ao final (DETACH).
   * Conexões separadas do driver libSQL só soltam o arquivo na coleta de lixo — o que impediria
   * apagar temporários e "remover com segurança" o pendrive com o backup.
   */
  private withAttached<T>(file: string, fn: (q: <R>(sql: string) => Promise<R[]>) => Promise<T>): Promise<T> {
    const prev = this.attachLock
    const next = prev
      .catch(() => undefined)
      .then(async () => {
        await this.db.$executeRawUnsafe(`ATTACH DATABASE '${path.resolve(file).replace(/'/g, "''")}' AS conferencia`)
        try {
          return await fn(<R>(sql: string) => this.db.$queryRawUnsafe<R[]>(sql))
        } finally {
          await this.db.$executeRawUnsafe('DETACH DATABASE conferencia')
        }
      })
    this.attachLock = next.catch(() => undefined)
    return next
  }

  /** PRAGMA integrity_check do arquivo, sem prendê-lo. */
  private verifyFile = async (file: string): Promise<void> => {
    let status: string
    try {
      status = await this.withAttached(file, async (q) => String(Object.values((await q<Record<string, unknown>>('PRAGMA conferencia.integrity_check'))[0] ?? {})[0] ?? ''))
    } catch {
      throw conflict('O arquivo não é um banco de dados válido do sistema ou está corrompido.')
    }
    if (status !== 'ok') throw conflict(`Falha na verificação de integridade do backup: ${status}`)
  }

  private summarize(file: string): Promise<Omit<BackupInspection, 'token' | 'fileName' | 'sizeBytes' | 'encrypted' | 'modifiedAt'>> {
    return this.withAttached(file, async (q) => {
      const tables = new Set((await q<{ name: string }>("SELECT name FROM conferencia.sqlite_master WHERE type = 'table'")).map((r) => r.name))
      for (const t of ['_app_migrations', 'User', 'Product', 'Sale', 'Customer', 'Company']) {
        if (!tables.has(t)) throw conflict('O arquivo não é um backup do Sistema Comercial.')
      }
      const applied = (await q<{ name: string }>('SELECT name FROM conferencia._app_migrations ORDER BY name')).map((r) => r.name)
      const known = new Set(readMigrations(this.paths.migrationsDir).map((m) => m.name))
      if (applied.some((m) => !known.has(m))) throw conflict('Este backup é de uma versão mais nova do sistema. Atualize o programa antes de restaurá-lo.')
      const count = async (t: string) => Number((await q<{ n: bigint | number }>(`SELECT COUNT(*) AS n FROM conferencia."${t}"`))[0].n)
      const lastSale = (await q<{ d: unknown }>('SELECT MAX(createdAt) AS d FROM conferencia."Sale"'))[0]?.d
      const company = (await q<{ legalName: string }>('SELECT legalName FROM conferencia."Company" ORDER BY id LIMIT 1'))[0]
      return {
        schemaVersion: applied.at(-1) ?? null,
        needsUpgrade: applied.length < known.size,
        companyName: company?.legalName ?? null,
        counts: { products: await count('Product'), customers: await count('Customer'), sales: await count('Sale'), users: await count('User') },
        lastSaleAt: lastSale === null || lastSale === undefined ? null : new Date(typeof lastSale === 'bigint' ? Number(lastSale) : (lastSale as string | number)).toISOString()
      }
    })
  }

  private pruneInspections(): void {
    for (const [token, i] of this.inspections) {
      if (i.expires < Date.now()) {
        fs.rmSync(i.file, { force: true })
        this.inspections.delete(token)
      }
    }
  }

  // ───────────── Restauração ─────────────

  /**
   * Confirma com a senha do usuário, guarda uma cópia do banco atual e agenda a troca para a próxima
   * inicialização (o aplicativo reinicia em seguida).
   */
  async restore(actorInput: Actor | null, input: unknown): Promise<{ restarting: boolean }> {
    const actor = requirePermission(actorInput, 'backup.manage')
    const data = restoreSchema.parse(input)
    const user = await this.db.user.findUnique({ where: { id: actor.userId } })
    if (!user || !(await verifyPassword(data.userPassword, user.passwordHash))) {
      await writeAudit(this.db, { userId: actor.userId, action: 'backup.restore.denied', details: { reason: 'senha incorreta' } })
      throw forbidden('Senha incorreta. A restauração não foi feita.')
    }
    let token = data.token
    if (data.recordId) token = (await this.inspectRecord(actor, { id: data.recordId, backupPassword: data.backupPassword })).token
    const inspection = token ? this.inspections.get(token) : undefined
    if (!inspection || inspection.expires < Date.now()) throw conflict('A conferência do backup expirou. Selecione o arquivo novamente.')

    return this.exclusive(async () => {
      const safety = await this.preRestore(actor.userId)
      stagePendingRestore(this.paths.databasePath, inspection.file, {
        requestedAt: this.now().toISOString(),
        requestedBy: actor.userId,
        source: inspection.source,
        checksum: await sha256File(inspection.file),
        preRestore: { path: safety.path, sizeBytes: safety.sizeBytes, checksum: (await this.db.backupRecord.findUniqueOrThrow({ where: { id: safety.id } })).checksum, encrypted: safety.encrypted }
      })
      fs.rmSync(inspection.file, { force: true })
      this.inspections.delete(token!)
      await writeAudit(this.db, { userId: actor.userId, action: 'backup.restore.scheduled', details: { source: inspection.source, preRestoreBackupId: safety.id } })
      return { restarting: true }
    })
  }

  async recordPath(actorInput: Actor | null, input: unknown): Promise<string> {
    requirePermission(actorInput, 'backup.manage')
    const { id } = idSchema.parse(input)
    const r = await this.db.backupRecord.findUnique({ where: { id } })
    if (!r || !fs.existsSync(r.path)) throw notFound('Arquivo de backup não encontrado.')
    return r.path
  }

  /** Remove arquivos temporários de leituras anteriores (chamado na inicialização). */
  cleanupTemp(): void {
    try {
      for (const f of fs.readdirSync(this.paths.tempDir)) if (/^(snapshot|leitura)-[0-9a-f-]{36}\.db$/.test(f)) fs.rmSync(path.join(this.paths.tempDir, f), { force: true })
    } catch {
      // pasta ainda não existe
    }
  }
}
