interface TooltipEntry {
  name?: string | number
  value?: unknown
  color?: string
  dataKey?: unknown
}

/** Tooltip dos gráficos: texto em cores de texto; a cor da série aparece só no marcador. */
export function ChartTooltip({
  active,
  payload,
  label,
  formatLabel,
  formatValue
}: {
  active?: boolean
  payload?: readonly TooltipEntry[]
  label?: string | number
  formatLabel?: (label: string) => string
  formatValue: (value: number, name: string) => string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] shadow-lg">
      {label !== undefined && <p className="mb-1 font-medium text-ink">{formatLabel ? formatLabel(String(label)) : label}</p>}
      {payload.map((entry) => (
        <p key={String(entry.dataKey)} className="flex items-center gap-2 text-ink-2">
          <span className="size-2.5 rounded-sm" style={{ background: entry.color }} aria-hidden />
          <span>{entry.name}:</span>
          <span className="tabular font-medium text-ink">{formatValue(Number(entry.value), String(entry.name))}</span>
        </p>
      ))}
    </div>
  )
}
