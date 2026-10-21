import type { SessionUser, SetupStatus } from '@shared/api'
import { ROLE_KEYS } from '@shared/permissions'
import { setupSchema } from '@shared/schemas'
import type { Db } from '../database/connection'
import { writeAudit } from '../repositories/audit.repository'
import { createCompany } from '../repositories/company.repository'
import { findRoleByKey } from '../repositories/role.repository'
import { setSetting } from '../repositories/setting.repository'
import { countUsers, createUser, findUserById } from '../repositories/user.repository'
import { conflict } from '../utils/errors'
import { hashPassword } from '../utils/password'
import { toSessionUser } from './auth.service'
import { ensureSystemRoles } from './bootstrap.service'

export const SETTINGS = {
  lowStockAlerts: 'stock.lowStockAlerts',
  allowNegativeStock: 'stock.allowNegative',
  setupCompletedAt: 'setup.completedAt'
} as const

/** Assistente de primeiro acesso: só pode ser concluído enquanto não houver usuários. */
export class SetupService {
  constructor(private readonly db: Db) {}

  async status(): Promise<SetupStatus> {
    return { needsSetup: (await countUsers(this.db)) === 0 }
  }

  async complete(input: unknown): Promise<SessionUser> {
    const data = setupSchema.parse(input)
    if ((await countUsers(this.db)) > 0) throw conflict('O sistema já foi configurado.')
    const passwordHash = await hashPassword(data.admin.password)

    const userId = await this.db.$transaction(async (tx) => {
      // Verificação repetida dentro da transação: evita dois assistentes concluídos ao mesmo tempo.
      if ((await countUsers(tx)) > 0) throw conflict('O sistema já foi configurado.')
      await ensureSystemRoles(tx)
      const adminRole = await findRoleByKey(tx, ROLE_KEYS.ADMIN)
      if (!adminRole) throw new Error('Perfil de administrador ausente')

      const company = await createCompany(tx, data.company)
      const user = await createUser(tx, {
        name: data.admin.name,
        username: data.admin.username,
        passwordHash,
        roleId: adminRole.id,
        maxDiscountBps: 10000,
        mustChangePassword: false
      })
      await setSetting(tx, SETTINGS.lowStockAlerts, data.preferences.lowStockAlerts)
      await setSetting(tx, SETTINGS.allowNegativeStock, data.preferences.allowNegativeStock)
      await setSetting(tx, SETTINGS.setupCompletedAt, new Date().toISOString())
      await writeAudit(tx, {
        userId: user.id,
        action: 'setup.completed',
        entity: 'Company',
        entityId: company.id,
        details: { company: company.legalName, admin: user.username }
      })
      return user.id
    })

    const user = await findUserById(this.db, userId)
    return toSessionUser(user!)
  }
}
