import { useEffect, useId, useState, type ReactNode } from 'react'
import { formatQuantity, parseMoney } from '@shared/format'
import { parseQuantity } from '@shared/units'
import { FieldShell } from './Field'

interface Codec {
  format(value: number): string
  parse(text: string): number | null
}

const money: Codec = {
  format: (cents) => (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  parse: (text) => {
    const v = parseMoney(text)
    return v !== null && v >= 0 ? v : null
  }
}

const percent: Codec = {
  format: (bps) => (bps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }),
  parse: (text) => {
    const v = text.trim().replace('%', '').replace(',', '.')
    if (!/^\d+(\.\d{1,2})?$/.test(v)) return null
    const bps = Math.round(Number(v) * 100)
    return bps <= 10000 ? bps : null
  }
}

const quantity: Codec = {
  format: (milli) => formatQuantity(milli),
  parse: (text) => {
    const v = parseQuantity(text)
    return v !== null && v >= 0 ? v : null
  }
}

interface NumericFieldProps {
  label: string
  value: number | null
  onChange(value: number | null): void
  /** Campo vazio vira null (senão, 0). */
  nullable?: boolean
  error?: string
  hint?: ReactNode
  disabled?: boolean
  required?: boolean
  placeholder?: string
  containerClassName?: string
  prefix?: string
  suffix?: string
  id?: string
  name?: string
}

function NumericField({ codec, ...p }: NumericFieldProps & { codec: Codec }) {
  const autoId = useId()
  const fieldId = p.id ?? autoId
  const show = (v: number | null) => (v === null ? '' : codec.format(v))
  const [text, setText] = useState(show(p.value))

  // Sincroniza quando o valor muda por fora (ex.: preço sugerido aplicado)
  useEffect(() => {
    const current = text.trim() === '' ? (p.nullable ? null : 0) : codec.parse(text)
    if (current !== p.value) setText(show(p.value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.value])

  const invalid = text.trim() !== '' && codec.parse(text) === null
  const error = p.error ?? (invalid ? 'Valor inválido' : undefined)

  return (
    <FieldShell label={p.label} error={error} hint={p.hint} required={p.required} className={p.containerClassName} htmlFor={fieldId}>
      <div className="relative">
        {p.prefix && <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted">{p.prefix}</span>}
        <input
          id={fieldId}
          name={p.name}
          inputMode="decimal"
          value={text}
          disabled={p.disabled}
          placeholder={p.placeholder}
          aria-invalid={!!error || undefined}
          onChange={(e) => {
            const t = e.target.value
            setText(t)
            if (t.trim() === '') p.onChange(p.nullable ? null : 0)
            else {
              const v = codec.parse(t)
              if (v !== null) p.onChange(v)
            }
          }}
          onBlur={() => !invalid && setText(show(p.value))}
          className={`tabular h-9 w-full rounded-md border bg-surface text-right text-sm text-ink placeholder:text-muted disabled:opacity-60 ${
            p.prefix ? 'pl-9' : 'pl-3'
          } ${p.suffix ? 'pr-9' : 'pr-3'} ${error ? 'border-danger' : 'border-line-strong hover:border-muted focus:border-primary'}`}
        />
        {p.suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{p.suffix}</span>}
      </div>
    </FieldShell>
  )
}

export const MoneyField = (p: NumericFieldProps) => <NumericField {...p} codec={money} prefix="R$" />
export const PercentField = (p: NumericFieldProps) => <NumericField {...p} codec={percent} suffix="%" />
export const QuantityField = (p: NumericFieldProps & { unit?: string }) => <NumericField {...p} codec={quantity} suffix={p.unit} />
