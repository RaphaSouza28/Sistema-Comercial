import type { CustomerDetail, CustomerDto, CustomerListItem, CustomerListResult, CustomerLite } from '@shared/api'
import { customerListSchema, customerSchema, customerUpdateSchema } from '@shared/commerceSchemas'
import { onlyDigits } from '@shared/documents'
import { customerQuickSchema, customerSearchSchema } from '@shared/salesSchemas'
import { normalizeSearch, searchTextOf } from '@shared/text'
import { idSchema } from '@shared/catalogSchemas'
import type { Db, DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import { conflict, forbidden, notFound } from '../utils/errors'
import { requirePermission, type Actor } from './context'

type CustomerRow = Prisma.CustomerGetPayload<object>

/** Limite de crediário é decisão financeira: exige finance.receivables. */
function assertCreditPermission(actor: Actor, from: number | null, to: number | null) {
  if (from !== to && !actor.permissions.has('finance.receivables')) throw forbidden('Somente quem gerencia Contas a receber pode definir o limite de crediário.')
}

const toLite = (c: { id: number; name: string; document: string | null; phone: string | null }): CustomerLite => ({
  id: c.id,
  name: c.name,
  document: c.document,
  phone: c.phone
})

function toDto(c: CustomerRow): CustomerDto {
  return {
    id: c.id,
    name: c.name,
    document: c.document,
    phone: c.phone,
    email: c.email,
    zipCode: c.zipCode,
    street: c.street,
    number: c.number,
    complement: c.complement,
    district: c.district,
    city: c.city,
    state: c.state,
    notes: c.notes,
    consentAt: c.consentAt?.toISOString() ?? null,
    anonymizedAt: c.anonymizedAt?.toISOString() ?? null,
    creditLimitCents: c.creditLimitCents,
    active: c.active,
    createdAt: c.createdAt.toISOString()
  }
}

export const customerSearchText = (c: { name: string; document: string | null; phone: string | null; email: string | null; city: string | null }) =>
  searchTextOf(c.name, c.document, c.phone, c.email, c.city)

/** Preenche o texto de busca de clientes criados antes do campo existir (executado na inicialização). */
export async function backfillCustomerSearch(db: DbClient): Promise<void> {
  const rows = await db.customer.findMany({ where: { searchText: '' } })
  for (const c of rows) await db.customer.update({ where: { id: c.id }, data: { searchText: customerSearchText(c) } })
}

/**
 * Clientes: cadastro, histórico e LGPD (consentimento, portabilidade e anonimização).
 * Registros de vendas e financeiros nunca são apagados: a exclusão é lógica e a
 * anonimização remove apenas os dados pessoais.
 */
export class CustomerService {
  constructor(private readonly db: Db) {}

  private where(search: string | undefined): Prisma.CustomerWhereInput[] {
    const terms = normalizeSearch(search).split(' ').filter(Boolean)
    const digits = onlyDigits(search ?? '')
    if (!terms.length) return []
    return [
      {
        OR: [
          { AND: terms.map((t) => ({ searchText: { contains: t } })) },
          ...(digits.length >= 3 ? [{ document: { startsWith: digits } }, { phone: { contains: digits } }] : [])
        ]
      }
    ]
  }

  /** Busca rápida (PDV, pedidos, orçamentos). */
  async search(actor: Actor | null, input: unknown): Promise<CustomerLite[]> {
    requirePermission(actor, 'customers.view', 'customers.manage', 'pdv.sell', 'orders.manage', 'quotes.manage')
    const { query } = customerSearchSchema.parse(input)
    const rows = await this.db.customer.findMany({
      where: { AND: [{ deletedAt: null, active: true, anonymizedAt: null }, ...this.where(query)] },
      orderBy: { name: 'asc' },
      take: 20
    })
    // Crediário disponível (limite − saldo em aberto) para o PDV
    const st = await this.stats(rows.filter((c) => c.creditLimitCents !== null).map((c) => c.id))
    return rows.map((c) => ({
      ...toLite(c),
      creditLimitCents: c.creditLimitCents,
      creditAvailableCents: c.creditLimitCents === null ? null : c.creditLimitCents - (st.open.get(c.id) ?? 0)
    }))
  }

  private async stats(ids: number[]) {
    if (ids.length === 0) return { sales: new Map(), open: new Map() }
    const [sales, receivables] = await Promise.all([
      this.db.sale.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids }, status: 'COMPLETED' },
        _sum: { totalCents: true },
        _count: { _all: true },
        _max: { createdAt: true }
      }),
      this.db.accountReceivable.groupBy({
        by: ['customerId'],
        where: { customerId: { in: ids }, status: { in: ['OPEN', 'PARTIAL'] } },
        _sum: { amountCents: true, receivedCents: true }
      })
    ])
    return {
      sales: new Map(sales.map((s) => [s.customerId!, { count: s._count._all, total: s._sum.totalCents ?? 0, last: s._max.createdAt }])),
      open: new Map(receivables.map((r) => [r.customerId!, (r._sum.amountCents ?? 0) - (r._sum.receivedCents ?? 0)]))
    }
  }

  async list(actorInput: Actor | null, input: unknown): Promise<CustomerListResult> {
    requirePermission(actorInput, 'customers.view', 'customers.manage')
    const q = customerListSchema.parse(input ?? {})
    const and: Prisma.CustomerWhereInput[] = [{ deletedAt: null }, ...this.where(q.search)]
    if (q.status !== 'all') and.push({ active: q.status === 'active' })
    if (q.withOpenBalance) and.push({ receivables: { some: { status: { in: ['OPEN', 'PARTIAL'] } } } })
    const where = { AND: and }
    const [total, rows] = await Promise.all([
      this.db.customer.count({ where }),
      this.db.customer.findMany({ where, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })
    ])
    const st = await this.stats(rows.map((r) => r.id))
    const items: CustomerListItem[] = rows.map((c) => {
      const s = st.sales.get(c.id)
      return {
        id: c.id,
        name: c.name,
        document: c.document,
        phone: c.phone,
        email: c.email,
        city: c.city,
        state: c.state,
        active: c.active,
        anonymized: !!c.anonymizedAt,
        salesCount: s?.count ?? 0,
        salesTotalCents: s?.total ?? 0,
        lastPurchaseAt: s?.last?.toISOString() ?? null,
        openBalanceCents: st.open.get(c.id) ?? 0
      }
    })
    return { items, total, page: q.page, pageSize: q.pageSize }
  }

  async get(actorInput: Actor | null, input: unknown): Promise<CustomerDetail> {
    requirePermission(actorInput, 'customers.view', 'customers.manage')
    const { id } = idSchema.parse(input)
    const c = await this.db.customer.findFirst({ where: { id, deletedAt: null } })
    if (!c) throw notFound('Cliente não encontrado.')
    const [st, sales, orders, quotes] = await Promise.all([
      this.stats([c.id]),
      this.db.sale.findMany({
        where: { customerId: c.id },
        include: { user: { select: { name: true } }, payments: { select: { method: true } }, _count: { select: { items: true, returns: true } } },
        orderBy: { id: 'desc' },
        take: 50
      }),
      this.db.order.findMany({ where: { customerId: c.id }, include: { user: { select: { name: true } }, sale: { select: { id: true } }, _count: { select: { items: true } } }, orderBy: { id: 'desc' }, take: 50 }),
      this.db.quote.findMany({
        where: { customerId: c.id },
        include: { user: { select: { name: true } }, order: { select: { id: true } }, sale: { select: { id: true } }, _count: { select: { items: true } } },
        orderBy: { id: 'desc' },
        take: 50
      })
    ])
    const s = st.sales.get(c.id)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return {
      ...toDto(c),
      salesCount: s?.count ?? 0,
      salesTotalCents: s?.total ?? 0,
      lastPurchaseAt: s?.last?.toISOString() ?? null,
      openBalanceCents: st.open.get(c.id) ?? 0,
      sales: sales.map((x) => ({
        id: x.id,
        createdAt: x.createdAt.toISOString(),
        status: x.status,
        totalCents: x.totalCents,
        itemCount: x._count.items,
        operatorName: x.user.name,
        customerName: c.name,
        paymentMethods: [...new Set(x.payments.map((p) => p.method))],
        hasReturns: x._count.returns > 0
      })),
      orders: orders.map((o) => ({
        id: o.id,
        createdAt: o.createdAt.toISOString(),
        status: o.status,
        customerName: c.name,
        totalCents: o.totalCents,
        itemCount: o._count.items,
        expectedDeliveryAt: o.expectedDeliveryAt?.toISOString() ?? null,
        userName: o.user.name,
        saleId: o.sale?.id ?? null,
        quoteId: o.quoteId
      })),
      quotes: quotes.map((q) => ({
        id: q.id,
        createdAt: q.createdAt.toISOString(),
        status: (q.status === 'DRAFT' || q.status === 'SENT') && q.validUntil && q.validUntil < today ? 'EXPIRED' : q.status,
        validUntil: (q.validUntil ?? q.createdAt).toISOString(),
        customerName: c.name,
        totalCents: q.totalCents,
        itemCount: q._count.items,
        userName: q.user.name,
        orderId: q.order?.id ?? null,
        saleId: q.sale?.id ?? null
      }))
    }
  }

  private async ensureUniqueDocument(db: DbClient, document: string | null, selfId: number | null) {
    if (!document) return
    const other = await db.customer.findFirst({ where: { document, deletedAt: null, id: selfId ? { not: selfId } : undefined } })
    if (other) throw conflict(`Já existe o cliente "${other.name}" com este CPF/CNPJ.`)
  }

  async create(actorInput: Actor | null, input: unknown): Promise<CustomerDto> {
    const actor = requirePermission(actorInput, 'customers.manage')
    const { consent, ...data } = customerSchema.parse(input)
    assertCreditPermission(actor, null, data.creditLimitCents ?? null)
    return this.db.$transaction(async (tx) => {
      await this.ensureUniqueDocument(tx, data.document, null)
      const c = await tx.customer.create({ data: { ...data, consentAt: consent ? new Date() : null, searchText: customerSearchText(data) } })
      await writeAudit(tx, { userId: actor.userId, action: 'customer.create', entity: 'Customer', entityId: c.id, details: { consent } })
      return toDto(c)
    })
  }

  /** Cadastro rápido no PDV (nome, documento, telefone). */
  async quickCreate(actorInput: Actor | null, input: unknown): Promise<CustomerLite> {
    const actor = requirePermission(actorInput, 'customers.manage')
    const data = customerQuickSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      await this.ensureUniqueDocument(tx, data.document, null)
      const c = await tx.customer.create({ data: { ...data, searchText: customerSearchText({ ...data, city: null }) } })
      await writeAudit(tx, { userId: actor.userId, action: 'customer.create', entity: 'Customer', entityId: c.id, details: { via: 'pdv' } })
      return toLite(c)
    })
  }

  async update(actorInput: Actor | null, input: unknown): Promise<CustomerDto> {
    const actor = requirePermission(actorInput, 'customers.manage')
    const { id, consent, ...data } = customerUpdateSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const current = await tx.customer.findFirst({ where: { id, deletedAt: null } })
      if (!current) throw notFound('Cliente não encontrado.')
      if (current.anonymizedAt) throw conflict('Cliente anonimizado (LGPD) não pode ser editado.')
      assertCreditPermission(actor, current.creditLimitCents, data.creditLimitCents === undefined ? current.creditLimitCents : data.creditLimitCents)
      await this.ensureUniqueDocument(tx, data.document, id)
      const consentAt = consent ? (current.consentAt ?? new Date()) : null
      const c = await tx.customer.update({ where: { id }, data: { ...data, consentAt, searchText: customerSearchText(data) } })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'customer.update',
        entity: 'Customer',
        entityId: id,
        details: {
          consentChanged: !!current.consentAt !== consent,
          active: data.active,
          ...(data.creditLimitCents !== undefined && current.creditLimitCents !== data.creditLimitCents ? { creditLimit: { from: current.creditLimitCents, to: data.creditLimitCents } } : {})
        }
      })
      return toDto(c)
    })
  }

  /** Exclusão lógica: some das listas; vendas, pedidos e financeiro continuam vinculados. */
  async remove(actorInput: Actor | null, input: unknown): Promise<void> {
    const actor = requirePermission(actorInput, 'customers.manage')
    const { id } = idSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const c = await tx.customer.findFirst({ where: { id, deletedAt: null } })
      if (!c) throw notFound('Cliente não encontrado.')
      const open = await tx.accountReceivable.count({ where: { customerId: id, status: { in: ['OPEN', 'PARTIAL'] } } })
      if (open > 0) throw conflict('O cliente possui valores em aberto. Quite ou cancele antes de excluir.')
      await tx.customer.update({ where: { id }, data: { deletedAt: new Date(), active: false } })
      await writeAudit(tx, { userId: actor.userId, action: 'customer.delete', entity: 'Customer', entityId: id })
    })
  }

  /**
   * LGPD — direito à eliminação: apaga os dados pessoais e mantém os registros de vendas
   * (obrigações legais/fiscais) vinculados a um cliente anônimo. Irreversível.
   */
  async anonymize(actorInput: Actor | null, input: unknown): Promise<void> {
    const actor = requirePermission(actorInput, 'customers.manage')
    const { id } = idSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const c = await tx.customer.findFirst({ where: { id, deletedAt: null } })
      if (!c) throw notFound('Cliente não encontrado.')
      if (c.anonymizedAt) throw conflict('Este cliente já foi anonimizado.')
      const open = await tx.accountReceivable.count({ where: { customerId: id, status: { in: ['OPEN', 'PARTIAL'] } } })
      if (open > 0) throw conflict('O cliente possui valores em aberto e não pode ser anonimizado agora.')
      const name = `Cliente anonimizado #${id}`
      await tx.customer.update({
        where: { id },
        data: {
          name,
          document: null,
          phone: null,
          email: null,
          zipCode: null,
          street: null,
          number: null,
          complement: null,
          district: null,
          city: null,
          state: null,
          notes: null,
          consentAt: null,
          creditLimitCents: null,
          active: false,
          anonymizedAt: new Date(),
          searchText: normalizeSearch(name)
        }
      })
      // CPF/CNPJ informado diretamente nas vendas deste cliente também é removido
      await tx.sale.updateMany({ where: { customerId: id }, data: { customerDocument: null } })
      await tx.quote.updateMany({ where: { customerId: id }, data: { contactName: null, contactPhone: null } })
      await writeAudit(tx, { userId: actor.userId, action: 'customer.anonymize', entity: 'Customer', entityId: id })
    })
  }

  /** LGPD — portabilidade: dados do cliente e resumo do relacionamento em formato estruturado. */
  async exportData(actorInput: Actor | null, input: unknown): Promise<{ fileName: string; json: string }> {
    const actor = requirePermission(actorInput, 'customers.manage')
    const detail = await this.get(actor, input)
    if (detail.anonymizedAt) throw conflict('Cliente anonimizado: não há dados pessoais para exportar.')
    const { sales, orders, quotes, ...personal } = detail
    const payload = {
      exportadoEm: new Date().toISOString(),
      finalidade: 'Portabilidade de dados pessoais (LGPD, art. 18)',
      cliente: personal,
      compras: sales.map((s) => ({ venda: s.id, data: s.createdAt, total: s.totalCents / 100, situacao: s.status })),
      pedidos: orders.map((o) => ({ pedido: o.id, data: o.createdAt, total: o.totalCents / 100, situacao: o.status })),
      orcamentos: quotes.map((q) => ({ orcamento: q.id, data: q.createdAt, total: q.totalCents / 100, situacao: q.status }))
    }
    await writeAudit(this.db, { userId: actor.userId, action: 'customer.export', entity: 'Customer', entityId: detail.id })
    return { fileName: `cliente-${detail.id}-dados.json`, json: JSON.stringify(payload, null, 2) }
  }
}
