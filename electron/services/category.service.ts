import type { CategoryDto } from '@shared/api'
import { categorySchema, categoryUpdateSchema, idSchema } from '@shared/catalogSchemas'
import { normalizeSearch } from '@shared/text'
import type { Db, DbClient } from '../database/connection'
import { writeAudit } from '../repositories/audit.repository'
import { categoriesUnder, findCategory, listCategories, type CategoryRow } from '../repositories/category.repository'
import { conflict, notFound, validationError } from '../utils/errors'
import { requirePermission, type Actor } from './context'

function toDto(c: CategoryRow): CategoryDto {
  return {
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    parentName: c.parent?.name ?? null,
    defaultMarginBps: c.defaultMarginBps,
    active: c.active,
    productCount: c._count.products + c._count.subProducts
  }
}

/** Categorias com até dois níveis (categoria > subcategoria). */
export class CategoryService {
  constructor(private readonly db: Db) {}

  async list(actor: Actor | null): Promise<CategoryDto[]> {
    requirePermission(actor, 'products.view', 'products.manage', 'catalog.view')
    return (await listCategories(this.db)).map(toDto)
  }

  private async validate(
    db: DbClient,
    data: { name: string; parentId: number | null },
    selfId: number | null
  ): Promise<void> {
    if (data.parentId !== null) {
      if (data.parentId === selfId) throw validationError('Uma categoria não pode ser subcategoria de si mesma.')
      const parent = await findCategory(db, data.parentId)
      if (!parent) throw validationError('Categoria principal não encontrada.', { parentId: 'Categoria inválida' })
      if (parent.parentId !== null) {
        throw validationError('Subcategorias não podem ter subcategorias.', { parentId: 'Escolha uma categoria principal' })
      }
      if (selfId !== null && (await findCategory(db, selfId))?._count.children) {
        throw validationError('Esta categoria possui subcategorias e não pode virar subcategoria.')
      }
    }
    const siblings = await categoriesUnder(db, data.parentId)
    const name = normalizeSearch(data.name)
    if (siblings.some((s) => s.id !== selfId && normalizeSearch(s.name) === name)) {
      throw conflict(`Já existe a categoria "${data.name}" neste nível.`)
    }
  }

  async create(actorInput: Actor | null, input: unknown): Promise<CategoryDto> {
    const actor = requirePermission(actorInput, 'products.manage')
    const data = categorySchema.parse(input)
    const id = await this.db.$transaction(async (tx) => {
      await this.validate(tx, data, null)
      const c = await tx.category.create({ data })
      await writeAudit(tx, { userId: actor.userId, action: 'category.create', entity: 'Category', entityId: c.id, details: data })
      return c.id
    })
    return toDto((await findCategory(this.db, id))!)
  }

  async update(actorInput: Actor | null, input: unknown): Promise<CategoryDto> {
    const actor = requirePermission(actorInput, 'products.manage')
    const { id, ...data } = categoryUpdateSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const current = await findCategory(tx, id)
      if (!current) throw notFound('Categoria não encontrada.')
      await this.validate(tx, data, id)
      await tx.category.update({ where: { id }, data })
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'category.update',
        entity: 'Category',
        entityId: id,
        details: { before: { name: current.name, parentId: current.parentId, active: current.active }, after: data }
      })
    })
    return toDto((await findCategory(this.db, id))!)
  }

  /** Exclui apenas categorias sem produtos e sem subcategorias; caso contrário, desative-a. */
  async remove(actorInput: Actor | null, input: unknown): Promise<void> {
    const actor = requirePermission(actorInput, 'products.manage')
    const { id } = idSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const c = await findCategory(tx, id)
      if (!c) throw notFound('Categoria não encontrada.')
      if (c._count.children > 0) throw conflict('Exclua ou mova as subcategorias antes.')
      const linked = await tx.product.count({ where: { OR: [{ categoryId: id }, { subcategoryId: id }] } })
      if (linked > 0) throw conflict('Categoria com produtos vinculados (inclusive excluídos). Desative-a em vez de excluir.')
      await tx.category.delete({ where: { id } })
      await writeAudit(tx, { userId: actor.userId, action: 'category.delete', entity: 'Category', entityId: id, details: { name: c.name } })
    })
  }
}
