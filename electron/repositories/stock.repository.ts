import type { DbClient } from '../database/connection'

/**
 * Registra o estoque inicial de um produto ou variação como movimentação rastreável.
 * A chave de idempotência impede que o estoque inicial seja lançado duas vezes.
 */
export function recordInitialStock(
  db: DbClient,
  data: { productId: number; variantId?: number | null; quantityMilli: number; unitCostCents: number | null; userId: number }
) {
  const key = data.variantId ? `INITIAL:V${data.variantId}` : `INITIAL:P${data.productId}`
  return db.stockMovement.create({
    data: {
      productId: data.productId,
      variantId: data.variantId ?? null,
      type: 'INITIAL',
      quantityMilli: data.quantityMilli,
      balanceAfterMilli: data.quantityMilli,
      unitCostCents: data.unitCostCents,
      reason: 'Estoque inicial no cadastro',
      referenceType: 'PRODUCT',
      referenceId: String(data.productId),
      idempotencyKey: key,
      userId: data.userId
    }
  })
}
