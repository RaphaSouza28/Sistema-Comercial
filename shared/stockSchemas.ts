import { z } from 'zod'

const id = z.number().int().positive()
const optionalId = id.nullish().transform((v) => v ?? null)
const positiveMilli = z.number().int('Quantidade inválida').positive('Informe uma quantidade maior que zero').max(1_000_000_000)
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null))
/** Identificador gerado pela tela a cada envio: repetir o envio não duplica a operação. */
const requestId = z.string().uuid('Requisição inválida')

export const EXIT_REASONS = {
  LOSS: 'Perda',
  DAMAGE: 'Avaria',
  EXPIRED: 'Vencimento',
  INTERNAL_USE: 'Uso/consumo interno',
  SUPPLIER_RETURN: 'Devolução ao fornecedor',
  GIFT: 'Brinde/doação',
  OTHER: 'Outro motivo'
} as const
export type ExitReason = keyof typeof EXIT_REASONS

export const stockEntrySchema = z.object({
  requestId,
  supplierId: optionalId,
  documentNumber: text(60),
  notes: text(500),
  /** Como atualizar o custo do produto: manter, último custo de compra ou custo médio ponderado. */
  costUpdate: z.enum(['none', 'last', 'average']).default('none'),
  items: z
    .array(
      z.object({
        productId: id,
        variantId: optionalId,
        quantityMilli: positiveMilli,
        unitCostCents: z.number().int().min(0, 'Custo inválido').max(2_000_000_000).nullish().transform((v) => v ?? null)
      })
    )
    .min(1, 'Adicione ao menos um item')
    .max(500, 'Máximo de 500 itens por entrada')
})

export const stockExitSchema = z.object({
  requestId,
  reason: z.enum(Object.keys(EXIT_REASONS) as [ExitReason, ...ExitReason[]], 'Selecione o motivo'),
  notes: text(500),
  items: z
    .array(z.object({ productId: id, variantId: optionalId, quantityMilli: positiveMilli }))
    .min(1, 'Adicione ao menos um item')
    .max(500)
}).refine((v) => v.reason !== 'OTHER' || !!v.notes, { message: 'Descreva o motivo', path: ['notes'] })

export const stockAdjustSchema = z.object({
  requestId,
  productId: id,
  variantId: optionalId,
  newQuantityMilli: z.number().int('Quantidade inválida').min(0, 'A quantidade não pode ser negativa').max(1_000_000_000),
  reason: z.string().trim().min(3, 'Informe o motivo do ajuste').max(300)
})

export const stockOverviewSchema = z.object({
  search: z.string().max(100).optional(),
  categoryId: id.optional(),
  status: z.enum(['all', 'low', 'out', 'stale', 'negative']).default('all'),
  /** Dias sem movimentação para o filtro "sem movimentação". */
  staleDays: z.number().int().min(1).max(3650).default(90),
  includeInactive: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(500).default(50),
  sort: z.enum(['name', 'stock', 'value', 'lastMovement']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc')
})

export const MOVEMENT_TYPES = ['INITIAL', 'ENTRY', 'EXIT', 'SALE', 'SALE_CANCEL', 'RETURN', 'ADJUSTMENT', 'INVENTORY'] as const

export const stockMovementsSchema = z.object({
  productId: id.optional(),
  variantId: id.optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
  userId: id.optional(),
  /** "AAAA-MM-DD" inclusivo */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  search: z.string().max(100).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(500).default(50)
})

export const stockSearchSchema = z.object({
  query: z.string().trim().min(1).max(100),
  limit: z.number().int().min(1).max(50).default(20)
})

export const inventoryCreateSchema = z.object({
  name: z.string().trim().min(2, 'Informe uma descrição').max(80),
  categoryId: optionalId,
  notes: text(500)
})

export const inventoryCountsSchema = z.object({
  inventoryId: id,
  counts: z
    .array(z.object({ itemId: id, countedMilli: z.number().int().min(0, 'Quantidade inválida').max(1_000_000_000).nullable() }))
    .max(20000)
})

export const inventoryIdSchema = z.object({ inventoryId: id })

export type StockEntryInput = z.input<typeof stockEntrySchema>
export type StockExitInput = z.input<typeof stockExitSchema>
export type StockAdjustInput = z.input<typeof stockAdjustSchema>
export type StockOverviewInput = z.input<typeof stockOverviewSchema>
export type StockMovementsInput = z.input<typeof stockMovementsSchema>
export type StockSearchInput = z.input<typeof stockSearchSchema>
export type InventoryCreateInput = z.input<typeof inventoryCreateSchema>
export type InventoryCountsInput = z.input<typeof inventoryCountsSchema>
