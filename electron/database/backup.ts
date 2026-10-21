import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { sqliteUrl } from './connection'

export interface SnapshotInfo {
  path: string
  sizeBytes: number
  checksum: string
}

/**
 * Cópia consistente do banco usando VACUUM INTO: o SQLite gera um snapshot
 * transacional (inclui o conteúdo do WAL). Nunca copiamos o arquivo .db
 * diretamente enquanto o aplicativo está em uso.
 *
 * `run` executa SQL na conexão desejada — com o Prisma, a chamada passa pelo
 * mesmo mutex das demais operações, então não há escrita em andamento.
 */
export async function snapshotDatabase(
  run: (sql: string) => Promise<unknown>,
  targetPath: string,
  /** Verificação do arquivo gerado (no aplicativo, pela própria conexão, para não prender o arquivo). */
  verify: (file: string) => Promise<void> = verifyDatabaseFile
): Promise<SnapshotInfo> {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  if (fs.existsSync(targetPath)) throw new Error(`Arquivo de destino já existe: ${targetPath}`)
  await run(`VACUUM INTO '${path.resolve(targetPath).replace(/'/g, "''")}'`)
  await verify(targetPath)
  return { path: targetPath, sizeBytes: fs.statSync(targetPath).size, checksum: await sha256File(targetPath) }
}

/** Snapshot com conexão própria (usado antes de abrir o Prisma, ex.: antes de migrations). */
export async function snapshotDatabaseFile(databasePath: string, targetPath: string): Promise<SnapshotInfo> {
  const client = createClient({ url: sqliteUrl(databasePath) })
  try {
    return await snapshotDatabase((sql) => client.execute(sql), targetPath)
  } finally {
    client.close()
  }
}

/** Valida a integridade de um arquivo SQLite (PRAGMA integrity_check). */
export async function verifyDatabaseFile(filePath: string): Promise<void> {
  const client = createClient({ url: sqliteUrl(filePath) })
  try {
    const res = await client.execute('PRAGMA integrity_check')
    const status = String(res.rows[0]?.[0] ?? '')
    if (status !== 'ok') throw new Error(`Falha na verificação de integridade: ${status}`)
  } finally {
    client.close()
  }
}

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export function timestampForFile(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  )
}
