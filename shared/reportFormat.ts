import type { ReportColumn } from './api'
import { formatDateTime, formatInteger, formatMoney, formatPercentBps, formatQuantity } from './format'

/** Texto de uma célula de relatório (tela, impressão e PDF). */
export function displayCell(value: string | number | null, format: ReportColumn['format']): string {
  if (value === null || value === '') return ''
  if (typeof value === 'string') return format === 'datetime' ? formatDateTime(value) : value
  switch (format) {
    case 'money':
      return formatMoney(value)
    case 'percent':
      return formatPercentBps(value)
    case 'qty':
      return formatQuantity(value)
    case 'int':
      return formatInteger(value)
    default:
      return String(value)
  }
}

export const isNumericColumn = (c: ReportColumn) => c.format !== 'text' && c.format !== 'datetime' && c.format !== 'date'
