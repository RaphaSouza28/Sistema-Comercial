import type { DbClient } from '../database/connection'
import type { Prisma } from '../database/generated/client'

/** O sistema atende uma única empresa: o registro mais antigo é a empresa ativa. */
export function findCompany(db: DbClient) {
  return db.company.findFirst({ orderBy: { id: 'asc' } })
}

export function countCompanies(db: DbClient): Promise<number> {
  return db.company.count()
}

export function createCompany(db: DbClient, data: Prisma.CompanyCreateInput) {
  return db.company.create({ data })
}

export function updateCompany(db: DbClient, id: number, data: Prisma.CompanyUpdateInput) {
  return db.company.update({ where: { id }, data })
}
