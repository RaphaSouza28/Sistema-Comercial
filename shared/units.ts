/** Unidades de medida. Unidades fracionáveis aceitam quantidades com até 3 casas decimais. */
export const UNITS = [
  { code: 'UN', label: 'Unidade', fractional: false },
  { code: 'PC', label: 'Peça', fractional: false },
  { code: 'PAR', label: 'Par', fractional: false },
  { code: 'CX', label: 'Caixa', fractional: false },
  { code: 'PCT', label: 'Pacote', fractional: false },
  { code: 'DZ', label: 'Dúzia', fractional: false },
  { code: 'KG', label: 'Quilograma', fractional: true },
  { code: 'G', label: 'Grama', fractional: true },
  { code: 'L', label: 'Litro', fractional: true },
  { code: 'ML', label: 'Mililitro', fractional: true },
  { code: 'M', label: 'Metro', fractional: true },
  { code: 'CM', label: 'Centímetro', fractional: true },
  { code: 'M2', label: 'Metro quadrado', fractional: true }
] as const

export type UnitCode = (typeof UNITS)[number]['code']
export const UNIT_CODES = UNITS.map((u) => u.code) as [UnitCode, ...UnitCode[]]

export function isFractionalUnit(code: string): boolean {
  return UNITS.some((u) => u.code === code && u.fractional)
}

/** Converte "1,5" / "2" em milésimos; null se inválido. */
export function parseQuantity(input: string): number | null {
  const v = input.trim().replace(/\./g, '').replace(',', '.')
  if (!/^-?\d+(\.\d{1,3})?$/.test(v)) return null
  const milli = Math.round(Number(v) * 1000)
  return Number.isSafeInteger(milli) ? milli : null
}
