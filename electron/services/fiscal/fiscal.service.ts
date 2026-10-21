import type { FiscalChecklist, FiscalDocumentDetail, FiscalDocumentDto, FiscalListResult, FiscalPayload } from '@shared/api'
import { idSchema } from '@shared/catalogSchemas'
import {
  FISCAL_PAYMENT_CODES,
  FISCAL_PROVIDERS,
  fiscalCancelSchema,
  fiscalListSchema,
  fiscalPrepareSchema,
  fiscalSettingsSchema,
  type FiscalSettings
} from '@shared/integrationSchemas'
import type { Db, DbClient } from '../../database/connection'
import type { Prisma } from '../../database/generated/client'
import { writeAudit } from '../../repositories/audit.repository'
import { getSetting, setSetting } from '../../repositories/setting.repository'
import { conflict, notFound, validationError } from '../../utils/errors'
import { requirePermission, type Actor } from '../context'
import { fromDateKey, parseJson } from '../product.mappers'
import type { FiscalDocumentRef, FiscalProvider, FiscalResult } from '../../integrations/fiscal/provider'

const KEY = 'fiscal'
/** Situações em que a venda já tem uma nota "viva" (não pode preparar outra). */
const ACTIVE = ['PENDING', 'PROCESSING', 'AUTHORIZED', 'REJECTED', 'ERROR'] as const

export async function readFiscalSettings(db: DbClient): Promise<FiscalSettings> {
  return fiscalSettingsSchema.parse(await getSetting<object>(db, KEY, {}))
}

/** Arquivos devolvidos pelo provedor (XML autorizado e DANFE), gravados pelo processo principal. */
export interface FiscalFileStore {
  write(name: string, data: string | Buffer): string
}

const include = { sale: { select: { customer: { select: { name: true } } } } } as const satisfies Prisma.FiscalDocumentInclude
type DocRow = Prisma.FiscalDocumentGetPayload<{ include: typeof include }>

function toDto(d: DocRow): FiscalDocumentDto {
  return {
    id: d.id,
    type: d.type,
    saleId: d.saleId,
    status: d.status,
    provider: d.provider,
    environment: d.environment,
    series: d.series,
    number: d.number,
    accessKey: d.accessKey,
    protocol: d.protocol,
    message: d.message,
    totalCents: d.totalCents,
    customerName: d.sale?.customer?.name ?? null,
    issues: parseJson<string[]>(d.issues, []),
    hasXml: !!d.xmlPath,
    hasDanfe: !!d.danfePath,
    createdAt: d.createdAt.toISOString(),
    authorizedAt: d.authorizedAt?.toISOString() ?? null,
    cancelledAt: d.cancelledAt?.toISOString() ?? null,
    cancelReason: d.cancelReason
  }
}

/** Pendências de cadastro que impedem a emissão (o provedor e a SEFAZ fazem a validação completa). */
function companyIssues(c: { document: string | null; stateRegistration: string | null; taxRegime: string | null; street: string | null; number: string | null; district: string | null; city: string | null; state: string | null; zipCode: string | null } | null): string[] {
  if (!c) return ['Cadastre os dados da empresa.']
  const out: string[] = []
  if (!c.document || c.document.length !== 14) out.push('Empresa: informe o CNPJ (a emissão de NF-e/NFC-e exige CNPJ).')
  if (!c.stateRegistration) out.push('Empresa: informe a inscrição estadual (ou "ISENTO").')
  if (!c.taxRegime) out.push('Empresa: informe o regime tributário (CRT).')
  if (!c.street || !c.number || !c.district || !c.city || !c.state || !c.zipCode) out.push('Empresa: endereço incompleto (logradouro, número, bairro, cidade, UF e CEP).')
  return out
}

function productMissing(p: { ncm: string | null; cfop: string | null; taxOrigin: string | null; taxCode: string | null }): string[] {
  const out: string[] = []
  if (!p.ncm) out.push('NCM')
  if (!p.cfop) out.push('CFOP')
  if (!p.taxOrigin) out.push('origem')
  if (!p.taxCode) out.push('CST/CSOSN')
  return out
}

/**
 * Notas fiscais: conferência dos dados fiscais, preparação a partir da venda e o ciclo de vida
 * (transmissão, consulta, cancelamento) delegado a um provedor homologado. Sem provedor, nada é
 * transmitido e nenhuma nota é marcada como autorizada.
 */
export class FiscalService {
  constructor(
    private readonly db: Db,
    private readonly providers: Record<string, FiscalProvider> = {},
    private readonly files: FiscalFileStore | null = null
  ) {}

  async settings(actorInput: Actor | null): Promise<FiscalSettings> {
    requirePermission(actorInput, 'fiscal.manage', 'pdv.sell')
    return readFiscalSettings(this.db)
  }

  async updateSettings(actorInput: Actor | null, input: unknown): Promise<FiscalSettings> {
    const actor = requirePermission(actorInput, 'fiscal.manage')
    const data = fiscalSettingsSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const before = await readFiscalSettings(tx)
      await setSetting(tx, KEY, data)
      await writeAudit(tx, { userId: actor.userId, action: 'settings.fiscal', details: { before, after: data } })
    })
    return data
  }

  /** Provedor configurado e disponível nesta instalação (NONE = emissão desativada). */
  async providerStatus(db: DbClient = this.db) {
    const cfg = await readFiscalSettings(db)
    const provider = this.providers[cfg.provider] ?? null
    return { key: cfg.provider, label: FISCAL_PROVIDERS[cfg.provider], provider, environment: cfg.environment, settings: cfg }
  }

  async checklist(actorInput: Actor | null): Promise<FiscalChecklist> {
    requirePermission(actorInput, 'fiscal.manage')
    const [company, products, status] = await Promise.all([
      this.db.company.findFirst(),
      this.db.product.findMany({
        where: { deletedAt: null, active: true, OR: [{ ncm: null }, { cfop: null }, { taxOrigin: null }, { taxCode: null }] },
        select: { id: true, internalCode: true, name: true, ncm: true, cfop: true, taxOrigin: true, taxCode: true },
        orderBy: { name: 'asc' }
      }),
      this.providerStatus()
    ])
    return {
      company: companyIssues(company),
      products: products.slice(0, 200).map((p) => ({ id: p.id, internalCode: p.internalCode, name: p.name, missing: productMissing(p) })),
      productsWithIssues: products.length,
      providerConfigured: !!status.provider
    }
  }

  async list(actorInput: Actor | null, input: unknown): Promise<FiscalListResult> {
    requirePermission(actorInput, 'fiscal.manage')
    const q = fiscalListSchema.parse(input ?? {})
    const where: Prisma.FiscalDocumentWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: fromDateKey(q.from)! } : {}), ...(q.to ? { lte: fromDateKey(q.to, true)! } : {}) } } : {})
    }
    const [total, rows] = await Promise.all([
      this.db.fiscalDocument.count({ where }),
      this.db.fiscalDocument.findMany({ where, include, orderBy: { id: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize })
    ])
    return { items: rows.map(toDto), total, page: q.page, pageSize: q.pageSize }
  }

  private async detail(db: DbClient, id: number): Promise<FiscalDocumentDetail> {
    const d = await db.fiscalDocument.findUnique({ where: { id }, include })
    if (!d) throw notFound('Documento fiscal não encontrado.')
    return { ...toDto(d), payload: parseJson<FiscalPayload | null>(d.payload, null) }
  }

  async get(actorInput: Actor | null, input: unknown): Promise<FiscalDocumentDetail> {
    requirePermission(actorInput, 'fiscal.manage')
    return this.detail(this.db, idSchema.parse(input).id)
  }

  /** Organiza os dados da venda para a nota e registra as pendências encontradas. Não transmite nada. */
  async prepare(actorInput: Actor | null, input: unknown): Promise<FiscalDocumentDetail> {
    const actor = requirePermission(actorInput, 'fiscal.manage')
    const { saleId, type } = fiscalPrepareSchema.parse(input)
    const id = await this.db.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { customer: true, items: { include: { product: true }, orderBy: { id: 'asc' } }, payments: true }
      })
      if (!sale) throw notFound('Venda não encontrada.')
      if (sale.status !== 'COMPLETED') throw conflict('Só é possível emitir nota de vendas concluídas.')
      const existing = await tx.fiscalDocument.findFirst({ where: { saleId, status: { in: [...ACTIVE] } } })
      if (existing) throw conflict(`A venda #${saleId} já tem o documento fiscal nº ${existing.id} (${existing.status}).`)

      const [company, { settings, key }] = await Promise.all([tx.company.findFirst(), this.providerStatus(tx)])
      const c = sale.customer
      const issues = companyIssues(company)
      const items = sale.items.map((i) => {
        const missing = productMissing(i.product)
        if (missing.length) issues.push(`Item "${i.description}": falta ${missing.join(', ')}.`)
        return {
          productId: i.productId,
          code: i.product.internalCode,
          barcode: i.product.barcode,
          description: i.description,
          ncm: i.product.ncm,
          cest: i.product.cest,
          cfop: i.product.cfop,
          origin: i.product.taxOrigin,
          taxCode: i.product.taxCode,
          unit: i.product.unit,
          quantityMilli: i.quantityMilli,
          unitPriceCents: i.unitPriceCents,
          discountCents: i.discountCents,
          totalCents: i.totalCents
        }
      })
      if (type === 'NFE') {
        if (!c?.document) issues.push('NF-e exige destinatário identificado com CPF/CNPJ (selecione o cliente na venda).')
        if (c && (!c.street || !c.number || !c.district || !c.city || !c.state || !c.zipCode)) issues.push('NF-e: endereço do cliente incompleto.')
      }
      const payload: FiscalPayload = {
        type,
        environment: settings.environment,
        series: type === 'NFE' ? settings.nfeSeries : settings.nfceSeries,
        emitter: {
          legalName: company?.legalName ?? '',
          tradeName: company?.tradeName ?? null,
          document: company?.document ?? null,
          stateRegistration: company?.stateRegistration ?? null,
          taxRegime: company?.taxRegime ?? null,
          street: company?.street ?? null,
          number: company?.number ?? null,
          district: company?.district ?? null,
          city: company?.city ?? null,
          state: company?.state ?? null,
          zipCode: company?.zipCode ?? null
        },
        recipient:
          c || sale.customerDocument
            ? {
                name: c?.name ?? null,
                document: c?.document ?? sale.customerDocument,
                street: c?.street ?? null,
                number: c?.number ?? null,
                district: c?.district ?? null,
                city: c?.city ?? null,
                state: c?.state ?? null,
                zipCode: c?.zipCode ?? null
              }
            : null,
        items,
        payments: sale.payments.map((p) => ({ code: FISCAL_PAYMENT_CODES[p.method] ?? '99', method: p.method, amountCents: p.amountCents })),
        totals: {
          productsCents: sale.items.reduce((a, i) => a + i.totalCents + i.discountCents, 0),
          discountCents: sale.items.reduce((a, i) => a + i.discountCents, 0),
          totalCents: sale.totalCents,
          changeCents: sale.changeCents
        }
      }
      const doc = await tx.fiscalDocument.create({
        data: {
          type,
          saleId,
          provider: key,
          environment: settings.environment,
          series: payload.series,
          status: 'PENDING',
          payload: JSON.stringify(payload),
          issues: JSON.stringify(issues),
          totalCents: sale.totalCents,
          requestedById: actor.userId,
          message: issues.length ? `${issues.length} pendência(s) de cadastro.` : 'Pronta para transmissão pelo provedor fiscal.'
        }
      })
      await writeAudit(tx, { userId: actor.userId, action: 'fiscal.prepare', entity: 'FiscalDocument', entityId: doc.id, details: { saleId, type, issues: issues.length } })
      return doc.id
    })
    return this.detail(this.db, id)
  }

  private ref(d: { id: number; type: 'NFE' | 'NFCE'; environment: string; series: number | null; number: number | null; accessKey: string | null; payload: string | null }): FiscalDocumentRef {
    return { id: d.id, type: d.type, environment: d.environment, series: d.series, number: d.number, accessKey: d.accessKey, payload: parseJson<FiscalPayload>(d.payload, null as never) }
  }

  private async requireProvider() {
    const status = await this.providerStatus()
    if (!status.provider) {
      throw conflict('Nenhum provedor fiscal está configurado. A nota foi preparada, mas só pode ser emitida após integrar um provedor homologado e o certificado digital da empresa.')
    }
    return status.provider
  }

  /** Aplica a resposta do provedor (a única origem possível de uma autorização). */
  private async apply(actor: Actor, id: number, result: FiscalResult, action: string) {
    const xmlPath = result.xml && this.files ? this.files.write(`nota-${id}.xml`, result.xml) : undefined
    const danfePath = result.danfePdf && this.files ? this.files.write(`danfe-${id}.pdf`, result.danfePdf) : undefined
    await this.db.fiscalDocument.update({
      where: { id },
      data: {
        status: result.status,
        message: result.message,
        ...(result.number !== undefined ? { number: result.number } : {}),
        ...(result.accessKey ? { accessKey: result.accessKey } : {}),
        ...(result.protocol ? { protocol: result.protocol } : {}),
        ...(xmlPath ? { xmlPath } : {}),
        ...(danfePath ? { danfePath } : {}),
        ...(result.status === 'AUTHORIZED' ? { authorizedAt: new Date() } : {})
      }
    })
    await writeAudit(this.db, { userId: actor.userId, action, entity: 'FiscalDocument', entityId: id, details: { status: result.status, message: result.message, accessKey: result.accessKey } })
  }

  async transmit(actorInput: Actor | null, input: unknown): Promise<FiscalDocumentDetail> {
    const actor = requirePermission(actorInput, 'fiscal.manage')
    const { id } = idSchema.parse(input)
    const d = await this.db.fiscalDocument.findUnique({ where: { id } })
    if (!d) throw notFound('Documento fiscal não encontrado.')
    if (!['PENDING', 'REJECTED', 'ERROR'].includes(d.status)) throw conflict('Este documento não pode ser transmitido na situação atual.')
    const issues = parseJson<string[]>(d.issues, [])
    if (issues.length) throw validationError(`Corrija as pendências antes de transmitir: ${issues.join(' ')}`)
    const provider = await this.requireProvider()
    // Marca como em processamento antes da chamada: uma falha no meio não gera reenvio cego
    const claimed = await this.db.fiscalDocument.updateMany({ where: { id, status: d.status }, data: { status: 'PROCESSING', message: 'Enviado ao provedor fiscal.' } })
    if (claimed.count !== 1) throw conflict('O documento está sendo transmitido por outra operação.')
    let result: FiscalResult
    try {
      result = await provider.emit(this.ref(d))
    } catch (e) {
      result = { status: 'ERROR', message: `Falha de comunicação com o provedor: ${e instanceof Error ? e.message : String(e)}. Consulte a situação antes de reenviar.` }
    }
    await this.apply(actor, id, result, 'fiscal.transmit')
    return this.detail(this.db, id)
  }

  async query(actorInput: Actor | null, input: unknown): Promise<FiscalDocumentDetail> {
    const actor = requirePermission(actorInput, 'fiscal.manage')
    const { id } = idSchema.parse(input)
    const d = await this.db.fiscalDocument.findUnique({ where: { id } })
    if (!d) throw notFound('Documento fiscal não encontrado.')
    if (!['PROCESSING', 'ERROR'].includes(d.status)) throw conflict('A consulta se aplica a documentos em processamento ou com erro de comunicação.')
    const provider = await this.requireProvider()
    await this.apply(actor, id, await provider.query(this.ref(d)), 'fiscal.query')
    return this.detail(this.db, id)
  }

  /** Cancelamento na SEFAZ (via provedor) de uma nota autorizada. */
  async cancel(actorInput: Actor | null, input: unknown): Promise<FiscalDocumentDetail> {
    const actor = requirePermission(actorInput, 'fiscal.manage')
    const { id, reason } = fiscalCancelSchema.parse(input)
    const d = await this.db.fiscalDocument.findUnique({ where: { id } })
    if (!d) throw notFound('Documento fiscal não encontrado.')
    if (d.status !== 'AUTHORIZED') throw conflict('Somente notas autorizadas podem ser canceladas. Rascunhos podem ser descartados.')
    const provider = await this.requireProvider()
    const r = await provider.cancel(this.ref(d), reason)
    if (!r.ok) {
      await writeAudit(this.db, { userId: actor.userId, action: 'fiscal.cancel.rejected', entity: 'FiscalDocument', entityId: id, details: { message: r.message } })
      throw conflict(`Cancelamento não aceito: ${r.message}`)
    }
    await this.db.fiscalDocument.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, message: r.message, ...(r.protocol ? { protocol: r.protocol } : {}) } })
    await writeAudit(this.db, { userId: actor.userId, action: 'fiscal.cancel', entity: 'FiscalDocument', entityId: id, details: { reason, protocol: r.protocol } })
    return this.detail(this.db, id)
  }

  /** Descarta um rascunho que nunca foi autorizado (libera a venda para preparar outro). */
  async discard(actorInput: Actor | null, input: unknown): Promise<FiscalDocumentDetail> {
    const actor = requirePermission(actorInput, 'fiscal.manage')
    const { id } = idSchema.parse(input)
    const d = await this.db.fiscalDocument.findUnique({ where: { id } })
    if (!d) throw notFound('Documento fiscal não encontrado.')
    if (!['PENDING', 'REJECTED'].includes(d.status)) throw conflict('Só é possível descartar documentos preparados ou rejeitados.')
    await this.db.fiscalDocument.update({ where: { id }, data: { status: 'DISCARDED', message: 'Descartado antes da autorização.' } })
    await writeAudit(this.db, { userId: actor.userId, action: 'fiscal.discard', entity: 'FiscalDocument', entityId: id })
    return this.detail(this.db, id)
  }

  async filePath(actorInput: Actor | null, input: unknown, kind: 'xml' | 'danfe'): Promise<{ path: string; name: string }> {
    requirePermission(actorInput, 'fiscal.manage')
    const { id } = idSchema.parse(input)
    const d = await this.db.fiscalDocument.findUnique({ where: { id } })
    const p = kind === 'xml' ? d?.xmlPath : d?.danfePath
    if (!d || !p) throw notFound(kind === 'xml' ? 'XML não disponível para este documento.' : 'DANFE não disponível para este documento.')
    return { path: p, name: `${kind === 'xml' ? 'nota' : 'danfe'}-${d.accessKey ?? d.id}.${kind === 'xml' ? 'xml' : 'pdf'}` }
  }
}

/** Regras da venda ligadas à nota: chamada dentro da transação de cancelamento da venda. */
export async function onSaleCancelled(tx: DbClient, saleId: number): Promise<void> {
  const docs = await tx.fiscalDocument.findMany({ where: { saleId, status: { in: [...ACTIVE] } } })
  // ERRO = falha de comunicação: a situação real na SEFAZ é desconhecida até consultar o provedor
  if (docs.some((d) => d.status === 'AUTHORIZED' || d.status === 'PROCESSING' || d.status === 'ERROR')) {
    throw conflict('Esta venda tem nota fiscal autorizada, em processamento ou com situação a confirmar. Resolva a nota em Notas Fiscais antes de cancelar a venda.')
  }
  await tx.fiscalDocument.updateMany({ where: { saleId, status: { in: ['PENDING', 'REJECTED'] } }, data: { status: 'DISCARDED', message: 'Venda cancelada antes da emissão.' } })
}
