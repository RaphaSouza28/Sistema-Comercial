/** Rótulos em português para enums do banco. */

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  DEBIT_CARD: 'Cartão de débito',
  CREDIT_CARD: 'Cartão de crédito',
  STORE_CREDIT: 'Crediário',
  VOUCHER: 'Vale-troca',
  OTHER: 'Outros'
}

export const STOCK_MOVEMENT_LABELS = {
  INITIAL: 'Estoque inicial',
  ENTRY: 'Entrada',
  EXIT: 'Saída',
  SALE: 'Venda',
  SALE_CANCEL: 'Cancelamento',
  RETURN: 'Devolução',
  ADJUSTMENT: 'Ajuste',
  INVENTORY: 'Inventário'
} as const

export const REFUND_METHOD_LABELS: Record<string, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  CARD: 'Cartão',
  VOUCHER: 'Vale-troca',
  STORE_CREDIT: 'Abatido do crediário',
  NONE: 'Sem reembolso'
}

export const MONTH_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "2026-10" -> "out/26" */
export function monthLabel(key: string): string {
  const [y, m] = key.split('-')
  return `${MONTH_SHORT[Number(m) - 1]}/${y.slice(2)}`
}

/** "2026-10-05" -> "05/10" */
export function dayLabel(key: string): string {
  const [, m, d] = key.split('-')
  return `${d}/${m}`
}
