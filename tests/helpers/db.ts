import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Db } from '../../electron/database/connection'
import { initializeDatabase } from '../../electron/database'
import { createServices } from '../../electron/services'
import type { Actor } from '../../electron/services/context'
import type { SetupInput } from '../../shared/schemas'

export const MIGRATIONS_DIR = path.resolve(__dirname, '../../prisma/migrations')

export interface TestDatabase {
  dir: string
  databasePath: string
  backupsDir: string
  db: Db
  reopen(): Promise<Db>
  cleanup(): Promise<void>
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-test-'))
  const databasePath = path.join(dir, 'data', 'test.db')
  const backupsDir = path.join(dir, 'backups')
  const open = () => initializeDatabase({ databasePath, migrationsDir: MIGRATIONS_DIR, backupsDir })
  const state: TestDatabase = {
    dir,
    databasePath,
    backupsDir,
    db: await open(),
    async reopen() {
      await state.db.$disconnect()
      state.db = await open()
      return state.db
    },
    async cleanup() {
      await state.db.$disconnect()
      await removeDir(dir)
    }
  }
  return state
}

export const validSetup = (): SetupInput => ({
  company: { legalName: 'Loja Teste LTDA', tradeName: 'Loja Teste', document: '11.222.333/0001-81' },
  admin: { name: 'Administrador', username: 'Admin', password: 'senhaForte1', passwordConfirm: 'senhaForte1' },
  preferences: { lowStockAlerts: true, allowNegativeStock: false }
})

/** Conclui o assistente e devolve o Actor do administrador. */
export async function setupAdmin(db: Db): Promise<Actor> {
  const services = createServices(db)
  const user = await services.setup.complete(validSetup())
  return (await services.auth.loadActor(user.id)).actor
}

/**
 * O driver libSQL só libera o arquivo quando o GC finaliza os prepared statements
 * (sqlite3_close_v2), e o PrismaClient retém referências após consultas com erro.
 * A remoção do diretório temporário é, portanto, melhor-esforço.
 */
export async function removeDir(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    ;(globalThis as { gc?: () => void }).gc?.()
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      await new Promise((r) => setTimeout(r, 30))
    }
  }
}
