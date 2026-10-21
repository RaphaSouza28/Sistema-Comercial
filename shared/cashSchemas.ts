import { z } from 'zod'

const id = z.number().int().positive()
const cents = z.number().int('Valor inválido').min(0, 'O valor não pode ser negativo').max(2_000_000_000)
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')

export const CASH_METHODS = ['CASH', 'PIX', 'DEBIT_CARD', 'CREDIT_CARD', 'OTHER'] as const
export type CashMethod = (typeof CASH_METHODS)[number]

export const MANUAL_MOVEMENTS = {
  SUPPLY: 'Suprimento',
  WITHDRAWAL: 'Sangria',
  OTHER_IN: 'Outra entrada',
  OTHER_OUT: 'Outra saída'
} as const
export type ManualMovementType = keyof typeof MANUAL_MOVEMENTS

export const cashMovementSchema = z.object({
  requestId: z.string().uuid('Requisição inválida'),
  type: z.enum(Object.keys(MANUAL_MOVEMENTS) as [ManualMovementType, ...ManualMovementType[]]),
  amountCents: z.number().int().positive('Informe um valor maior que zero').max(2_000_000_000),
  method: z.enum(CASH_METHODS).default('CASH'),
  description: z.string().trim().min(3, 'Descreva a movimentação').max(200)
})

export const cashCloseSchema = z.object({
  sessionId: id,
  countedCashCents: cents,
  /** Conferência opcional das demais formas (ex.: relatório da maquininha). */
  countedByMethod: z.partialRecord(z.enum(CASH_METHODS), cents).default({}),
  notes: z
    .string()
    .trim()
    .max(500)
    .nullish()
    .transform((v) => (v ? v : null))
})

export const cashSessionIdSchema = z.object({ sessionId: id })

export const cashHistorySchema = z.object({
  from: day.optional(),
  to: day.optional(),
  userId: id.optional(),
  status: z.enum(['OPEN', 'CLOSED']).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50)
})

export const cashDailySchema = z.object({ date: day })

export type CashMovementInput = z.input<typeof cashMovementSchema>
export type CashCloseInput = z.input<typeof cashCloseSchema>
export type CashHistoryInput = z.input<typeof cashHistorySchema>
