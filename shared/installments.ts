/** Divide um valor em parcelas iguais; os centavos que sobram ficam na primeira. */
export function splitInstallments(totalCents: number, count: number): number[] {
  const base = Math.floor(totalCents / count)
  const parts = Array.from({ length: count }, () => base)
  parts[0] += totalCents - base * count
  return parts
}
