import type { DbClient } from '../database/connection'

export function listCategories(db: DbClient) {
  return db.category.findMany({
    include: {
      parent: { select: { name: true } },
      _count: {
        select: {
          products: { where: { deletedAt: null } },
          subProducts: { where: { deletedAt: null } },
          children: true
        }
      }
    },
    orderBy: [{ name: 'asc' }]
  })
}

export type CategoryRow = Awaited<ReturnType<typeof listCategories>>[number]

export function findCategory(db: DbClient, id: number) {
  return db.category.findUnique({
    where: { id },
    include: {
      parent: { select: { name: true } },
      _count: {
        select: {
          products: { where: { deletedAt: null } },
          subProducts: { where: { deletedAt: null } },
          children: true
        }
      }
    }
  })
}

/** Busca por nome (sem diferenciar maiúsculas/acentos é feito pelo serviço). */
export function categoriesUnder(db: DbClient, parentId: number | null) {
  return db.category.findMany({ where: { parentId }, select: { id: true, name: true } })
}
