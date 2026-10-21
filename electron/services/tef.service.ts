import type { ReconciliationResult, ReconciliationRow } from '@shared/api'
import {
  TEF_PROVIDERS,
  paymentReferenceUpdateSchema,
  reconcileSchema,
  reconciliationListSchema,
  tefSettingsSchema,
  type TefSettings
} from '@shared/integrationSchemas'
import type { Db, DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import { getSetting, setSetting } from '../repositories/setting.repository'
import { notFound } from '../utils/errors'
import { requirePermission, type Actor } from './context'
import { fromDateKey } from './product.mappers'
import type { TefProvider } from '../integrations/tef/provider'

export { createTefProviders, type TefProvider } from '../integrations/tef/provider'

const KEY = 'tef'

export async function readTefSettings(db: DbClient): Promise<TefSettings> {
  return tefSettingsSchema.parse(await getSetting<object>(db, KEY, {}))
}

const rowInclude = { sale: { select: { status: true, createdAt: true, user: { select: { name: true } } } } } as const satisfies Prisma.PaymentInclude
type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof rowInclude }>

function toRow(p: PaymentRow): ReconciliationRow {
  return {
    paymentId: p.id,
    saleId: p.saleId,
    createdAt: p.sale.createdAt.toISOString(),
    saleStatus: p.sale.status,
    operatorName: p.sale.user.name,
    method: p.method,
    installments: p.installments,
    amountCents: p.amountCents,
    nsu: p.nsu,
    authorizationCode: p.authorizationCode,
    cardBrand: p.cardBrand,
    reconciledAt: p.reconciledAt?.toISOString() ?? null
  }
}

/**
 * TEF e conciliação: enquanto não houver TEF integrado, os pagamentos em cartão/PIX registrados no
 * PDV são conferidos aqui contra o extrato da maquininha/banco (NSU, autorização e bandeira).
 */
export class TefService {
  constructor(
    private readonly db: Db,
    private readonly providers: Record<string, TefProvider> = {}
  ) {}

  async settings(actorInput: Actor | null): Promise<TefSettings> {
    requirePermission(actorInput, 'tef.manage', 'pdv.sell')
    return readTefSettings(this.db)
  }

  async updateSettings(actorInput: Actor | null, input: unknown): Promise<TefSettings> {
    const actor = requirePermission(actorInput, 'tef.manage')
    const data = tefSettingsSchema.parse(input)
    await setSetting(this.db, KEY, data)
    await writeAudit(this.db, { userId: actor.userId, action: 'settings.tef', details: data })
    return data
  }

  async providerStatus() {
    const cfg = await readTefSettings(this.db)
    return { key: cfg.provider, label: TEF_PROVIDERS[cfg.provider], provider: this.providers[cfg.provider] ?? null }
  }

  async reconciliation(actorInput: Actor | null, input: unknown): Promise<ReconciliationResult> {
    requirePermission(actorInput, 'tef.manage', 'finance.receivables')
    const q = reconciliationListSchema.parse(input)
    const where: Prisma.PaymentWhereInput = {
      method: q.method ? q.method : { in: ['PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'] },
      sale: { createdAt: { gte: fromDateKey(q.from)!, lte: fromDateKey(q.to, true)! } },
      ...(q.status === 'pending' ? { reconciledAt: null } : q.status === 'reconciled' ? { reconciledAt: { not: null } } : {})
    }
    const rows = await this.db.payment.findMany({ where, include: rowInclude, orderBy: { id: 'asc' }, take: 5000 })
    const by = new Map<string, ReconciliationResult['byMethod'][number]>()
    for (const p of rows) {
      // Pagamentos de vendas canceladas foram estornados: aparecem na lista, mas não somam
      if (p.sale.status !== 'COMPLETED') continue
      const b = by.get(p.method) ?? { method: p.method, count: 0, amountCents: 0, reconciledCount: 0, reconciledCents: 0 }
      b.count++
      b.amountCents += p.amountCents
      if (p.reconciledAt) {
        b.reconciledCount++
        b.reconciledCents += p.amountCents
      }
      by.set(p.method, b)
    }
    return { rows: rows.map(toRow), byMethod: [...by.values()] }
  }

  /** NSU, autorização e bandeira digitados a partir do comprovante da maquininha. */
  async updateReference(actorInput: Actor | null, input: unknown): Promise<ReconciliationRow> {
    const actor = requirePermission(actorInput, 'tef.manage', 'finance.receivables')
    const { paymentId, ...data } = paymentReferenceUpdateSchema.parse(input)
    const p = await this.db.payment.findUnique({ where: { id: paymentId } })
    if (!p) throw notFound('Pagamento não encontrado.')
    const updated = await this.db.payment.update({ where: { id: paymentId }, data, include: rowInclude })
    await writeAudit(this.db, { userId: actor.userId, action: 'payment.reference', entity: 'Payment', entityId: paymentId, details: { saleId: p.saleId, ...data } })
    return toRow(updated)
  }

  async reconcile(actorInput: Actor | null, input: unknown): Promise<{ updated: number }> {
    const actor = requirePermission(actorInput, 'tef.manage', 'finance.receivables')
    const { paymentIds, reconciled } = reconcileSchema.parse(input)
    const r = await this.db.payment.updateMany({
      where: { id: { in: paymentIds }, ...(reconciled ? { reconciledAt: null } : { reconciledAt: { not: null } }) },
      data: reconciled ? { reconciledAt: new Date(), reconciledById: actor.userId } : { reconciledAt: null, reconciledById: null }
    })
    await writeAudit(this.db, { userId: actor.userId, action: reconciled ? 'payment.reconcile' : 'payment.unreconcile', details: { paymentIds, updated: r.count } })
    return { updated: r.count }
  }
}
