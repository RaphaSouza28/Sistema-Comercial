import fs from 'node:fs'
import path from 'node:path'
import { bootstrapDatabase } from '../services/bootstrap.service'
import { logger } from '../utils/logger'
import { snapshotDatabaseFile, timestampForFile, type SnapshotInfo } from './backup'
import { createPrismaClient, type Db } from './connection'
import { migrate, pendingMigrations } from './migrator'
import { applyPendingRestore } from './restore'
import { writeAudit } from '../repositories/audit.repository'

export interface DatabaseOptions {
  databasePath: string
  migrationsDir: string
  backupsDir: string
}

/**
 * Abre o banco local: aplica uma restauração pendente (agendada pela tela de backup), faz backup de
 * segurança se houver migrations pendentes em um banco já existente, aplica as migrations e
 * sincroniza perfis/permissões.
 */
export async function initializeDatabase(options: DatabaseOptions): Promise<Db> {
  const { databasePath, backupsDir } = options
  const restored = await applyPendingRestore(databasePath, backupsDir)
  try {
    return await openDatabase(options, restored)
  } catch (error) {
    // Restauração aplicada mas o banco não abriu: o anterior continua preservado para recuperação manual
    if (restored?.replacedPath) {
      throw new Error(`${(error as Error).message}\n\nO banco anterior à restauração está preservado em:\n${restored.replacedPath}`)
    }
    throw error
  }
}

async function openDatabase(options: DatabaseOptions, restored: Awaited<ReturnType<typeof applyPendingRestore>>): Promise<Db> {
  const { databasePath, migrationsDir, backupsDir } = options
  let preMigration: SnapshotInfo | null = null

  if (fs.existsSync(databasePath)) {
    const { pending, appliedCount } = await pendingMigrations(databasePath, migrationsDir)
    if (pending.length > 0 && appliedCount > 0) {
      const target = path.join(backupsDir, `pre-atualizacao-${timestampForFile()}.db`)
      preMigration = await snapshotDatabaseFile(databasePath, target)
      logger.info('Backup automático antes da atualização do banco', { path: target })
    }
  }

  const result = await migrate(databasePath, migrationsDir)
  if (result.applied.length) logger.info('Migrations aplicadas', result.applied)
  if (result.checksumMismatches.length) logger.warn('Migrations alteradas após aplicação', result.checksumMismatches)

  const db = createPrismaClient(databasePath)
  await db.$connect()
  await bootstrapDatabase(db)

  if (preMigration) {
    await db.backupRecord.create({
      data: {
        kind: 'PRE_MIGRATION',
        path: preMigration.path,
        sizeBytes: preMigration.sizeBytes,
        checksum: preMigration.checksum
      }
    })
  }
  if (restored) {
    await writeAudit(db, {
      // O backup pode ser anterior ao usuário que pediu a restauração
      userId: (await db.user.findUnique({ where: { id: restored.requestedBy } })) ? restored.requestedBy : null,
      action: 'backup.restore.applied',
      details: { source: restored.source, checksum: restored.checksum, replacedPath: restored.replacedPath, preRestore: restored.preRestore?.path ?? null }
    })
    if (restored.preRestore) {
      await db.backupRecord.create({ data: { kind: 'PRE_RESTORE', ...restored.preRestore, verifiedAt: new Date(), message: 'Cópia do banco substituído na restauração.' } })
    }
  }
  return db
}
