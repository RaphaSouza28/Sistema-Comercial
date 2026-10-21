import { z } from 'zod'

const id = z.number().int().positive()
const optionalId = id.nullish().transform((v) => v ?? null)
const cents = z.number().int('Valor inválido').min(0, 'O valor não pode ser negativo').max(2_000_000_000)
const positiveCents = z.number().int('Valor inválido').positive('Informe o valor').max(2_000_000_000)
const requestId = z.string().uuid('Requisição inválida')
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
const optionalDay = day.nullish().transform((v) => v ?? null)
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null))
const reason = z.string().trim().min(3, 'Informe o motivo').max(300)

/** Formas de pagamento/recebimento de contas (crediário e vale-troca são exclusivos do PDV). */
export const FINANCE_METHODS = ['CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'] as const
export type FinanceMethod = (typeof FINANCE_METHODS)[number]

export const RECURRENCE = { NONE: 'Não se repete', WEEKLY: 'Semanal', MONTHLY: 'Mensal', YEARLY: 'Anual' } as const
export type RecurrenceKey = keyof typeof RECURRENCE

/** Situação exibida: contas em aberto com vencimento passado aparecem como atrasadas. */
export const PAYABLE_STATUS = { OPEN: 'Em aberto', OVERDUE: 'Atrasada', PAID: 'Paga', CANCELLED: 'Cancelada' } as const
export const RECEIVABLE_STATUS = { OPEN: 'Em aberto', PARTIAL: 'Parcial', OVERDUE: 'Atrasada', PAID: 'Recebida', CANCELLED: 'Cancelada' } as const

// ───────────── Contas a pagar ─────────────

export const payableSchema = z.object({
  description: z.string().trim().min(3, 'Descreva a conta').max(150),
  supplierId: optionalId,
  category: text(60),
  documentNumber: text(60),
  amountCents: positiveCents,
  dueDate: day,
  recurrence: z.enum(['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY']).default('NONE'),
  notes: text(1000)
})
export const payableUpdateSchema = payableSchema.extend({ id })
export const payableListSchema = z.object({
  search: z.string().max(100).optional(),
  /** PENDING = todas em aberto (a vencer e atrasadas). */
  status: z.enum(['PENDING', 'OPEN', 'OVERDUE', 'PAID', 'CANCELLED']).optional(),
  supplierId: id.optional(),
  category: z.string().max(60).optional(),
  /** Período: vencimento (contas em aberto) ou pagamento (contas pagas). */
  from: day.optional(),
  to: day.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50)
})
export const payablePaySchema = z.object({
  id,
  requestId,
  paidCents: positiveCents,
  method: z.enum(FINANCE_METHODS, 'Forma de pagamento inválida'),
  paidAt: optionalDay,
  /** Dinheiro retirado da gaveta do caixa aberto (gera saída no caixa). */
  fromCash: z.boolean().default(false)
})
export const payableReverseSchema = z.object({ id, reason })
export const payableCancelSchema = z.object({ id, reason })

// ───────────── Contas a receber ─────────────

export const receivableSchema = z.object({
  description: z.string().trim().min(3, 'Descreva o valor a receber').max(150),
  customerId: optionalId,
  amountCents: positiveCents,
  firstDueDate: day,
  /** Divide o valor em parcelas mensais. */
  installments: z.number().int().min(1).max(36).default(1),
  notes: text(1000)
})
export const receivableUpdateSchema = z.object({ id, description: z.string().trim().min(3).max(150), dueDate: day, notes: text(1000) })
export const receivableListSchema = z.object({
  search: z.string().max(100).optional(),
  status: z.enum(['OPEN', 'PARTIAL', 'OVERDUE', 'PAID', 'CANCELLED', 'PENDING']).optional(),
  customerId: id.optional(),
  saleId: id.optional(),
  from: day.optional(),
  to: day.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50)
})
export const receivableReceiveSchema = z.object({
  id,
  requestId,
  /** Valor abatido da parcela. */
  amountCents: positiveCents,
  interestCents: cents.default(0),
  discountCents: cents.default(0),
  method: z.enum(FINANCE_METHODS, 'Forma de recebimento inválida'),
  paidAt: optionalDay
})
export const receivableReverseSchema = z.object({ paymentId: id, reason })
export const receivableCancelSchema = z.object({ id, reason })

export type PayableInput = z.input<typeof payableSchema>
export type PayableUpdateInput = z.input<typeof payableUpdateSchema>
export type PayableListInput = z.input<typeof payableListSchema>
export type PayablePayInput = z.input<typeof payablePaySchema>
export type ReceivableInput = z.input<typeof receivableSchema>
export type ReceivableUpdateInput = z.input<typeof receivableUpdateSchema>
export type ReceivableListInput = z.input<typeof receivableListSchema>
export type ReceivableReceiveInput = z.input<typeof receivableReceiveSchema>

// ───────────── Relatórios ─────────────

export const REPORTS = {
  'sales-daily': { label: 'Vendas por dia', group: 'Vendas', filters: ['period', 'category', 'product'] },
  'sales-monthly': { label: 'Vendas por mês', group: 'Vendas', filters: ['period', 'category', 'product'] },
  'payment-methods': { label: 'Vendas por forma de pagamento', group: 'Vendas', filters: ['period'] },
  discounts: { label: 'Descontos concedidos', group: 'Vendas', filters: ['period'] },
  cancellations: { label: 'Cancelamentos e devoluções', group: 'Vendas', filters: ['period'] },
  operators: { label: 'Desempenho dos operadores', group: 'Vendas', filters: ['period'] },
  'products-top': { label: 'Produtos mais vendidos', group: 'Produtos', filters: ['period', 'category', 'product'] },
  'products-bottom': { label: 'Produtos menos vendidos', group: 'Produtos', filters: ['period', 'category', 'product'] },
  stock: { label: 'Posição de estoque', group: 'Estoque', filters: ['category', 'product'] },
  'stock-movements': { label: 'Movimentações de estoque', group: 'Estoque', filters: ['period', 'category', 'product'] },
  'cash-flow': { label: 'Fluxo de caixa', group: 'Financeiro', filters: ['period'] },
  payables: { label: 'Contas a pagar', group: 'Financeiro', filters: ['period'] },
  receivables: { label: 'Contas a receber', group: 'Financeiro', filters: ['period'] }
} as const satisfies Record<string, { label: string; group: string; filters: readonly ('period' | 'category' | 'product')[] }>
export type ReportKey = keyof typeof REPORTS

export const reportSchema = z
  .object({
    key: z.enum(Object.keys(REPORTS) as [ReportKey, ...ReportKey[]]),
    from: day,
    to: day,
    categoryId: optionalId,
    productId: optionalId
  })
  .refine((v) => v.from <= v.to, { message: 'A data inicial deve ser anterior à final', path: ['to'] })
export const reportExportSchema = z.object({ report: reportSchema, format: z.enum(['csv', 'xlsx', 'pdf']) })

export type ReportInput = z.input<typeof reportSchema>
export type ReportExportInput = z.input<typeof reportExportSchema>
