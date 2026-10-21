/**
 * Contrato para integrar um provedor TEF homologado (pinpad/adquirente). O provedor inicia a
 * transação, devolve o status e os comprovantes; este sistema grava apenas NSU, autorização,
 * bandeira e os 4 últimos dígitos — nunca o número completo do cartão.
 */
export interface TefProvider {
  readonly key: string
  readonly label: string
  start(input: { amountCents: number; method: 'DEBIT_CARD' | 'CREDIT_CARD' | 'PIX'; installments: number; reference: string }): Promise<{ transactionId: string }>
  status(transactionId: string): Promise<{
    status: 'PENDING' | 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'ERROR'
    message: string
    nsu?: string
    authorizationCode?: string
    cardBrand?: string
    cardLast4?: string
    merchantReceipt?: string
    customerReceipt?: string
  }>
  cancel(transactionId: string): Promise<{ ok: boolean; message: string }>
}

/** Provedores TEF integrados nesta versão: nenhum (cartões e PIX são registrados manualmente). */
export function createTefProviders(): Record<string, TefProvider> {
  return {}
}
