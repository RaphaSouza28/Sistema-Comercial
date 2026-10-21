import type { DbClient } from '../database/connection'

export interface AuditEntry {
  userId?: number | null
  action: string
  entity?: string
  entityId?: string | number
  details?: Record<string, unknown>
}

/** Nunca grave senhas, hashes ou dados completos de cartão em `details`. */
export function writeAudit(db: DbClient, entry: AuditEntry) {
  return db.auditLog.create({
    data: {
      userId: entry.userId ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId !== undefined ? String(entry.entityId) : null,
      details: entry.details ? JSON.stringify(entry.details) : null
    }
  })
}
