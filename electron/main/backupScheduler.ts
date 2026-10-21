import type { BackupService } from '../services/backup.service'
import { logger } from '../utils/logger'

const FIRST_CHECK_MS = 2 * 60 * 1000
const CHECK_EVERY_MS = 10 * 60 * 1000

/**
 * Backups automáticos: verifica periodicamente se já passou o intervalo configurado desde o último
 * backup automático. O backup em si é serializado com as demais operações do banco.
 */
export function startBackupScheduler(backup: BackupService): () => void {
  backup.cleanupTemp()
  const run = () =>
    backup.runAutomaticIfDue().then(
      (dto) => dto && logger.info('Backup automático concluído', { path: dto.path }),
      (error) => logger.warn('Backup automático não realizado', { error: error instanceof Error ? error.message : String(error) })
    )
  const first = setTimeout(run, FIRST_CHECK_MS)
  const timer = setInterval(run, CHECK_EVERY_MS)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
  }
}
