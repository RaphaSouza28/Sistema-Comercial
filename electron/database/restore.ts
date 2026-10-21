import fs from 'node:fs'
import path from 'node:path'
import { logger } from '../utils/logger'
import { timestampForFile, verifyDatabaseFile } from './backup'

/**
 * Restauração em duas etapas. O driver do SQLite só libera o arquivo do banco ao encerrar o
 * processo, por isso o backup validado é deixado "pendente" e aplicado na próxima inicialização,
 * antes de qualquer conexão ser aberta. O banco substituído nunca é apagado: é movido para a pasta
 * de backups com o nome "substituido-AAAAMMDD-HHMMSS.db".
 */
export interface PendingRestoreInfo {
  requestedAt: string
  requestedBy: number
  source: string
  checksum: string
  /** Cópia de segurança feita antes da troca: registrada também no histórico do banco restaurado. */
  preRestore: { path: string; sizeBytes: number; checksum: string; encrypted: boolean } | null
}

const pendingFile = (databasePath: string) => `${databasePath}.restaurar`
const markerFile = (databasePath: string) => `${databasePath}.restaurar.json`

export function stagePendingRestore(databasePath: string, validatedFile: string, info: PendingRestoreInfo): void {
  const pending = pendingFile(databasePath)
  fs.rmSync(pending, { force: true })
  fs.copyFileSync(validatedFile, pending)
  // O marcador é gravado por último: sem ele, um arquivo pendente incompleto é ignorado
  fs.writeFileSync(markerFile(databasePath), JSON.stringify(info), 'utf8')
}

/** Apaga se possível; arquivos ainda presos pelo driver são removidos na próxima inicialização. */
function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true })
  } catch {
    // removido por cleanupStaleRestore
  }
}

/** Sobras de uma restauração já aplicada (arquivo pendente sem marcador). */
export function cleanupStaleRestore(databasePath: string): void {
  if (!fs.existsSync(markerFile(databasePath))) removeQuietly(pendingFile(databasePath))
}

export function hasPendingRestore(databasePath: string): boolean {
  return fs.existsSync(markerFile(databasePath))
}

export function cancelPendingRestore(databasePath: string): void {
  fs.rmSync(markerFile(databasePath), { force: true })
  fs.rmSync(pendingFile(databasePath), { force: true })
}

export async function applyPendingRestore(databasePath: string, backupsDir: string): Promise<(PendingRestoreInfo & { replacedPath: string | null }) | null> {
  const marker = markerFile(databasePath)
  const pending = pendingFile(databasePath)
  if (!fs.existsSync(marker)) {
    cleanupStaleRestore(databasePath)
    return null
  }
  const info = JSON.parse(fs.readFileSync(marker, 'utf8')) as PendingRestoreInfo
  if (!fs.existsSync(pending)) {
    logger.warn('Restauração pendente sem arquivo: ignorada', info)
    fs.rmSync(marker, { force: true })
    return null
  }
  try {
    await verifyDatabaseFile(pending)
  } catch (error) {
    logger.error('Arquivo de restauração inválido: banco atual mantido', error)
    fs.renameSync(pending, `${pending}.invalido-${timestampForFile()}`)
    fs.rmSync(marker, { force: true })
    return null
  }

  let replacedPath: string | null = null
  if (fs.existsSync(databasePath)) {
    fs.mkdirSync(backupsDir, { recursive: true })
    replacedPath = path.join(backupsDir, `substituido-${timestampForFile()}.db`)
    // Banco, WAL e SHM são movidos juntos: o conjunto continua consistente
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(databasePath + suffix)) fs.renameSync(databasePath + suffix, replacedPath + suffix)
    }
  }
  // Cópia (não renomeação): a verificação acima mantém o arquivo pendente aberto até a coleta de lixo
  fs.copyFileSync(pending, databasePath)
  fs.rmSync(marker, { force: true })
  removeQuietly(pending)
  logger.info('Backup restaurado', { ...info, replacedPath })
  return { ...info, replacedPath }
}
