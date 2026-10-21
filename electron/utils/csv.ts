/**
 * CSV no padrão do Excel brasileiro: separador ";" (detecta "," e tab), aspas duplas,
 * arquivos em UTF-8 (com ou sem BOM) ou ANSI/Windows-1252.
 */

export function decodeText(buffer: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('windows-1252').decode(buffer)
  }
}

function detectDelimiter(firstLine: string): string {
  const counts = [';', ',', '\t'].map((d) => ({ d, n: firstLine.split(d).length }))
  return counts.sort((a, b) => b.n - a.n)[0].d
}

export function parseCsv(text: string): string[][] {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = detectDelimiter(firstLine)
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += ch
    } else if (ch === '"' && field === '') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(field)
      field = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

function escapeCell(value: string): string {
  // Evita injeção de fórmulas ao abrir no Excel (=, +, -, @ no início).
  const safe = /^[=+\-@]/.test(value) && !/^-?\d+([.,]\d+)?$/.test(value) ? `'${value}` : value
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Gera CSV com BOM (o Excel reconhece UTF-8) e separador ";". */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + rows.map((r) => r.map((c) => escapeCell(c === null || c === undefined ? '' : String(c))).join(';')).join('\r\n') + '\r\n'
}
