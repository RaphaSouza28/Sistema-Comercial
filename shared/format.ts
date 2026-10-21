/** Formatação no padrão brasileiro. Valores monetários sempre em centavos inteiros. */

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 })
const decimal3 = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 })
const percent = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit'
})

/** 123456 -> "R$ 1.234,56" (com espaço comum, não o espaço rígido do Intl). */
export function formatMoney(cents: number): string {
  // "|| 0" normaliza -0 (ex.: soma vazia negada), que seria exibido como "-R$ 0,00"
  return currency.format((cents || 0) / 100).replace(/ /g, ' ')
}

/**
 * Converte texto digitado ("1.234,56", "R$ 10", "10,5") em centavos.
 * Retorna null quando o texto não representa um valor válido.
 */
export function parseMoney(input: string): number | null {
  let cleaned = input.replace(/R\$/gi, '').replace(/\s+/g, '').trim()
  if (!cleaned) return null
  // Sem vírgula e um único ponto seguido de 1-2 dígitos ("10.50"): o ponto é o separador decimal.
  if (/^-?\d+\.\d{1,2}$/.test(cleaned)) cleaned = cleaned.replace('.', ',')
  // Pontos só são aceitos como separador de milhar em grupos de 3 dígitos ("1.234.567,89").
  if (!/^-?(\d{1,3}(\.\d{3})+|\d*)(,\d{0,2})?$/.test(cleaned)) return null
  const [intPart, fracPart = ''] = cleaned.split(',')
  const negative = intPart.startsWith('-')
  const intDigits = intPart.replace(/[-.]/g, '')
  if (!intDigits && !fracPart) return null
  const cents = Number(intDigits || '0') * 100 + Number(fracPart.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents)) return null
  return negative ? -cents : cents
}

export function formatInteger(value: number): string {
  return integer.format(value)
}

/** Quantidade armazenada em milésimos -> "1,5" / "12". */
export function formatQuantity(milli: number): string {
  return decimal3.format(milli / 1000)
}

/** Pontos-base -> "30,0%". */
export function formatPercentBps(bps: number): string {
  return `${percent.format(bps / 100)}%`
}

export function formatDate(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return dateFmt.format(new Date(value))
}

export function formatDateTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  return dateTimeFmt.format(new Date(value)).replace(',', '')
}

/** Data local no formato "AAAA-MM-DD" (campos type="date"); deslocamento opcional em dias. */
export function toDateKey(value: Date | string | number = new Date(), addDays = 0): string {
  const d = new Date(value)
  d.setDate(d.getDate() + addDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** "AAAA-MM-DD" (data sem horário) -> "dd/mm/aaaa", sem conversão de fuso. */
export function formatDateKey(key: string | null | undefined): string {
  if (!key) return ''
  const [y, m, d] = key.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
