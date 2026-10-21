import { z } from 'zod'
import { isValidCpfOrCnpj, onlyDigits } from './documents'
import { authorizationSchema } from './salesSchemas'

const id = z.number().int().positive()
const optionalId = id.nullish().transform((v) => v ?? null)
const cents = z.number().int('Valor inválido').min(0, 'O valor não pode ser negativo').max(2_000_000_000)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null))
const digits = (min: number, max: number, label: string) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ? onlyDigits(v) : ''))
    .refine((v) => v === '' || (v.length >= min && v.length <= max), `${label} inválido`)
    .transform((v) => (v ? v : null))

// ───────────── Clientes ─────────────

export const customerSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome').max(120),
  document: z
    .string()
    .nullish()
    .transform((v) => (v ? onlyDigits(v) : null))
    .refine((v) => v === null || isValidCpfOrCnpj(v), 'CPF/CNPJ inválido'),
  phone: digits(10, 13, 'Telefone'),
  email: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, 'E-mail inválido'),
  zipCode: digits(8, 8, 'CEP'),
  street: text(150),
  number: text(20),
  complement: text(80),
  district: text(80),
  city: text(80),
  state: z
    .string()
    .trim()
    .toUpperCase()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[A-Z]{2}$/.test(v), 'UF deve ter 2 letras'),
  notes: text(1000),
  /** Limite do crediário (null = sem crediário; ausente = mantém o atual). */
  creditLimitCents: cents.nullable().optional(),
  /** LGPD: o cliente autorizou o uso dos dados para cadastro e contato. */
  consent: z.boolean().default(false)
})
export const customerUpdateSchema = customerSchema.extend({ id, active: z.boolean() })
export const customerListSchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  withOpenBalance: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50)
})

// ───────────── Itens de pedido/orçamento ─────────────

export const documentItemSchema = z
  .object({
    productId: optionalId,
    variantId: optionalId,
    /** Linha livre (somente orçamentos): descrição e preço digitados. */
    description: text(200),
    unitPriceCents: cents.nullish().transform((v) => v ?? null),
    quantityMilli: z.number().int().positive('Quantidade inválida').max(1_000_000_000),
    discountCents: cents.default(0)
  })
  .refine((v) => v.productId !== null || (v.description !== null && v.unitPriceCents !== null), {
    message: 'Informe o produto ou a descrição e o preço do item',
    path: ['description']
  })

const documentBase = {
  customerId: optionalId,
  discountCents: cents.default(0),
  notes: text(1000),
  items: z.array(documentItemSchema).min(1, 'Adicione ao menos um item').max(300),
  authorization: authorizationSchema.optional()
}

// ───────────── Pedidos ─────────────

export const ORDER_STATUS = {
  PENDING: 'Pendente',
  CONFIRMED: 'Confirmado',
  PICKING: 'Em separação',
  READY: 'Pronto',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado'
} as const
export type OrderStatus = keyof typeof ORDER_STATUS

export const orderSchema = z.object({ ...documentBase, expectedDeliveryAt: day.nullish().transform((v) => v ?? null) })
export const orderUpdateSchema = orderSchema.extend({ id })
export const orderStatusSchema = z.object({
  id,
  status: z.enum(['PENDING', 'CONFIRMED', 'PICKING', 'READY', 'DELIVERED']),
})
export const orderCancelSchema = z.object({ id, reason: z.string().trim().min(3, 'Informe o motivo').max(300) })
export const orderListSchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(['PENDING', 'CONFIRMED', 'PICKING', 'READY', 'DELIVERED', 'CANCELLED', 'OPEN']).optional(),
  customerId: id.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50)
})

// ───────────── Orçamentos ─────────────

export const QUOTE_STATUS = {
  DRAFT: 'Rascunho',
  SENT: 'Enviado',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
  EXPIRED: 'Expirado'
} as const
export type QuoteStatus = keyof typeof QUOTE_STATUS

export const quoteSchema = z.object({
  ...documentBase,
  validUntil: day,
  contactName: text(120),
  contactPhone: digits(10, 13, 'Telefone')
})
export const quoteUpdateSchema = quoteSchema.extend({ id })
export const quoteStatusSchema = z.object({ id, status: z.enum(['DRAFT', 'SENT', 'APPROVED', 'REJECTED']) })
export const quoteListSchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(['DRAFT', 'SENT', 'APPROVED', 'REJECTED', 'EXPIRED']).optional(),
  customerId: id.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50)
})
export const quoteToOrderSchema = z.object({ id, expectedDeliveryAt: day.nullish().transform((v) => v ?? null) })

// ───────────── Catálogo ─────────────

export const catalogSchema = z.object({
  categoryIds: z.array(id).max(200).default([]),
  search: z.string().max(100).optional(),
  inStockOnly: z.boolean().default(false),
  promoOnly: z.boolean().default(false),
  showPrices: z.boolean().default(true),
  title: text(80)
})

export type CustomerInput = z.input<typeof customerSchema>
export type CustomerUpdateInput = z.input<typeof customerUpdateSchema>
export type CustomerListInput = z.input<typeof customerListSchema>
export type DocumentItemInput = z.input<typeof documentItemSchema>
export type OrderInput = z.input<typeof orderSchema>
export type OrderUpdateInput = z.input<typeof orderUpdateSchema>
export type OrderListInput = z.input<typeof orderListSchema>
export type QuoteInput = z.input<typeof quoteSchema>
export type QuoteUpdateInput = z.input<typeof quoteUpdateSchema>
export type QuoteListInput = z.input<typeof quoteListSchema>
export type CatalogInput = z.input<typeof catalogSchema>
