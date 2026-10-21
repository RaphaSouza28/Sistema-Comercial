import type { LucideIcon } from 'lucide-react'

export function Tabs<T extends string>({
  tabs,
  value,
  onChange
}: {
  tabs: { key: T; label: string; icon?: LucideIcon }[]
  value: T
  onChange(key: T): void
}) {
  return (
    <div className="mb-4 flex gap-1 border-b border-line" role="tablist">
      {tabs.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm ${
            value === key ? 'border-primary font-medium text-ink' : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          {Icon && <Icon className="size-4" aria-hidden />} {label}
        </button>
      ))}
    </div>
  )
}
