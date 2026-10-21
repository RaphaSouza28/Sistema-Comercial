import zlib from 'node:zlib'
import type { CompanyDto, ReportColumn, ReportResult, ReportRow } from '@shared/api'
import { formatDateTime } from '@shared/format'
import { displayCell, isNumericColumn } from '@shared/reportFormat'
import { toCsv } from '../utils/csv'

/** Exportação dos relatórios: CSV (Excel brasileiro), XLSX e HTML (impressão/PDF). */

type Cell = string | number | null

// ───────────── CSV ─────────────

/** Número no padrão brasileiro sem símbolo (o Excel em pt-BR reconhece como número). */
const ptNumber = (n: number, decimals: number) => n.toFixed(decimals).replace('.', ',')

function csvCell(value: Cell, format: ReportColumn['format']): string | number | null {
  if (value === null) return null
  if (typeof value === 'string') return format === 'datetime' ? formatDateTime(value) : value
  if (format === 'money') return ptNumber(value / 100, 2)
  if (format === 'percent') return ptNumber(value / 100, 1)
  if (format === 'qty') return ptNumber(value / 1000, 3).replace(/,?0+$/, '')
  return value
}

export function reportToCsv(r: ReportResult): string {
  const header = r.columns.map((c) => (c.format === 'percent' ? `${c.label} (%)` : c.format === 'money' ? `${c.label} (R$)` : c.label))
  const line = (row: ReportRow) => r.columns.map((c) => csvCell(row[c.key] ?? null, c.format))
  return toCsv([[r.title], [r.subtitle], [], header, ...r.rows.map(line), ...(r.totals ? [line(r.totals)] : [])])
}

// ───────────── XLSX (Office Open XML, sem dependências) ─────────────

const xmlEsc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

/** Índices de estilo (cellXfs em styles.xml). */
const XF = { text: 0, money: 1, percent: 2, qty: 3, int: 4, date: 5, bold: 6, boldMoney: 7, boldPercent: 8, title: 9 } as const

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00;\\-&quot;R$&quot;\\ #,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="#,##0.###"/><numFmt numFmtId="167" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`

function colName(i: number): string {
  let s = ''
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s
}

/** Data/hora local como número de série do Excel. */
function excelSerial(iso: string): number {
  const d = new Date(iso)
  const local = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())
  return local / 86_400_000 + 25569
}

function xlsxCell(ref: string, value: Cell, format: ReportColumn['format'], bold: boolean): string {
  if (value === null || value === '') return ''
  if (typeof value === 'string') {
    if (format === 'datetime') return `<c r="${ref}" s="${XF.date}"><v>${excelSerial(value)}</v></c>`
    return `<c r="${ref}" t="inlineStr"${bold ? ` s="${XF.bold}"` : ''}><is><t xml:space="preserve">${xmlEsc(value)}</t></is></c>`
  }
  if (format === 'money') return `<c r="${ref}" s="${bold ? XF.boldMoney : XF.money}"><v>${value / 100}</v></c>`
  if (format === 'percent') return `<c r="${ref}" s="${bold ? XF.boldPercent : XF.percent}"><v>${value / 10000}</v></c>`
  if (format === 'qty') return `<c r="${ref}" s="${XF.qty}"><v>${value / 1000}</v></c>`
  return `<c r="${ref}" s="${XF.int}"><v>${value}</v></c>`
}

function sheetXml(r: ReportResult): string {
  const rows: string[] = []
  const textRow = (n: number, text: string, style: number) => `<row r="${n}"><c r="A${n}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c></row>`
  rows.push(textRow(1, r.title, XF.title), textRow(2, r.subtitle, XF.text))
  let n = 4
  rows.push(`<row r="${n}">${r.columns.map((c, i) => `<c r="${colName(i)}${n}" t="inlineStr" s="${XF.bold}"><is><t xml:space="preserve">${xmlEsc(c.label)}</t></is></c>`).join('')}</row>`)
  const dataRow = (row: ReportRow, bold: boolean) => {
    n++
    rows.push(`<row r="${n}">${r.columns.map((c, i) => xlsxCell(`${colName(i)}${n}`, row[c.key] ?? null, c.format, bold)).join('')}</row>`)
  }
  for (const row of r.rows) dataRow(row, false)
  if (r.totals) dataRow(r.totals, true)
  n++
  for (const note of r.notes) rows.push(textRow(++n, note, XF.text))
  const widths = r.columns.map((c, i) => {
    const longest = Math.max(c.label.length, ...r.rows.slice(0, 500).map((row) => displayCell(row[c.key] ?? null, c.format).length))
    return `<col min="${i + 1}" max="${i + 1}" width="${Math.min(Math.max(longest + 2, 8), 60)}" customWidth="1"/>`
  })
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.join('')}</cols><sheetData>${rows.join('')}</sheetData></worksheet>`
}

/** Arquivo ZIP (método deflate) com os arquivos informados. */
/** Data e hora no formato DOS usado pelo ZIP (data zero é inválida para alguns leitores). */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

export function zip(files: { name: string; data: Buffer }[], when = new Date()): Buffer {
  const stamp = dosDateTime(when)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const compressed = zlib.deflateRawSync(f.data)
    const crc = zlib.crc32(f.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // versão necessária
    local.writeUInt16LE(0x0800, 6) // nomes em UTF-8
    local.writeUInt16LE(8, 8) // deflate
    local.writeUInt16LE(stamp.time, 10)
    local.writeUInt16LE(stamp.date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(f.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(stamp.time, 12)
    central.writeUInt16LE(stamp.date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(f.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + compressed.length
  }
  const centralSize = centrals.reduce((a, b) => a + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

export function reportToXlsx(r: ReportResult): Buffer {
  const sheetName = xmlEsc(r.title.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31))
  const f = (name: string, xml: string) => ({ name, data: Buffer.from(xml, 'utf8') })
  return zip([
    f(
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`
    ),
    f(
      '_rels/.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    ),
    f(
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`
    ),
    f(
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`
    ),
    f('xl/styles.xml', STYLES),
    f('xl/worksheets/sheet1.xml', sheetXml(r))
  ])
}

// ───────────── HTML (impressão e PDF em A4 paisagem) ─────────────

const esc = (s: string | null | undefined) =>
  (s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export function buildReportHtml(company: CompanyDto | null, r: ReportResult): string {
  const row = (data: ReportRow, cls = '') =>
    `<tr class="${cls}">${r.columns.map((c) => `<td class="${isNumericColumn(c) ? 'r' : ''}">${esc(displayCell(data[c.key] ?? null, c.format))}</td>`).join('')}</tr>`
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${esc(r.title)}</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { margin: 0; font: 9pt/1.35 'Segoe UI', Arial, sans-serif; color: #111; }
  .head { display: flex; justify-content: space-between; border-bottom: 2px solid #111; padding-bottom: 6px; margin-bottom: 8px; }
  h1 { font-size: 15pt; margin: 0; }
  .muted { color: #555; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 8pt; text-transform: uppercase; color: #444; border-bottom: 1px solid #888; padding: 4px 3px; }
  td { padding: 3px; border-bottom: 1px solid #e2e2e2; }
  tr { page-break-inside: avoid; }
  .r { text-align: right; white-space: nowrap; }
  .total td { font-weight: 700; border-top: 2px solid #111; border-bottom: none; }
  .notes { margin-top: 10px; font-size: 8pt; color: #555; }
</style></head><body>
<div class="head"><div><h1>${esc(r.title)}</h1><div>${esc(r.subtitle)}</div></div>
<div class="muted" style="text-align:right">${esc(company?.tradeName || company?.legalName || '')}<br>Gerado em ${esc(formatDateTime(r.generatedAt))}</div></div>
<table><thead><tr>${r.columns.map((c) => `<th class="${isNumericColumn(c) ? 'r' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
<tbody>${r.rows.length ? r.rows.map((x) => row(x)).join('') : `<tr><td colspan="${r.columns.length}" class="muted">Nenhum registro no período.</td></tr>`}${r.totals ? row(r.totals, 'total') : ''}</tbody></table>
${r.notes.length ? `<div class="notes">${r.notes.map((n) => `<div>${esc(n)}</div>`).join('')}</div>` : ''}
</body></html>`
}
