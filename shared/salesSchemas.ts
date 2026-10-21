import { z } from 'zod'
import { isValidCpfOrCnpj, onlyDigits } from './documents'
import { paymentReferenceSchema } from './integrationSchemas'

const id = z.number().int().positive()
const optionalId = id.nullish().transform((v) => v ?? null)
const cents = z.number().int('Valor inválido').min(0, 'O valor não pode ser negativo').max(2_000_000_000)
const requestId = z.string().uuid('Requisição inválida')
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null))
const document = z
  .string()
  .nullish()
  .transform((v) => (v ? onlyDigits(v) : null))
  .refine((v) => v === null || isValidCpfOrCnpj(v), 'CPF/CNPJ inválido')

/** Usuário e senha de quem autoriza (desconto acima do limite, cancelamento). */
export const authorizationSchema = z.object({
  username: z.string().trim().toLowerCase().min(1, 'Informe o usuário').max(64),
  password: z.string().min(1, 'Informe a senha').max(128)
})

export const SALE_PAYMENT_METHODS = ['CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'STORE_CREDIT', 'VOUCHER', 'OTHER'] as const
export type SalePaymentMethod = (typeof SALE_PAYMENT_METHODS)[number]

export const cashOpenSchema = z.object({ requestId, openingCents: cents })

export const customerSearchSchema = z.object({ query: z.string().trim().min(1).max(100) })
export const customerQuickSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  document,
  phone: z
    .string()
    .nullish()
    .transform((v) => (v ? onlyDigits(v) : null))
    .refine((v) => v === null || (v.length >= 10 && v.length <= 13), 'Telefone inválido'),
  email: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, 'E-mail inválido')
})

export const saleItemInput = z.object({
  productId: id,
  variantId: optionalId,
  quantityMilli: z.number().int().positive('Quantidade inválida').max(1_000_000_000),
  discountCents: cents.default(0)
})

const saleBase = {
  customerId: optionalId,
  customerDocument: document,
  sellerId: optionalId,
  discountCents: cents.default(0),
  items: z.array(saleItemInput).min(1, 'Adicione ao menos um item').max(500)
}

export const salePreviewSchema = z.object(saleBase)

export const saleFinalizeSchema = z.object({
  ...saleBase,
  /** Venda de pedido/orçamento: itens, preços e descontos vêm do documento (os itens enviados são ignorados). */
  items: z.array(saleItemInput).max(500).default([]),
  orderId: optionalId,
  quoteId: optionalId,
  requestId,
  notes: text(500),
  payments: z
    .array(
      z.object({
        method: z.enum(SALE_PAYMENT_METHODS, 'Forma de pagamento inválida'),
        amountCents: z.number().int().positive('Informe o valor').max(2_000_000_000),
        installments: z.number().int().min(1).max(24).default(1),
        /** Crediário: vencimento da 1ª parcela (padrão: 30 dias); as demais vencem mensalmente. */
        firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida').nullish().transform((v) => v ?? null),
        label: text(40),
        voucherCode: text(20),
        /** Comprovante da maquininha (opcional): NSU, autorização e bandeira — nunca o número do cartão. */
        ...paymentReferenceSchema.shape
      })
    )
    .min(1, 'Informe o pagamento')
    .max(10),
  authorization: authorizationSchema.optional()
})

export const saleListSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['COMPLETED', 'CANCELLED']).optional(),
  userId: id.optional(),
  search: z.string().trim().max(100).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50)
})

export const saleCancelSchema = z.object({
  saleId: id,
  reason: z.string().trim().min(3, 'Informe o motivo do cancelamento').max(300),
  authorization: authorizationSchema.optional()
})

export const REFUND_METHODS = { CASH: 'Dinheiro (sai do caixa)', PIX: 'Estorno por PIX', CARD: 'Estorno no cartão', VOUCHER: 'Vale-troca', STORE_CREDIT: 'Abater do crediário', NONE: 'Sem reembolso' } as const
export type RefundMethod = keyof typeof REFUND_METHODS

export const saleReturnSchema = z.object({
  requestId,
  saleId: id,
  items: z.array(z.object({ saleItemId: id, quantityMilli: z.number().int().positive('Quantidade inválida') })).min(1, 'Selecione os itens devolvidos'),
  reason: z.string().trim().min(3, 'Informe o motivo').max(300),
  refundMethod: z.enum(Object.keys(REFUND_METHODS) as [RefundMethod, ...RefundMethod[]]),
  authorization: authorizationSchema.optional()
})

export const voucherLookupSchema = z.object({ code: z.string().trim().toUpperCase().min(4).max(20) })
export const pdvSearchSchema = z.object({ query: z.string().trim().min(1).max(100), limit: z.number().int().min(1).max(50).default(20) })

export type AuthorizationInput = z.input<typeof authorizationSchema>
export type CashOpenInput = z.input<typeof cashOpenSchema>
export type CustomerQuickInput = z.input<typeof customerQuickSchema>
export type SalePreviewInput = z.input<typeof salePreviewSchema>
export type SaleFinalizeInput = z.input<typeof saleFinalizeSchema>
export type SaleListInput = z.input<typeof saleListSchema>
export type SaleCancelInput = z.input<typeof saleCancelSchema>
export type SaleReturnInput = z.input<typeof saleReturnSchema>
