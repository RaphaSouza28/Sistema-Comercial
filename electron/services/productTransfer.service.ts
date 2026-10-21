import { randomUUID } from 'node:crypto'
import type { ImportPreview, ImportResult } from '@shared/api'
import { importApplySchema, productCreateSchema, productUpdateSchema } from '@shared/catalogSchemas'
import { formatQuantity, parseMoney } from '@shared/format'
import { normalizeSearch } from '@shared/text'
import { parseQuantity } from '@shared/units'
import type { Db, DbClient } from '../database/connection'
import { writeAudit } from '../repositories/audit.repository'
import { findProduct, type ProductDetailRow } from '../repositories/product.repository'
import { toCsv } from '../utils/csv'
import { AppError, notFound, validationError } from '../utils/errors'
import { requirePermission, type Actor } from './context'
import { parseJson, toDateKey } from './product.mappers'
import type { ProductService } from './product.service'

type ColumnKind = 'text' | 'money' | 'qty'
type Access = 'cost' | 'price' | null

interface Column {
  key: string
  header: string
  kind: ColumnKind
  access: Access
  aliases?: string[]
}

/** Colunas da planilha de produtos (cabeçalhos sem diferenciar maiúsculas, acentos ou espaços). */
export const COLUMNS: Column[] = [
  { key: 'internalCode', header: 'codigo', kind: 'text', access: null, aliases: ['codigo interno', 'cod'] },
  { key: 'sku', header: 'sku', kind: 'text', access: null },
  { key: 'barcode', header: 'codigo_barras', kind: 'text', access: null, aliases: ['ean', 'gtin', 'codigo de barras'] },
  { key: 'name', header: 'nome', kind: 'text', access: null, aliases: ['produto', 'descricao curta'] },
  { key: 'description', header: 'descricao', kind: 'text', access: null },
  { key: 'category', header: 'categoria', kind: 'text', access: null },
  { key: 'subcategory', header: 'subcategoria', kind: 'text', access: null },
  { key: 'brand', header: 'marca', kind: 'text', access: null },
  { key: 'supplier', header: 'fornecedor', kind: 'text', access: null },
  { key: 'unit', header: 'unidade', kind: 'text', access: null, aliases: ['un'] },
  { key: 'costCents', header: 'custo', kind: 'money', access: 'cost', aliases: ['preco de custo'] },
  { key: 'freightCents', header: 'frete', kind: 'money', access: 'cost' },
  { key: 'packagingCents', header: 'embalagem', kind: 'money', access: 'cost' },
  { key: 'otherCostsCents', header: 'outros_custos', kind: 'money', access: 'cost' },
  { key: 'salePriceCents', header: 'preco_venda', kind: 'money', access: 'price', aliases: ['preco', 'preco de venda'] },
  { key: 'promoPriceCents', header: 'preco_promocional', kind: 'money', access: 'price' },
  { key: 'wholesalePriceCents', header: 'preco_atacado', kind: 'money', access: 'price' },
  { key: 'wholesaleMinMilli', header: 'qtd_minima_atacado', kind: 'qty', access: 'price' },
  { key: 'initialStockMilli', header: 'estoque_inicial', kind: 'qty', access: null },
  { key: 'minStockMilli', header: 'estoque_minimo', kind: 'qty', access: null },
  { key: 'ncm', header: 'ncm', kind: 'text', access: null },
  { key: 'cest', header: 'cest', kind: 'text', access: null },
  { key: 'cfop', header: 'cfop', kind: 'text', access: null }
]

const headerKey = (h: string) => normalizeSearch(h).replace(/[\s_-]+/g, '')

interface ParsedRow {
  line: number
  values: Record<string, unknown>
  category: string | null
  subcategory: string | null
  supplierId: number | null
  existingId: number | null
  errors: string[]
  warnings: string[]
}

interface PendingImport {
  userId: number
  fileName: string
  rows: ParsedRow[]
  expiresAt: number
}

const IMPORT_TTL_MS = 30 * 60 * 1000
const MAX_ROWS = 10000

function formatCentsCsv(cents: number | null): string {
  return cents === null ? '' : (cents / 100).toFixed(2).replace('.', ',')
}

/** Converte o registro do banco no formato de entrada do serviço (para atualizar via planilha). */
function existingToInput(p: ProductDetailRow): Record<string, unknown> {
  return {
    id: p.id,
    internalCode: p.internalCode,
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    description: p.description,
    categoryId: p.categoryId,
    subcategoryId: p.subcategoryId,
    brand: p.brand,
    supplierId: p.supplierId,
    unit: p.unit,
    minStockMilli: p.minStockMilli,
    allowNegativeStock: p.allowNegativeStock,
    ncm: p.ncm,
    cest: p.cest,
    cfop: p.cfop,
    taxOrigin: p.taxOrigin,
    active: p.active,
    hasVariants: p.hasVariants,
    variantOptions: parseJson(p.variantOptions, []),
    variants: p.variants.map((v) => ({
      id: v.id,
      attributes: parseJson(v.attributes, {}),
      sku: v.sku,
      barcode: v.barcode,
      costCents: v.costCents,
      salePriceCents: v.salePriceCents,
      minStockMilli: v.minStockMilli,
      active: v.active
    })),
    promoStartsAt: toDateKey(p.promoStartsAt),
    promoEndsAt: toDateKey(p.promoEndsAt)
  }
}

/** Importação (com prévia) e exportação de produtos em CSV. */
export class ProductTransferService {
  private readonly pending = new Map<string, PendingImport>()

  constructor(
    private readonly db: Db,
    private readonly products: ProductService
  ) {}

  templateCsv(): string {
    return toCsv([
      COLUMNS.map((c) => c.header),
      ['', 'CAM-AZ-M', '7891234567895', 'Camiseta básica', 'Algodão 100%', 'Vestuário', 'Camisetas', 'Marca X', '', 'UN', '40,00', '5,00', '2,00', '0,00', '67,14', '', '', '', '10', '3', '', '', '']
    ])
  }

  async exportCsv(actorInput: Actor | null): Promise<{ csv: string; count: number }> {
    const actor = requirePermission(actorInput, 'products.view', 'products.manage')
    const canCost = actor.permissions.has('products.cost')
    const rows = await this.db.product.findMany({
      where: { deletedAt: null },
      include: { category: true, subcategory: true, supplier: true },
      orderBy: { name: 'asc' }
    })
    const columns = COLUMNS.filter((c) => canCost || c.access !== 'cost').filter((c) => c.key !== 'initialStockMilli')
    const header = [...columns.map((c) => c.header), 'estoque_atual', 'situacao']
    const body = rows.map((p) => {
      const values: Record<string, string> = {
        internalCode: p.internalCode,
        sku: p.sku ?? '',
        barcode: p.barcode ?? '',
        name: p.name,
        description: p.description ?? '',
        category: p.category?.name ?? '',
        subcategory: p.subcategory?.name ?? '',
        brand: p.brand ?? '',
        supplier: p.supplier?.name ?? '',
        unit: p.unit,
        costCents: formatCentsCsv(p.costCents),
        freightCents: formatCentsCsv(p.freightCents),
        packagingCents: formatCentsCsv(p.packagingCents),
        otherCostsCents: formatCentsCsv(p.otherCostsCents),
        salePriceCents: formatCentsCsv(p.salePriceCents),
        promoPriceCents: formatCentsCsv(p.promoPriceCents),
        wholesalePriceCents: formatCentsCsv(p.wholesalePriceCents),
        wholesaleMinMilli: p.wholesaleMinMilli === null ? '' : formatQuantity(p.wholesaleMinMilli),
        minStockMilli: formatQuantity(p.minStockMilli),
        ncm: p.ncm ?? '',
        cest: p.cest ?? '',
        cfop: p.cfop ?? ''
      }
      return [...columns.map((c) => values[c.key] ?? ''), formatQuantity(p.stockMilli), p.active ? 'Ativo' : 'Inativo']
    })
    await writeAudit(this.db, { userId: actor.userId, action: 'product.export', details: { count: rows.length } })
    return { csv: toCsv([header, ...body]), count: rows.length }
  }

  /** Valida a planilha e guarda o resultado para confirmação. Nada é gravado aqui. */
  async preview(actorInput: Actor | null, rows: string[][], fileName: string): Promise<ImportPreview> {
    const actor = requirePermission(actorInput, 'products.manage')
    this.purgeExpired()
    if (rows.length < 2) throw validationError('A planilha está vazia. A primeira linha deve conter os cabeçalhos.')
    if (rows.length - 1 > MAX_ROWS) throw validationError(`A planilha tem mais de ${MAX_ROWS} linhas. Divida em arquivos menores.`)

    const header = rows[0].map(headerKey)
    const index = new Map<string, number>()
    for (const col of COLUMNS) {
      const names = [col.header, ...(col.aliases ?? [])].map(headerKey)
      const pos = header.findIndex((h) => names.includes(h))
      if (pos >= 0) index.set(col.key, pos)
    }
    if (!index.has('name')) throw validationError('Coluna "nome" não encontrada. Use o modelo de planilha.')

    const canCost = actor.permissions.has('products.cost')
    const canPrice = actor.permissions.has('products.price')
    const [suppliers, existingCodes] = await Promise.all([
      this.db.supplier.findMany({ where: { deletedAt: null }, select: { id: true, name: true, tradeName: true } }),
      this.db.product.findMany({ where: { deletedAt: null }, select: { id: true, internalCode: true, sku: true, barcode: true } })
    ])
    const codeOwner = new Map<string, number>()
    for (const p of existingCodes) for (const c of [p.internalCode, p.sku, p.barcode]) if (c) codeOwner.set(c, p.id)
    const seenInFile = new Map<string, number>()

    const parsed: ParsedRow[] = rows.slice(1).map((cells, i) => {
      const line = i + 2
      const row: ParsedRow = { line, values: {}, category: null, subcategory: null, supplierId: null, existingId: null, errors: [], warnings: [] }
      const raw = (key: string) => {
        const pos = index.get(key)
        return pos === undefined ? '' : (cells[pos] ?? '').trim()
      }
      for (const col of COLUMNS) {
        const value = raw(col.key)
        if (!value || ['category', 'subcategory', 'supplier'].includes(col.key)) continue
        if (col.access === 'cost' && !canCost) {
          row.errors.push(`Sem permissão para importar custos (coluna "${col.header}")`)
          continue
        }
        if (col.access === 'price' && !canPrice) {
          row.errors.push(`Sem permissão para importar preços (coluna "${col.header}")`)
          continue
        }
        if (col.kind === 'money') {
          const cents = parseMoney(value)
          if (cents === null || cents < 0) row.errors.push(`Valor inválido em "${col.header}": ${value}`)
          else row.values[col.key] = cents
        } else if (col.kind === 'qty') {
          const milli = parseQuantity(value)
          if (milli === null || milli < 0) row.errors.push(`Quantidade inválida em "${col.header}": ${value}`)
          else row.values[col.key] = milli
        } else {
          row.values[col.key] = col.key === 'unit' ? value.toUpperCase() : value
        }
      }
      row.category = raw('category') || null
      row.subcategory = raw('subcategory') || null
      if (row.subcategory && !row.category) row.errors.push('Subcategoria informada sem categoria')

      const supplierName = raw('supplier')
      if (supplierName) {
        const key = normalizeSearch(supplierName)
        const s = suppliers.find((x) => normalizeSearch(x.name) === key || normalizeSearch(x.tradeName) === key)
        if (s) row.supplierId = s.id
        else row.warnings.push(`Fornecedor "${supplierName}" não cadastrado — o produto ficará sem fornecedor`)
      }

      // Produto existente: casado por código interno, SKU ou código de barras
      const owners = new Set(
        ['internalCode', 'sku', 'barcode']
          .map((k) => row.values[k] as string | undefined)
          .filter((c): c is string => !!c)
          .map((c) => codeOwner.get(c))
          .filter((id): id is number => id !== undefined)
      )
      if (owners.size > 1) row.errors.push('Os códigos desta linha pertencem a produtos diferentes')
      row.existingId = owners.size === 1 ? [...owners][0] : null

      for (const k of ['internalCode', 'sku', 'barcode']) {
        const c = row.values[k] as string | undefined
        if (!c) continue
        const prev = seenInFile.get(c)
        if (prev) row.errors.push(`Código "${c}" repetido (linha ${prev})`)
        else seenInFile.set(c, line)
      }

      if (!row.existingId) {
        const check = productCreateSchema.safeParse({ ...row.values, categoryId: null, subcategoryId: null })
        if (!check.success) row.errors.push(...check.error.issues.map((e) => `${e.path.join('.') || 'linha'}: ${e.message}`))
      } else if (row.values.initialStockMilli) {
        row.warnings.push('Estoque inicial ignorado para produto já cadastrado (use movimentações de estoque)')
      }
      if (!row.values.name && !row.existingId) row.errors.push('Informe o nome do produto')
      return row
    })

    const token = randomUUID()
    this.pending.set(token, { userId: actor.userId, fileName, rows: parsed, expiresAt: Date.now() + IMPORT_TTL_MS })
    return {
      token,
      fileName,
      total: parsed.length,
      createCount: parsed.filter((r) => !r.errors.length && !r.existingId).length,
      updateCount: parsed.filter((r) => !r.errors.length && r.existingId).length,
      errorCount: parsed.filter((r) => r.errors.length).length,
      rows: parsed.map((r) => ({
        line: r.line,
        action: r.errors.length ? 'error' : r.existingId ? 'update' : 'create',
        code: (r.values.internalCode ?? r.values.sku ?? r.values.barcode ?? null) as string | null,
        name: (r.values.name ?? null) as string | null,
        messages: [...r.errors, ...r.warnings]
      }))
    }
  }

  /**
   * Grava a importação confirmada. Cada linha é aplicada em sua própria transação:
   * uma linha com problema não impede as demais, e o erro é informado.
   */
  async apply(actorInput: Actor | null, input: unknown): Promise<ImportResult> {
    const actor = requirePermission(actorInput, 'products.manage')
    const { token, updateExisting } = importApplySchema.parse(input)
    const pending = this.pending.get(token)
    if (!pending || pending.expiresAt < Date.now() || pending.userId !== actor.userId) {
      throw notFound('A prévia da importação expirou. Selecione o arquivo novamente.')
    }
    this.pending.delete(token) // impede aplicar a mesma importação duas vezes

    const result: ImportResult = { created: 0, updated: 0, skipped: 0, errors: [] }
    for (const row of pending.rows) {
      if (row.errors.length || (row.existingId && !updateExisting)) {
        result.skipped++
        continue
      }
      try {
        await this.db.$transaction(async (tx) => {
          const categories = await this.ensureCategories(tx, actor, row)
          if (row.existingId) {
            const existing = await findProduct(tx, row.existingId)
            if (!existing) throw notFound('Produto não encontrado.')
            const { initialStockMilli: _ignored, ...values } = row.values
            const data = productUpdateSchema.parse({
              ...existingToInput(existing),
              ...values,
              ...(categories ? categories : {}),
              ...(row.supplierId ? { supplierId: row.supplierId } : {})
            })
            await this.products.updateInTx(tx, actor, existing, data, `Importação de planilha (${pending.fileName})`)
            result.updated++
          } else {
            const data = productCreateSchema.parse({ ...row.values, ...(categories ?? {}), supplierId: row.supplierId })
            await this.products.createInTx(tx, actor, data, `Importação de planilha (${pending.fileName})`)
            result.created++
          }
        })
      } catch (error) {
        const message =
          error instanceof AppError ? error.message : error instanceof Error && 'issues' in error ? 'Dados inválidos' : 'Erro inesperado'
        result.errors.push({ line: row.line, message })
        result.skipped++
      }
    }
    await writeAudit(this.db, {
      userId: actor.userId,
      action: 'product.import',
      details: { file: pending.fileName, created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors.length }
    })
    return result
  }

  /** Encontra (ou cria) categoria e subcategoria pelo nome. */
  private async ensureCategories(
    tx: DbClient,
    actor: Actor,
    row: ParsedRow
  ): Promise<{ categoryId: number; subcategoryId: number | null } | null> {
    if (!row.category) return null
    const findOrCreate = async (name: string, parentId: number | null) => {
      const siblings = await tx.category.findMany({ where: { parentId } })
      const found = siblings.find((c) => normalizeSearch(c.name) === normalizeSearch(name))
      if (found) return found.id
      const created = await tx.category.create({ data: { name: name.slice(0, 60), parentId } })
      await writeAudit(tx, { userId: actor.userId, action: 'category.create', entity: 'Category', entityId: created.id, details: { name, via: 'import' } })
      return created.id
    }
    const categoryId = await findOrCreate(row.category, null)
    const subcategoryId = row.subcategory ? await findOrCreate(row.subcategory, categoryId) : null
    return { categoryId, subcategoryId }
  }

  private purgeExpired(): void {
    const now = Date.now()
    for (const [k, v] of this.pending) if (v.expiresAt < now) this.pending.delete(k)
  }
}
