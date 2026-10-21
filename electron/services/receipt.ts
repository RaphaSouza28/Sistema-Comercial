import type { CashSessionDetail, CompanyDto, SaleDetail } from '@shared/api'
import type { DevicesSettings } from '@shared/deviceSchemas'
import { formatDocument, formatPhone } from '@shared/documents'
import { formatDate, formatDateTime, formatMoney, formatQuantity } from '@shared/format'

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Dinheiro',
  PIX: 'PIX',
  DEBIT_CARD: 'Cartão de débito',
  CREDIT_CARD: 'Cartão de crédito',
  VOUCHER: 'Vale-troca',
  STORE_CREDIT: 'Crediário',
  OTHER: 'Outros'
}
const REFUND_LABEL: Record<string, string> = {
  CASH: 'Dinheiro',
  PIX: 'Estorno por PIX',
  CARD: 'Estorno no cartão',
  VOUCHER: 'Vale-troca',
  STORE_CREDIT: 'Abatido do crediário',
  NONE: 'Sem reembolso'
}

/** Relatório de fechamento (ou parcial) de uma sessão de caixa, em 80 mm. */
export function buildCashReportHtml(company: CompanyDto | null, s: CashSessionDetail): string {
  const name = company ? `<div class="center strong big">${esc(company.tradeName || company.legalName)}</div>` : ''
  const methods = s.summary.byMethod.filter((m) => m.expectedCents !== 0 || m.countedCents !== null || m.method === 'CASH')
  const lines = (label: string, v: number) => (v ? row(esc(label), esc(formatMoney(v))) : '')
  const blocks = methods
    .map(
      (m) =>
        `<div class="strong">${esc(PAYMENT_LABEL[m.method] ?? m.method)}</div>` +
        lines('Abertura', m.openingCents) +
        lines('Vendas', m.salesCents) +
        lines('Cancelamentos', m.cancelsCents) +
        lines('Reembolsos', m.refundsCents) +
        lines('Suprimentos', m.suppliesCents) +
        lines('Sangrias', m.withdrawalsCents) +
        lines('Outras entradas', m.otherInCents) +
        lines('Outras saídas', m.otherOutCents) +
        row('Esperado', esc(formatMoney(m.expectedCents)), true) +
        (m.countedCents !== null ? row('Contado', esc(formatMoney(m.countedCents))) + row('Diferença', esc(formatMoney(m.differenceCents ?? 0)), true) : '') +
        '<hr>'
    )
    .join('')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Caixa</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  body { margin: 0; width: 74mm; font: 11px/1.35 'Consolas', 'Courier New', monospace; color: #000; }
  .center { text-align: center; } .strong { font-weight: 700; } .big { font-size: 14px; } .small { font-size: 10px; }
  .row { display: flex; justify-content: space-between; gap: 8px; } .row span:last-child { white-space: nowrap; }
  hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
</style></head><body>
${name}
<div class="center strong">${s.status === 'CLOSED' ? 'FECHAMENTO' : 'RELATÓRIO PARCIAL'} DE CAIXA Nº ${s.id}</div>
<hr>
${row('Operador', esc(s.userName))}
${row('Abertura', esc(formatDateTime(s.openedAt)))}
${s.closedAt ? row('Fechamento', esc(formatDateTime(s.closedAt))) : ''}
${s.closedByName && s.closedByName !== s.userName ? row('Fechado por', esc(s.closedByName)) : ''}
${row('Vendas', `${s.summary.salesCount} · ${esc(formatMoney(s.summary.salesTotalCents))}`)}
${s.summary.cancelledCount ? row('Vendas canceladas', String(s.summary.cancelledCount)) : ''}
${s.summary.returnsCount ? row('Devoluções', String(s.summary.returnsCount)) : ''}
<hr>
${blocks}
${s.notes ? `<div class="small">Observações: ${esc(s.notes)}</div><hr>` : ''}
<div class="center small">NÃO É DOCUMENTO FISCAL</div>
<br><br><div class="center small">______________________________<br>Assinatura do operador</div>
</body></html>`
}

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const row = (left: string, right: string, strong = false) =>
  `<div class="row${strong ? ' strong' : ''}"><span>${left}</span><span>${right}</span></div>`

/**
 * Comprovante NÃO FISCAL de venda ou de devolução, em largura de bobina térmica de 80 mm.
 * Todo texto variável é escapado (nome de cliente/produto não injeta HTML).
 */
export function buildReceiptHtml(company: CompanyDto | null, sale: SaleDetail, returnId?: number): string {
  const ret = returnId ? sale.returns.find((r) => r.id === returnId) : undefined
  if (returnId && !ret) throw new Error('Devolução não encontrada nesta venda')
  const header = companyHeader(company)

  const customer = sale.customer
    ? `${esc(sale.customer.name)}${sale.customer.document ? ' · ' + esc(formatDocument(sale.customer.document)) : ''}`
    : sale.customerDocument
      ? `CPF/CNPJ ${esc(formatDocument(sale.customerDocument))}`
      : ''

  let body: string
  if (ret) {
    body = [
      `<div class="center strong">COMPROVANTE DE DEVOLUÇÃO Nº ${ret.id}</div>`,
      `<div class="center">Referente à venda #${sale.id}</div>`,
      '<hr>',
      row('Data', esc(formatDateTime(ret.createdAt))),
      row('Atendente', esc(ret.userName)),
      customer ? row('Cliente', customer) : '',
      row('Motivo', esc(ret.reason)),
      '<hr>',
      row('Reembolso', esc(REFUND_LABEL[ret.refundMethod] ?? ret.refundMethod)),
      row('Valor', esc(formatMoney(ret.refundCents)), true),
      ret.voucherCode
        ? `<hr><div class="center strong big">VALE-TROCA ${esc(ret.voucherCode)}</div><div class="center">Valor: ${esc(formatMoney(ret.refundCents))}</div><div class="center small">Apresente este código no caixa para usar o crédito.</div>`
        : ''
    ].join('')
  } else {
    const items = sale.items
      .map((i) => {
        const qty = `${formatQuantity(i.quantityMilli)} ${esc(i.unit)} × ${esc(formatMoney(i.unitPriceCents))}`
        return (
          `<div class="item"><div>${esc(i.description)}</div>` +
          row(qty, esc(formatMoney(i.totalCents + i.discountCents))) +
          (i.discountCents ? row('&nbsp;&nbsp;desconto', '-' + esc(formatMoney(i.discountCents))) : '') +
          '</div>'
        )
      })
      .join('')
    const payments = sale.payments
      .map((p) =>
        row(
          esc(`${PAYMENT_LABEL[p.method] ?? p.method}${p.label ? ' (' + p.label + ')' : ''}${p.installments > 1 ? ` ${p.installments}x` : ''}${p.voucherCode ? ' ' + p.voucherCode : ''}`),
          esc(formatMoney(p.amountCents))
        )
      )
      .join('')
    body = [
      `<div class="center strong">COMPROVANTE DE VENDA Nº ${sale.id}</div>`,
      sale.status === 'CANCELLED' ? '<div class="center strong">*** VENDA CANCELADA ***</div>' : '',
      '<hr>',
      row('Data', esc(formatDateTime(sale.createdAt))),
      row('Operador', esc(sale.operatorName)),
      sale.sellerName ? row('Vendedor', esc(sale.sellerName)) : '',
      customer ? row('Cliente', customer) : '',
      '<hr>',
      items,
      '<hr>',
      row('Subtotal', esc(formatMoney(sale.subtotalCents))),
      sale.discountCents ? row('Descontos', '-' + esc(formatMoney(sale.discountCents))) : '',
      row('TOTAL', esc(formatMoney(sale.totalCents)), true),
      '<hr>',
      payments,
      sale.changeCents ? row('Troco', esc(formatMoney(sale.changeCents)), true) : '',
      sale.installments.length
        ? '<hr><div class="strong">CREDIÁRIO — PARCELAS</div>' +
          sale.installments
            .filter((i) => i.status !== 'CANCELLED')
            .map((i) => row(esc(`${i.number}ª venc. ${formatDate(i.dueDate)}`), esc(formatMoney(i.amountCents))))
            .join('') +
          '<div class="small">Pague em dia para manter seu crédito.</div>'
        : '',
      sale.notes ? `<hr><div class="small">${esc(sale.notes)}</div>` : ''
    ].join('')
  }
  return receiptPage('Comprovante', header, body)
}

function companyHeader(company: CompanyDto | null): string {
  if (!company) return ''
  const city = company.city && `${company.city}${company.state ? '/' + company.state : ''}`
  const address = [company.street && `${company.street}${company.number ? ', ' + company.number : ''}`, company.district, city].filter(Boolean).join(' · ')
  return [
    `<div class="center strong big">${esc(company.tradeName || company.legalName)}</div>`,
    company.tradeName ? `<div class="center">${esc(company.legalName)}</div>` : '',
    company.document ? `<div class="center">CNPJ/CPF ${esc(formatDocument(company.document))}</div>` : '',
    address ? `<div class="center">${esc(address)}</div>` : '',
    company.phone ? `<div class="center">${esc(formatPhone(company.phone))}</div>` : ''
  ].join('')
}

/** Recibo de recebimento de conta/parcela (80 mm). */
export function buildReceivableReceiptHtml(
  company: CompanyDto | null,
  p: {
    id: number
    amountCents: number
    interestCents: number
    discountCents: number
    method: string
    paidAt: Date
    user: { name: string }
    receivable: { description: string; amountCents: number; receivedCents: number; status: string; customer: { name: string; document: string | null } | null }
  }
): string {
  const r = p.receivable
  const remaining = r.status === 'PAID' ? 0 : r.amountCents - r.receivedCents
  const body = [
    `<div class="center strong">RECIBO DE PAGAMENTO Nº ${p.id}</div>`,
    '<hr>',
    row('Data', esc(formatDateTime(p.paidAt))),
    row('Atendente', esc(p.user.name)),
    r.customer ? row('Cliente', `${esc(r.customer.name)}${r.customer.document ? ' · ' + esc(formatDocument(r.customer.document)) : ''}`) : '',
    `<div>${esc(r.description)}</div>`,
    '<hr>',
    row('Valor da parcela', esc(formatMoney(r.amountCents))),
    row('Pago agora', esc(formatMoney(p.amountCents))),
    p.interestCents ? row('Juros/multa', esc(formatMoney(p.interestCents))) : '',
    p.discountCents ? row('Desconto', '-' + esc(formatMoney(p.discountCents))) : '',
    row('TOTAL RECEBIDO', esc(formatMoney(p.amountCents + p.interestCents)), true),
    row('Forma', esc(PAYMENT_LABEL[p.method] ?? p.method)),
    '<hr>',
    row('Saldo restante', esc(formatMoney(remaining)), true),
    '<br><br><div class="center">______________________________</div><div class="center small">Assinatura</div>'
  ].join('')
  return receiptPage('Recibo', companyHeader(company), body)
}

function receiptPage(title: string, header: string, body: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(title)}</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { margin: 0; width: 74mm; font: 11px/1.35 'Consolas', 'Courier New', monospace; color: #000; }
  .center { text-align: center; }
  .strong { font-weight: 700; }
  .big { font-size: 14px; }
  .small { font-size: 10px; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row span:last-child { white-space: nowrap; }
  .item { margin: 2px 0; }
  hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
  .fiscal { margin-top: 6px; text-align: center; font-weight: 700; }
</style></head><body>
${header}
<hr>
${body}
<hr>
<div class="fiscal">NÃO É DOCUMENTO FISCAL</div>
<div class="center small">Obrigado pela preferência!</div>
</body></html>`
}

/** Ajusta os modelos de bobina (feitos para 80 mm) à largura configurada da impressora térmica. */
export function withPaperWidth(html: string, widthMm: 58 | 80): string {
  if (widthMm === 80) return html
  return html
    .replaceAll('size: 80mm auto', `size: ${widthMm}mm auto`)
    .replaceAll('width: 74mm; font: 11px/1.35', `width: ${widthMm - 6}mm; font: 9.5px/1.3`)
}

/** Página de teste da impressora configurada (bobina ou A4). */
export function buildTestPageHtml(company: CompanyDto | null, target: 'receipt' | 'document', devices: DevicesSettings): string {
  const now = formatDateTime(new Date())
  if (target === 'receipt') {
    const p = devices.receiptPrinter
    const body = [
      '<div class="center strong">TESTE DE IMPRESSÃO</div>',
      '<hr>',
      row('Data', esc(now)),
      row('Impressora', esc(p.deviceName ?? 'padrão do Windows')),
      row('Largura', `${p.paperWidthMm} mm`),
      '<hr>',
      '<div>ABCDEFGHIJKLMNOPQRSTUVWXYZ</div><div>áéíóú ãõ ç ÁÉÍÓÚ ÃÕ Ç</div><div>0123456789 R$ 1.234,56</div>',
      '<div class="center small">Se este texto saiu completo e legível, a impressora está pronta.</div>'
    ].join('')
    return receiptPage('Teste de impressão', companyHeader(company), body)
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Teste</title>
<style>@page { size: A4; margin: 15mm; } body { font: 12pt Arial, sans-serif; }</style></head><body>
<h1>Teste de impressão</h1><p>${esc(company?.tradeName || company?.legalName || 'Sistema Comercial')}</p>
<p>Data: ${esc(now)}<br>Impressora: ${esc(devices.documentPrinter.deviceName ?? 'padrão do Windows')}</p>
<p>ABCDEFGHIJKLMNOPQRSTUVWXYZ · áéíóú ãõ ç · 0123456789 · R$ 1.234,56</p></body></html>`
}
