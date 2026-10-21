import { addDays, startOfDay, startOfMonth } from '../utils/dates'
import { validationError } from '../utils/errors'

export { splitInstallments } from '@shared/installments'

const DAY_MS = 86_400_000

/** Dias de atraso em relação a hoje (0 se ainda não venceu). */
export function daysOverdue(dueDate: Date, today: Date): number {
  const diff = Math.round((startOfDay(today).getTime() - startOfDay(dueDate).getTime()) / DAY_MS)
  return Math.max(0, diff)
}

/** Mesmo dia em outro mês; dia 31 vira o último dia de meses mais curtos. */
export function addMonthsClamped(d: Date, months: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1, d.getHours(), d.getMinutes())
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(d.getDate(), lastDay))
  return target
}

export function nextOccurrence(d: Date, recurrence: 'NONE' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'): Date | null {
  if (recurrence === 'WEEKLY') return addDays(d, 7)
  if (recurrence === 'MONTHLY') return addMonthsClamped(d, 1)
  if (recurrence === 'YEARLY') return addMonthsClamped(d, 12)
  return null
}

/**
 * Data de pagamento/recebimento informada: hoje usa o horário atual; datas passadas, meio-dia
 * (evita trocar de dia por fuso). Datas futuras não são aceitas.
 */
export function settlementDate(key: string | null, now: Date): Date {
  if (!key) return now
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y, m - 1, d, 12)
  if (startOfDay(date) > startOfDay(now)) throw validationError('A data não pode estar no futuro.', { paidAt: 'Data no futuro' })
  if (startOfDay(date).getTime() === startOfDay(now).getTime()) return now
  return date
}

/** Janelas usadas nos alertas de vencimento. */
export function dueWindows(now: Date) {
  const today = startOfDay(now)
  return { today, tomorrow: addDays(today, 1), in8Days: addDays(today, 8), monthStart: startOfMonth(now) }
}
