import type { DbClient } from '../database/connection'

export async function getSetting<T>(db: DbClient, key: string, fallback: T): Promise<T> {
  const row = await db.setting.findUnique({ where: { key } })
  if (!row) return fallback
  try {
    return JSON.parse(row.value) as T
  } catch {
    return fallback
  }
}

export function setSetting(db: DbClient, key: string, value: unknown) {
  const json = JSON.stringify(value)
  return db.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } })
}
