import { z } from 'zod'

const id = z.number().int().positive()
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')

// ───────────── Notas fiscais ─────────────

/**
 * Provedores fiscais disponíveis. A emissão real (assinatura, transmissão à SEFAZ, XML e DANFE) é feita
 * por um provedor homologado; enquanto nenhum estiver integrado, as notas ficam apenas preparadas.
 */
export const FISCAL_PROVIDERS = { NONE: 'Nenhum (emissão desativada)' } as const
export type FiscalProviderKey = keyof typeof FISCAL_PROVIDERS

export const FISCAL_STATUS = {
  PENDING: 'Preparada (não transmitida)',
  PROCESSING: 'Em processamento',
  AUTHORIZED: 'Autorizada',
  REJECTED: 'Rejeitada',
  CANCELLED: 'Cancelada',
  ERROR: 'Erro',
  DISCARDED: 'Descartada'
} as const
export type FiscalStatus = keyof typeof FISCAL_STATUS

export const FISCAL_TYPES = { NFCE: 'NFC-e (consumidor)', NFE: 'NF-e' } as const

export const fiscalSettingsSchema = z.object({
  provider: z.enum(Object.keys(FISCAL_PROVIDERS) as [FiscalProviderKey]).default('NONE'),
  environment: z.enum(['HOMOLOGACAO', 'PRODUCAO']).default('HOMOLOGACAO'),
  nfceSeries: z.number().int().min(1).max(999).default(1),
  nfeSeries: z.number().int().min(1).max(999).default(1)
})
export type FiscalSettings = z.output<typeof fiscalSettingsSchema>
export type FiscalSettingsInput = z.input<typeof fiscalSettingsSchema>

export const fiscalPrepareSchema = z.object({ saleId: id, type: z.enum(['NFCE', 'NFE']) })
export const fiscalListSchema = z.object({
  status: z.enum(Object.keys(FISCAL_STATUS) as [FiscalStatus, ...FiscalStatus[]]).optional(),
  type: z.enum(['NFCE', 'NFE']).optional(),
  from: day.optional(),
  to: day.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50)
})
/** A SEFAZ exige justificativa de 15 a 255 caracteres para o cancelamento. */
export const fiscalCancelSchema = z.object({ id, reason: z.string().trim().min(15, 'A justificativa deve ter ao menos 15 caracteres').max(255) })

/** Códigos de forma de pagamento da NF-e/NFC-e (tabela tPag da SEFAZ). */
export const FISCAL_PAYMENT_CODES: Record<string, string> = {
  CASH: '01',
  CREDIT_CARD: '03',
  DEBIT_CARD: '04',
  STORE_CREDIT: '05',
  PIX: '17',
  VOUCHER: '99',
  OTHER: '99'
}

export type FiscalPrepareInput = z.input<typeof fiscalPrepareSchema>
export type FiscalListInput = z.input<typeof fiscalListSchema>

// ───────────── TEF e conciliação ─────────────

export const TEF_PROVIDERS = { NONE: 'Nenhum (pagamentos registrados manualmente)' } as const
export type TefProviderKey = keyof typeof TEF_PROVIDERS
export const tefSettingsSchema = z.object({ provider: z.enum(Object.keys(TEF_PROVIDERS) as [TefProviderKey]).default('NONE') })
export type TefSettings = z.output<typeof tefSettingsSchema>

export const CARD_BRANDS = ['VISA', 'MASTERCARD', 'ELO', 'HIPERCARD', 'AMEX', 'OUTRA'] as const

/**
 * Dados do comprovante da maquininha. NSU até 12 dígitos e autorização até 12 caracteres:
 * impede que um número de cartão (13 a 19 dígitos) seja digitado e gravado por engano.
 */
export const paymentReferenceSchema = z.object({
  nsu: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{1,12}$/.test(v), 'NSU: até 12 dígitos'),
  authorizationCode: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[A-Z0-9]{1,12}$/.test(v), 'Autorização: até 12 letras ou números'),
  cardBrand: z.enum(CARD_BRANDS).nullish().transform((v) => v ?? null)
})

export const RECONCILE_METHODS = ['PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'] as const
export const reconciliationListSchema = z.object({
  from: day,
  to: day,
  method: z.enum(RECONCILE_METHODS).optional(),
  status: z.enum(['all', 'pending', 'reconciled']).default('all')
})
export const paymentReferenceUpdateSchema = paymentReferenceSchema.extend({ paymentId: id })
export const reconcileSchema = z.object({ paymentIds: z.array(id).min(1).max(500), reconciled: z.boolean() })

export type ReconciliationListInput = z.input<typeof reconciliationListSchema>
export type PaymentReferenceUpdateInput = z.input<typeof paymentReferenceUpdateSchema>
