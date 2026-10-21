import type { SupplierDto } from '@shared/api'
import { idSchema, supplierListSchema, supplierSchema, supplierUpdateSchema } from '@shared/catalogSchemas'
import { normalizeSearch, searchTextOf } from '@shared/text'
import type { Db, DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'
import { writeAudit } from '../repositories/audit.repository'
import { conflict, notFound } from '../utils/errors'
import { requirePermission, type Actor } from './context'

const include = { _count: { select: { products: { where: { deletedAt: null } } } } } as const

type SupplierRow = Prisma.SupplierGetPayload<{ include: typeof include }>

function toDto(s: SupplierRow): SupplierDto {
  return {
    id: s.id,
    name: s.name,
    tradeName: s.tradeName,
    document: s.document,
    phone: s.phone,
    email: s.email,
    contactName: s.contactName,
    zipCode: s.zipCode,
    street: s.street,
    number: s.number,
    complement: s.complement,
    district: s.district,
    city: s.city,
    state: s.state,
    notes: s.notes,
    active: s.active,
    productCount: s._count.products,
    createdAt: s.createdAt.toISOString()
  }
}

const searchOf = (d: { name: string; tradeName: string | null; document: string | null; contactName: string | null; city: string | null }) =>
  searchTextOf(d.name, d.tradeName, d.document, d.contactName, d.city)

export class SupplierService {
  constructor(private readonly db: Db) {}

  /** Lista para o módulo Fornecedores e para os seletores do cadastro de produtos. */
  async list(actor: Actor | null, input: unknown): Promise<SupplierDto[]> {
    requirePermission(actor, 'suppliers.manage', 'products.manage', 'finance.payables')
    const { search, includeInactive } = supplierListSchema.parse(input ?? {})
    const terms = normalizeSearch(search).split(' ').filter(Boolean)
    const rows = await this.db.supplier.findMany({
      where: {
        deletedAt: null,
        ...(includeInactive ? {} : { active: true }),
        AND: terms.map((t) => ({ searchText: { contains: t } }))
      },
      include,
      orderBy: { name: 'asc' }
    })
    return rows.map(toDto)
  }

  private async ensureUniqueDocument(db: DbClient, document: string | null, selfId: number | null) {
    if (!document) return
    const other = await db.supplier.findFirst({ where: { document, deletedAt: null, id: selfId ? { not: selfId } : undefined } })
    if (other) throw conflict(`Já existe o fornecedor "${other.name}" com este CPF/CNPJ.`)
  }

  async create(actorInput: Actor | null, input: unknown): Promise<SupplierDto> {
    const actor = requirePermission(actorInput, 'suppliers.manage')
    const data = supplierSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      await this.ensureUniqueDocument(tx, data.document, null)
      const s = await tx.supplier.create({ data: { ...data, searchText: searchOf(data) }, include })
      await writeAudit(tx, { userId: actor.userId, action: 'supplier.create', entity: 'Supplier', entityId: s.id, details: { name: s.name } })
      return toDto(s)
    })
  }

  async update(actorInput: Actor | null, input: unknown): Promise<SupplierDto> {
    const actor = requirePermission(actorInput, 'suppliers.manage')
    const { id, ...data } = supplierUpdateSchema.parse(input)
    return this.db.$transaction(async (tx) => {
      const current = await tx.supplier.findFirst({ where: { id, deletedAt: null } })
      if (!current) throw notFound('Fornecedor não encontrado.')
      await this.ensureUniqueDocument(tx, data.document, id)
      const s = await tx.supplier.update({ where: { id }, data: { ...data, searchText: searchOf(data) }, include })
      await writeAudit(tx, { userId: actor.userId, action: 'supplier.update', entity: 'Supplier', entityId: id, details: { name: s.name, active: s.active } })
      return toDto(s)
    })
  }

  /**
   * Exclusão lógica: o fornecedor some das listas, mas continua vinculado ao
   * histórico (produtos e contas a pagar já registrados).
   */
  async remove(actorInput: Actor | null, input: unknown): Promise<void> {
    const actor = requirePermission(actorInput, 'suppliers.manage')
    const { id } = idSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const current = await tx.supplier.findFirst({ where: { id, deletedAt: null } })
      if (!current) throw notFound('Fornecedor não encontrado.')
      await tx.supplier.update({ where: { id }, data: { deletedAt: new Date(), active: false } })
      await writeAudit(tx, { userId: actor.userId, action: 'supplier.delete', entity: 'Supplier', entityId: id, details: { name: current.name } })
    })
  }
}
