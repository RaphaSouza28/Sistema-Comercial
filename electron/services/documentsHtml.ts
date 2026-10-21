import type { CatalogData, CompanyDto, DocumentLineDto, OrderDetail, QuoteDetail } from '@shared/api'
import { ORDER_STATUS } from '@shared/commerceSchemas'
import { formatDocument, formatPhone } from '@shared/documents'
import { formatDate, formatDateTime, formatMoney, formatQuantity } from '@shared/format'

/** Documentos A4 (orçamento, pedido, catálogo). Todo texto variável é escapado. */

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

const BASE_CSS = `
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 11pt/1.4 'Segoe UI', Arial, sans-serif; color: #111; }
  h1 { font-size: 18pt; margin: 0; }
  .muted { color: #555; } .small { font-size: 9pt; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9pt; text-transform: uppercase; color: #555; border-bottom: 1px solid #999; padding: 6px 4px; }
  td { padding: 6px 4px; border-bottom: 1px solid #ddd; vertical-align: top; }
  .r { text-align: right; white-space: nowrap; }
  .totals { margin-left: auto; width: 280px; margin-top: 10px; }
  .totals div { display: flex; justify-content: space-between; padding: 3px 0; }
  .grand { font-size: 14pt; font-weight: 700; border-top: 2px solid #111; padding-top: 6px !important; }
  .box { border: 1px solid #ccc; border-radius: 6px; padding: 8px 10px; margin-bottom: 12px; }
  .footer { margin-top: 24px; font-size: 9pt; color: #555; }
`

function companyBlock(c: CompanyDto | null): string {
  if (!c) return ''
  const address = [c.street && `${c.street}${c.number ? ', ' + c.number : ''}`, c.district, c.city && `${c.city}${c.state ? '/' + c.state : ''}`].filter(Boolean).join(' · ')
  return `<div><div style="font-size:15pt;font-weight:700">${esc(c.tradeName || c.legalName)}</div>
    ${c.tradeName ? `<div class="small muted">${esc(c.legalName)}</div>` : ''}
    ${c.document ? `<div class="small">CNPJ/CPF ${esc(formatDocument(c.document))}</div>` : ''}
    ${address ? `<div class="small">${esc(address)}</div>` : ''}
    <div class="small">${esc([c.phone && formatPhone(c.phone), c.email].filter(Boolean).join(' · '))}</div></div>`
}

function itemsTable(items: DocumentLineDto[]): string {
  return `<table><thead><tr><th>Item</th><th class="r">Qtd.</th><th class="r">Unitário</th><th class="r">Desconto</th><th class="r">Total</th></tr></thead><tbody>
  ${items
    .map(
      (i) => `<tr><td>${esc(i.description)}${i.isService ? ' <span class="small muted">(serviço)</span>' : ''}</td>
    <td class="r">${esc(formatQuantity(i.quantityMilli))} ${esc(i.unit)}</td>
    <td class="r">${esc(formatMoney(i.unitPriceCents))}</td>
    <td class="r">${i.discountCents ? '-' + esc(formatMoney(i.discountCents)) : '—'}</td>
    <td class="r">${esc(formatMoney(i.totalCents))}</td></tr>`
    )
    .join('')}</tbody></table>`
}

function totals(d: { subtotalCents: number; discountCents: number; totalCents: number }): string {
  return `<div class="totals"><div><span>Subtotal</span><span>${esc(formatMoney(d.subtotalCents))}</span></div>
    ${d.discountCents ? `<div><span>Descontos</span><span>-${esc(formatMoney(d.discountCents))}</span></div>` : ''}
    <div class="grand"><span>Total</span><span>${esc(formatMoney(d.totalCents))}</span></div></div>`
}

const page = (title: string, body: string) =>
  `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${esc(title)}</title><style>${BASE_CSS}</style></head><body>${body}</body></html>`

export function buildQuoteHtml(company: CompanyDto | null, q: QuoteDetail): string {
  const who = q.customer
    ? `${esc(q.customer.name)}${q.customer.document ? ' · ' + esc(formatDocument(q.customer.document)) : ''}${q.customer.phone ? ' · ' + esc(formatPhone(q.customer.phone)) : ''}`
    : `${esc(q.contactName ?? 'Não identificado')}${q.contactPhone ? ' · ' + esc(formatPhone(q.contactPhone)) : ''}`
  return page(
    `Orçamento ${q.id}`,
    `<div class="header">${companyBlock(company)}<div style="text-align:right"><h1>Orçamento nº ${q.id}</h1>
      <div class="small">Emitido em ${esc(formatDate(q.createdAt))}</div><div><strong>Válido até ${esc(formatDate(q.validUntil + 'T12:00:00'))}</strong></div></div></div>
    <div class="box"><span class="muted small">Cliente</span><br>${who}</div>
    ${itemsTable(q.items)}${totals(q)}
    ${q.notes ? `<div class="box" style="margin-top:14px"><span class="muted small">Observações</span><br>${esc(q.notes).replace(/\n/g, '<br>')}</div>` : ''}
    <div class="footer">Orçamento sem valor fiscal. Preços e disponibilidade garantidos até a data de validade. Atendente: ${esc(q.userName)}.</div>`
  )
}

export function buildOrderHtml(company: CompanyDto | null, o: OrderDetail): string {
  const who = o.customer ? `${esc(o.customer.name)}${o.customer.phone ? ' · ' + esc(formatPhone(o.customer.phone)) : ''}` : 'Não identificado'
  return page(
    `Pedido ${o.id}`,
    `<div class="header">${companyBlock(company)}<div style="text-align:right"><h1>Pedido nº ${o.id}</h1>
      <div class="small">${esc(formatDateTime(o.createdAt))}</div><div><strong>${esc(ORDER_STATUS[o.status])}</strong></div>
      ${o.expectedDeliveryAt ? `<div class="small">Previsão de entrega: ${esc(formatDate(o.expectedDeliveryAt))}</div>` : ''}</div></div>
    <div class="box"><span class="muted small">Cliente</span><br>${who}</div>
    ${itemsTable(o.items)}${totals(o)}
    ${o.notes ? `<div class="box" style="margin-top:14px"><span class="muted small">Observações</span><br>${esc(o.notes).replace(/\n/g, '<br>')}</div>` : ''}
    <div class="footer">Documento sem valor fiscal. Responsável: ${esc(o.userName)}.<br><br>______________________________<br>Assinatura de quem recebeu</div>`
  )
}

/** Catálogo em A4: grade de produtos por categoria. `imageSrc` devolve a imagem embutida (data URI). */
export function buildCatalogHtml(company: CompanyDto | null, data: CatalogData, imageSrc: (productId: number) => string | null): string {
  const css = `${BASE_CSS}
    h2 { font-size: 13pt; border-bottom: 1px solid #999; padding-bottom: 4px; margin: 18px 0 10px; page-break-after: avoid; }
    .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 8px; page-break-inside: avoid; }
    .img { height: 120px; display: flex; align-items: center; justify-content: center; background: #f4f4f4; border-radius: 6px; overflow: hidden; }
    .img img { max-width: 100%; max-height: 120px; object-fit: contain; }
    .name { font-weight: 600; margin-top: 6px; }
    .price { font-size: 13pt; font-weight: 700; margin-top: 4px; }
    .old { text-decoration: line-through; color: #888; font-size: 9pt; margin-left: 4px; font-weight: 400; }
    .tag { display: inline-block; background: #111; color: #fff; font-size: 8pt; border-radius: 4px; padding: 1px 6px; }`
  const sections = data.categories
    .map(
      (c) => `<h2>${esc(c.name)}</h2><div class="grid">${c.products
        .map((p) => {
          const src = imageSrc(p.id)
          return `<div class="card"><div class="img">${src ? `<img src="${src}" alt="">` : '<span class="small muted">sem imagem</span>'}</div>
          <div class="name">${esc(p.name)} ${p.promo ? '<span class="tag">PROMOÇÃO</span>' : ''}</div>
          ${p.description ? `<div class="small muted">${esc(p.description.slice(0, 140))}</div>` : ''}
          ${p.variants.length ? `<div class="small">Opções: ${esc(p.variants.join(', '))}</div>` : ''}
          ${data.showPrices ? `<div class="price">${esc(formatMoney(p.priceCents))}${p.promo ? `<span class="old">${esc(formatMoney(p.regularPriceCents))}</span>` : ''} <span class="small muted">/${esc(p.unit)}</span></div>` : ''}</div>`
        })
        .join('')}</div>`
    )
    .join('')
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${esc(data.title)}</title><style>${css}</style></head><body>
    <div class="header">${companyBlock(company)}<div style="text-align:right"><h1>${esc(data.title)}</h1><div class="small">${data.productCount} produto(s) · ${esc(formatDate(data.generatedAt))}</div></div></div>
    ${sections || '<p>Nenhum produto com os filtros escolhidos.</p>'}
    ${data.showPrices ? '<div class="footer">Preços sujeitos a alteração sem aviso prévio. Promoções válidas enquanto durarem os estoques.</div>' : ''}
  </body></html>`
}
