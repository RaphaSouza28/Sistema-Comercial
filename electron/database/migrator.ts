import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient, type Client } from '@libsql/client'
import { sqliteUrl } from './connection'

/**
 * Aplica as migrations SQL geradas pelo Prisma (prisma/migrations/<pasta>/migration.sql).
 *
 * A CLI do Prisma não é distribuída com o aplicativo; por isso as migrations são
 * aplicadas aqui, em ordem, cada uma dentro de uma transação, e registradas na
 * tabela _app_migrations. Migrations já aplicadas nunca são reexecutadas.
 */

export interface MigrationFile {
  name: string
  sql: string
  checksum: string
}

export interface MigrationResult {
  applied: string[]
  /** Quantidade de migrations que já estavam aplicadas antes desta execução. */
  previouslyApplied: number
  checksumMismatches: string[]
}

export function readMigrations(migrationsDir: string): MigrationFile[] {
  if (!fs.existsSync(migrationsDir)) {
    throw new Error(`Diretório de migrations não encontrado: ${migrationsDir}`)
  }
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(migrationsDir, name, 'migration.sql'), 'utf8')
      // Normaliza quebras de linha: o git pode converter LF/CRLF sem alterar o conteúdo.
      const checksum = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex')
      return { name, sql, checksum }
    })
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.execute(`CREATE TABLE IF NOT EXISTS "_app_migrations" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "checksum" TEXT NOT NULL,
    "appliedAt" TEXT NOT NULL
  )`)
}

async function appliedMigrations(client: Client): Promise<Map<string, string>> {
  await ensureMigrationsTable(client)
  const rows = await client.execute('SELECT name, checksum FROM "_app_migrations"')
  return new Map(rows.rows.map((r) => [String(r.name), String(r.checksum)]))
}

/** Lista migrations ainda não aplicadas, sem alterar o banco (além da tabela de controle). */
export async function pendingMigrations(
  databasePath: string,
  migrationsDir: string
): Promise<{ pending: MigrationFile[]; appliedCount: number }> {
  const migrations = readMigrations(migrationsDir)
  if (!fs.existsSync(databasePath)) return { pending: migrations, appliedCount: 0 }
  const client = createClient({ url: sqliteUrl(databasePath) })
  try {
    const applied = await appliedMigrations(client)
    return { pending: migrations.filter((m) => !applied.has(m.name)), appliedCount: applied.size }
  } finally {
    client.close()
  }
}

/**
 * Aplica uma migration seguindo o procedimento do SQLite para alterar tabelas
 * (https://www.sqlite.org/lang_altertable.html#otheralter):
 *
 * O Prisma recria tabelas (CREATE new_X / INSERT / DROP X / RENAME) e conta com
 * `PRAGMA foreign_keys=OFF` — mas esse PRAGMA é ignorado dentro de transação. Com as
 * chaves estrangeiras ativas, o DROP TABLE executaria os ON DELETE CASCADE/SET NULL
 * e apagaria dados das tabelas relacionadas. Por isso as chaves são desligadas antes
 * da transação e a integridade é conferida com foreign_key_check antes do COMMIT.
 */
async function applyMigration(client: Client, migration: MigrationFile): Promise<void> {
  // PRAGMA por conexão: a transação abaixo usa esta mesma conexão.
  await client.execute('PRAGMA foreign_keys = OFF')
  const tx = await client.transaction('write')
  try {
    await tx.executeMultiple(migration.sql)
    const violations = await tx.execute('PRAGMA foreign_key_check')
    if (violations.rows.length > 0) {
      throw new Error(`a migration deixaria ${violations.rows.length} violação(ões) de chave estrangeira`)
    }
    await tx.execute({
      sql: 'INSERT INTO "_app_migrations" ("name", "checksum", "appliedAt") VALUES (?, ?, ?)',
      args: [migration.name, migration.checksum, new Date().toISOString()]
    })
    await tx.commit()
  } catch (error) {
    await tx.rollback().catch(() => undefined)
    throw new Error(`Falha ao aplicar a migration ${migration.name}: ${(error as Error).message}`, { cause: error })
  } finally {
    tx.close()
  }
}

export async function migrate(databasePath: string, migrationsDir: string): Promise<MigrationResult> {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true })
  const migrations = readMigrations(migrationsDir)
  const client = createClient({ url: sqliteUrl(databasePath) })
  try {
    // WAL é persistente no arquivo: melhor concorrência de leitura e durabilidade.
    await client.execute('PRAGMA journal_mode = WAL')
    const applied = await appliedMigrations(client)
    const result: MigrationResult = { applied: [], previouslyApplied: applied.size, checksumMismatches: [] }

    for (const migration of migrations) {
      const known = applied.get(migration.name)
      if (known !== undefined) {
        if (known !== migration.checksum) result.checksumMismatches.push(migration.name)
        continue
      }
      await applyMigration(client, migration)
      result.applied.push(migration.name)
    }

    const fk = await client.execute('PRAGMA foreign_key_check')
    if (fk.rows.length > 0) {
      throw new Error(`Banco de dados com ${fk.rows.length} violação(ões) de chave estrangeira`)
    }
    return result
  } finally {
    client.close()
  }
}
