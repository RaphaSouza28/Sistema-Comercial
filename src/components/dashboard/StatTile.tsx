import type { ReactNode } from 'react'
import { Card } from '../ui/Card'

export function StatTile({
  label,
  value,
  hint,
  icon,
  emphasis = false
}: {
  label: string
  value: string
  hint?: ReactNode
  icon: ReactNode
  emphasis?: boolean
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-muted">{label}</p>
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary-soft text-primary [&_svg]:size-4">{icon}</span>
      </div>
      <p className={`tabular mt-2 font-semibold tracking-tight text-ink ${emphasis ? 'text-[26px]' : 'text-[22px]'}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  )
}
