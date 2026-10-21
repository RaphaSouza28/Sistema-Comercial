import { z } from 'zod'
import { isValidCpfOrCnpj, onlyDigits } from './documents'
import { UNIT_CODES } from './units'

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Máximo de ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : null))

const digits = (len: number | number[], label: string) =>
  z
    .string()
    .nullish()
    .transform((v) => (v ? onlyDigits(v) : ''))
    .refine((v) => v === '' || (Array.isArray(len) ? len : [len]).includes(v.length), `${label} inválido`)
    .transform((v) => (v ? v : null))

/** Códigos (SKU, código de barras, código interno): sem espaços, até 50 caracteres. */
const code = z
  .string()
  .trim()
  .max(50, 'Máximo de 50 caracteres')
  .regex(/^[A-Za-z0-9._\-/]*$/, 'Use apenas letras, números, ponto, hífen, barra ou sublinhado')
  .nullish()
  .transform((v) => (v ? v : null))

const cents = z.number().int('Valor inválido').min(0, 'O valor não pode ser negativo').max(2_000_000_000, 'Valor muito alto')
const optionalCents = cents.nullish().transform((v) => v ?? null)
const bps = z.number().int().min(0, 'Mínimo 0%').max(10000, 'Máximo 100%')
const optionalBps = bps.nullish().transform((v) => v ?? null)
const milli = z.number().int('Quantidade inválida').min(0, 'A quantidade não pode ser negativa').max(1_000_000_000)
const id = z.number().int().positive()
const optionalId = id.nullish().transform((v) => v ?? null)
/** Data "AAAA-MM-DD". */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida')
  .nullish()
  .transform((v) => (v ? v : null))

// ───────────── Categorias ─────────────

export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome').max(60, 'Máximo de 60 caracteres'),
  parentId: optionalId,
  defaultMarginBps: optionalBps
})
export const categoryUpdateSchema = categorySchema.extend({ id, active: z.boolean() })

// ───────────── Fornecedores ─────────────

export const supplierSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome ou razão social').max(150),
  tradeName: text(150),
  document: z
    .string()
    .nullish()
    .transform((v) => (v ? onlyDigits(v) : null))
    .refine((v) => v === null || isValidCpfOrCnpj(v), 'CPF/CNPJ inválido'),
  phone: digits([10, 11, 12, 13], 'Telefone'),
  email: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || z.email().safeParse(v).success, 'E-mail inválido'),
  contactName: text(100),
  zipCode: digits(8, 'CEP'),
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
  notes: text(1000)
})
export const supplierUpdateSchema = supplierSchema.extend({ id, active: z.boolean() })
export const supplierListSchema = z.object({
  search: z.string().max(100).optional(),
  includeInactive: z.boolean().optional()
})

// ───────────── Produtos ─────────────

const variantOptionSchema = z.object({
  name: z.string().trim().min(1, 'Informe o nome da variação').max(30),
  values: z.array(z.string().trim().min(1).max(30)).min(1, 'Informe ao menos um valor').max(50)
})

export const variantInputSchema = z.object({
  id: optionalId,
  attributes: z.record(z.string().max(30), z.string().trim().min(1).max(30)),
  sku: code,
  barcode: code,
  costCents: optionalCents,
  salePriceCents: optionalCents,
  minStockMilli: milli.default(0),
  /** Somente para variações novas: gera movimentação de estoque inicial. */
  initialStockMilli: milli.default(0),
  active: z.boolean().default(true)
})

/** Campos de custo: só podem ser enviados/alterados com a permissão products.cost. */
const costFields = {
  costCents: cents.optional(),
  freightCents: cents.optional(),
  packagingCents: cents.optional(),
  otherCostsCents: cents.optional(),
  taxBps: optionalBps.optional(),
  cardFeeBps: optionalBps.optional(),
  commissionBps: optionalBps.optional(),
  targetMarginBps: optionalBps.optional()
}

/** Campos de preço: alteração exige products.price. */
const priceFields = {
  pricingMode: z.enum(['MANUAL', 'AUTOMATIC']).optional(),
  salePriceCents: cents.optional(),
  promoPriceCents: optionalCents.optional(),
  promoStartsAt: isoDate.optional(),
  promoEndsAt: isoDate.optional(),
  wholesalePriceCents: optionalCents.optional(),
  wholesaleMinMilli: milli.nullish().optional()
}

const productBase = z.object({
  internalCode: code,
  sku: code,
  barcode: code,
  name: z.string().trim().min(2, 'Informe o nome do produto').max(150, 'Máximo de 150 caracteres'),
  description: text(2000),
  categoryId: optionalId,
  subcategoryId: optionalId,
  brand: text(60),
  supplierId: optionalId,
  unit: z.enum(UNIT_CODES, 'Unidade inválida').default('UN'),
  minStockMilli: milli.default(0),
  allowNegativeStock: z.boolean().default(false),
  /** Serviço: não controla estoque (sem variações nem estoque inicial). */
  isService: z.boolean().optional(),
  ncm: digits(8, 'NCM'),
  cest: digits(7, 'CEST'),
  cfop: digits(4, 'CFOP'),
  taxOrigin: z
    .string()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[0-8]$/.test(v), 'Origem inválida'),
  /** CST (2 dígitos) ou CSOSN (3 dígitos) do ICMS. */
  taxCode: z
    .string()
    .trim()
    .nullish()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{2,3}$/.test(v), 'CST (2 dígitos) ou CSOSN (3 dígitos)'),
  active: z.boolean().default(true),
  hasVariants: z.boolean().default(false),
  variantOptions: z.array(variantOptionSchema).max(3, 'Máximo de 3 tipos de variação').default([]),
  variants: z.array(variantInputSchema).max(300, 'Máximo de 300 variações').default([]),
  priceChangeReason: text(200),
  ...costFields,
  ...priceFields
})

export const productCreateSchema = productBase.extend({
  /** Estoque inicial (produto sem variações): gera movimentação rastreável. */
  initialStockMilli: milli.default(0)
})
export const productUpdateSchema = productBase.extend({ id })

export const productQuickCreateSchema = z.object({
  name: z.string().trim().min(2, 'Informe o nome do produto').max(150),
  categoryId: optionalId,
  unit: z.enum(UNIT_CODES).default('UN'),
  costCents: cents.optional(),
  salePriceCents: cents,
  initialStockMilli: milli.default(0)
})

export const productListSchema = z.object({
  search: z.string().max(100).optional(),
  categoryId: id.optional(),
  supplierId: id.optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  stock: z.enum(['all', 'low', 'out']).default('all'),
  promo: z.boolean().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(10).max(200).default(50),
  sort: z.enum(['name', 'code', 'price', 'stock', 'createdAt']).default('name'),
  direction: z.enum(['asc', 'desc']).default('asc')
})

export const idSchema = z.object({ id })
export const setActiveSchema = z.object({ id, active: z.boolean() })

export const categoryPricingPreviewSchema = z.object({
  categoryId: id,
  marginBps: bps.optional()
})
export const categoryPricingApplySchema = z.object({
  categoryId: id,
  marginBps: bps,
  productIds: z.array(id).min(1, 'Selecione ao menos um produto').max(5000)
})

export const pricingSettingsSchema = z.object({
  minMarginBps: bps,
  defaultTargetMarginBps: bps,
  defaultTaxBps: bps,
  defaultCardFeeBps: bps,
  defaultCommissionBps: bps
})

export const importApplySchema = z.object({
  token: z.string().min(1),
  updateExisting: z.boolean().default(false)
})

export type CategoryInput = z.input<typeof categorySchema>
export type CategoryUpdateInput = z.input<typeof categoryUpdateSchema>
export type SupplierInput = z.input<typeof supplierSchema>
export type SupplierUpdateInput = z.input<typeof supplierUpdateSchema>
export type SupplierListInput = z.input<typeof supplierListSchema>
export type ProductCreateInput = z.input<typeof productCreateSchema>
export type ProductUpdateInput = z.input<typeof productUpdateSchema>
export type ProductQuickCreateInput = z.input<typeof productQuickCreateSchema>
export type ProductListInput = z.input<typeof productListSchema>
export type VariantInput = z.input<typeof variantInputSchema>
export type CategoryPricingPreviewInput = z.input<typeof categoryPricingPreviewSchema>
export type CategoryPricingApplyInput = z.input<typeof categoryPricingApplySchema>
export type PricingSettingsInput = z.input<typeof pricingSettingsSchema>
export type ImportApplyInput = z.input<typeof importApplySchema>
