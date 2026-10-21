import type { FiscalPayload } from '@shared/api'

/**
 * Contrato de integração com um provedor fiscal homologado (ex.: serviços de emissão de NF-e/NFC-e
 * por API). O provedor é quem assina com o certificado digital, transmite à SEFAZ e devolve o XML
 * autorizado e o DANFE. Para integrar um provedor:
 *   1. implemente esta interface (chamadas HTTP do provedor, com as credenciais do cliente);
 *   2. registre-o em FISCAL_PROVIDERS (shared/integrationSchemas.ts) e em createFiscalProviders();
 *   3. homologue no ambiente de homologação da SEFAZ antes de usar em produção.
 * Este sistema nunca marca uma nota como autorizada sem a resposta de um provedor real.
 */
export interface FiscalDocumentRef {
  id: number
  type: 'NFE' | 'NFCE'
  environment: string
  series: number | null
  number: number | null
  accessKey: string | null
  payload: FiscalPayload
}

export interface FiscalResult {
  status: 'AUTHORIZED' | 'REJECTED' | 'PROCESSING' | 'ERROR'
  message: string
  number?: number
  accessKey?: string
  protocol?: string
  /** XML autorizado (procNFe) e DANFE em PDF, quando o provedor os devolve. */
  xml?: string
  danfePdf?: Buffer
}

export interface FiscalProvider {
  readonly key: string
  readonly label: string
  emit(doc: FiscalDocumentRef): Promise<FiscalResult>
  query(doc: FiscalDocumentRef): Promise<FiscalResult>
  cancel(doc: FiscalDocumentRef, reason: string): Promise<{ ok: boolean; protocol?: string; message: string }>
}

/** Provedores integrados nesta versão: nenhum (a chave NONE desativa a emissão). */
export function createFiscalProviders(): Record<string, FiscalProvider> {
  return {}
}
