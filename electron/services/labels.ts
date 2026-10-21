import type { DevicesSettings } from '@shared/deviceSchemas'
import { formatMoney } from '@shared/format'
import { barcodeSvg } from '../integrations/devices/barcode'

export interface LabelItem {
  name: string
  code: string
  priceCents: number
  quantity: number
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/**
 * Etiquetas de gôndola/produto com código de barras. Em rolo (impressora de etiquetas) cada etiqueta
 * é uma página do tamanho configurado; em folha A4, são distribuídas em colunas.
 */
export function buildLabelsHtml(items: LabelItem[], layout: DevicesSettings['labelPrinter'], showPrice: boolean): string {
  const w = layout.labelWidthMm
  const h = layout.labelHeightMm
  const barH = Math.max(6, Math.round(h * (showPrice ? 0.38 : 0.5)))
  const label = (i: LabelItem) =>
    `<div class="label"><div class="name">${esc(i.name)}</div>${showPrice ? `<div class="price">${esc(formatMoney(i.priceCents))}</div>` : ''}<div class="bar">${barcodeSvg(i.code, w - 4, barH)}</div><div class="code">${esc(i.code)}</div></div>`
  const all = items.flatMap((i) => Array.from({ length: i.quantity }, () => label(i)))
  const roll = layout.media === 'ROLL'
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Etiquetas</title>
<style>
  @page { size: ${roll ? `${w}mm ${h}mm` : 'A4'}; margin: ${roll ? '0' : '8mm'}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, sans-serif; color: #000; }
  .sheet { ${roll ? '' : `display: grid; grid-template-columns: repeat(${layout.columns}, ${w}mm); gap: 2mm;`} }
  .label { width: ${w}mm; height: ${h}mm; padding: 1.5mm 2mm; overflow: hidden; display: flex; flex-direction: column; align-items: center; justify-content: space-between; ${roll ? 'page-break-after: always;' : 'border: 0.2mm dashed #bbb; page-break-inside: avoid;'} }
  .name { font-size: ${h < 25 ? 7 : 8}pt; font-weight: 700; text-align: center; line-height: 1.1; max-height: 2.3em; overflow: hidden; width: 100%; }
  .price { font-size: ${h < 25 ? 10 : 13}pt; font-weight: 700; }
  .bar svg { display: block; }
  .code { font-size: 7pt; letter-spacing: 0.5px; }
</style></head><body><div class="sheet">${all.join('')}</div></body></html>`
}
