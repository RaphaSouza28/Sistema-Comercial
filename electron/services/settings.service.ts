import type { PricingSettings } from '@shared/api'
import { pricingSettingsSchema } from '@shared/catalogSchemas'
import { securitySettingsSchema, type SecuritySettings } from '@shared/backupSchemas'
import type { Db, DbClient } from '../database/connection'
import { writeAudit } from '../repositories/audit.repository'
import { getSetting, setSetting } from '../repositories/setting.repository'
import { requireActor, requirePermission, type Actor } from './context'

const PRICING_KEY = 'pricing'
const SECURITY_KEY = 'security'

export async function readSecuritySettings(db: DbClient): Promise<SecuritySettings> {
  return securitySettingsSchema.parse(await getSetting<object>(db, SECURITY_KEY, {}))
}

export const DEFAULT_PRICING: PricingSettings = {
  minMarginBps: 2000,
  defaultTargetMarginBps: 3000,
  defaultTaxBps: 0,
  defaultCardFeeBps: 0,
  defaultCommissionBps: 0
}

export async function readPricingSettings(db: DbClient): Promise<PricingSettings> {
  const stored = await getSetting<Partial<PricingSettings>>(db, PRICING_KEY, {})
  return { ...DEFAULT_PRICING, ...stored }
}

export class SettingsService {
  constructor(readonly db: Db) {}

  /** Padrões da calculadora e limite de margem: lidos por qualquer usuário autenticado. */
  async pricing(actor: Actor | null): Promise<PricingSettings> {
    requireActor(actor)
    return readPricingSettings(this.db)
  }

  async updatePricing(actorInput: Actor | null, input: unknown): Promise<PricingSettings> {
    const actor = requirePermission(actorInput, 'settings.manage')
    const data = pricingSettingsSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const before = await readPricingSettings(tx)
      await setSetting(tx, PRICING_KEY, data)
      await writeAudit(tx, { userId: actor.userId, action: 'settings.pricing', details: { before, after: data } })
    })
    return data
  }

  async security(actorInput: Actor | null): Promise<SecuritySettings> {
    requirePermission(actorInput, 'settings.manage')
    return readSecuritySettings(this.db)
  }

  async updateSecurity(actorInput: Actor | null, input: unknown): Promise<SecuritySettings> {
    const actor = requirePermission(actorInput, 'settings.manage')
    const data = securitySettingsSchema.parse(input)
    await setSetting(this.db, SECURITY_KEY, data)
    await writeAudit(this.db, { userId: actor.userId, action: 'settings.security', details: data })
    return data
  }
}
