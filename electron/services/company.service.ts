import type { CompanyDto } from '@shared/api'
import { companySchema } from '@shared/schemas'
import type { Db } from '../database/connection'
import { writeAudit } from '../repositories/audit.repository'
import { findCompany, updateCompany } from '../repositories/company.repository'
import { notFound } from '../utils/errors'
import { requireActor, requirePermission, type Actor } from './context'

type CompanyRow = NonNullable<Awaited<ReturnType<typeof findCompany>>>

function toDto(c: CompanyRow): CompanyDto {
  return {
    id: c.id,
    legalName: c.legalName,
    tradeName: c.tradeName,
    document: c.document,
    stateRegistration: c.stateRegistration,
    taxRegime: c.taxRegime,
    phone: c.phone,
    email: c.email,
    zipCode: c.zipCode,
    street: c.street,
    number: c.number,
    complement: c.complement,
    district: c.district,
    city: c.city,
    state: c.state
  }
}

export class CompanyService {
  constructor(private readonly db: Db) {}

  /** Qualquer usuário autenticado pode ver os dados da empresa (cabeçalhos e comprovantes). */
  async get(actor: Actor | null): Promise<CompanyDto | null> {
    requireActor(actor)
    const company = await findCompany(this.db)
    return company ? toDto(company) : null
  }

  async update(actorInput: Actor | null, input: unknown): Promise<CompanyDto> {
    const actor = requirePermission(actorInput, 'settings.manage')
    const data = companySchema.parse(input)
    const current = await findCompany(this.db)
    if (!current) throw notFound('Empresa não cadastrada.')
    const updated = await this.db.$transaction(async (tx) => {
      const c = await updateCompany(tx, current.id, data)
      const changed = (Object.keys(data) as (keyof typeof data)[]).filter((k) => current[k] !== data[k])
      await writeAudit(tx, {
        userId: actor.userId,
        action: 'company.update',
        entity: 'Company',
        entityId: current.id,
        details: { changed }
      })
      return c
    })
    return toDto(updated)
  }
}
