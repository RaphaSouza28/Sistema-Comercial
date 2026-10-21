import { formatQuantity } from '@shared/format'
import { totalUnitCost } from '@shared/pricing'
import { isFractionalUnit } from '@shared/units'
import type { DbClient } from '../database/connection'
import type { StockMovementType } from '../database/generated/client'
import { getSetting } from '../repositories/setting.repository'
import { conflict, notFound, validationError } from '../utils/errors'

export const ALLOW_NEGATIVE_SETTING = 'stock.allowNegative'

export interface MoveStockInput {
  productId: number
  variantId: number | null
  type: StockMovementType
  /** Positivo = entrada; negativo = saída. */
  quantityMilli: number
  reason: string | null
  referenceType: string
  referenceId: string
  /** Mesma chave = mesma operação: a segunda chamada não altera o estoque. */
  idempotencyKey: string
  userId: number
  unitCostCents?: number | null
  supplierId?: number | null
  documentNumber?: string | null
  /** Ignora a trava de estoque negativo (ex.: estornos e inventário, que não reduzem abaixo de zero). */
  allowNegative?: boolean
}

export interface MoveStockResult {
  duplicate: boolean
  movementId: number
  balanceBeforeMilli: number
  balanceAfterMilli: number
}

/**
 * Única forma de alterar saldo de estoque. Deve ser chamada dentro de uma transação:
 *  - impede lançamento duplicado (chave de idempotência);
 *  - valida produto/variação e unidade fracionável;
 *  - impede estoque negativo não autorizado (produto ou configuração geral);
 *  - atualiza o saldo da variação e o total do produto;
 *  - registra a movimentação com saldo resultante, usuário, motivo e referência.
 */
export async function moveStock(tx: DbClient, input: MoveStockInput): Promise<MoveStockResult> {
  const existing = await tx.stockMovement.findUnique({ where: { idempotencyKey: input.idempotencyKey } })
  if (existing) {
    return {
      duplicate: true,
      movementId: existing.id,
      balanceBeforeMilli: existing.balanceAfterMilli - existing.quantityMilli,
      balanceAfterMilli: existing.balanceAfterMilli
    }
  }
  if (input.quantityMilli === 0) throw validationError('A quantidade da movimentação não pode ser zero.')

  const product = await tx.product.findFirst({ where: { id: input.productId, deletedAt: null } })
  if (!product) throw notFound('Produto não encontrado.')
  if (product.isService) throw validationError(`"${product.name}" é um serviço e não controla estoque.`)
  if (product.hasVariants && input.variantId === null) {
    throw validationError(`Selecione a variação de "${product.name}".`)
  }
  if (!product.hasVariants && input.variantId !== null) {
    throw validationError(`O produto "${product.name}" não possui variações.`)
  }
  const variant = input.variantId
    ? await tx.productVariant.findFirst({ where: { id: input.variantId, productId: product.id, deletedAt: null } })
    : null
  if (input.variantId && !variant) throw notFound('Variação não encontrada.')
  if (!isFractionalUnit(product.unit) && input.quantityMilli % 1000 !== 0) {
    throw validationError(`A unidade ${product.unit} de "${product.name}" não aceita quantidades fracionadas.`)
  }

  const label = variant ? `${product.name} — ${variant.name}` : product.name
  const before = variant ? variant.stockMilli : product.stockMilli
  const after = before + input.quantityMilli
  if (input.quantityMilli < 0 && after < 0 && !input.allowNegative && !product.allowNegativeStock) {
    const globalAllow = await getSetting<boolean>(tx, ALLOW_NEGATIVE_SETTING, false)
    if (!globalAllow) {
      throw conflict(
        `Estoque insuficiente de "${label}": disponível ${formatQuantity(before)} ${product.unit}, ` +
          `necessário ${formatQuantity(-input.quantityMilli)} ${product.unit}.`
      )
    }
  }

  if (variant) {
    await tx.productVariant.update({ where: { id: variant.id }, data: { stockMilli: { increment: input.quantityMilli } } })
  }
  await tx.product.update({ where: { id: product.id }, data: { stockMilli: { increment: input.quantityMilli } } })

  const defaultCost = totalUnitCost({ ...product, costCents: variant?.costCents ?? product.costCents })
  const movement = await tx.stockMovement.create({
    data: {
      productId: product.id,
      variantId: variant?.id ?? null,
      type: input.type,
      quantityMilli: input.quantityMilli,
      balanceAfterMilli: after,
      unitCostCents: input.unitCostCents ?? defaultCost,
      reason: input.reason,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      supplierId: input.supplierId ?? null,
      documentNumber: input.documentNumber ?? null,
      userId: input.userId
    }
  })
  return { duplicate: false, movementId: movement.id, balanceBeforeMilli: before, balanceAfterMilli: after }
}
