import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface FieldShellProps {
  label: string
  error?: string
  hint?: ReactNode
  required?: boolean
  className?: string
  htmlFor: string
  children: ReactNode
}

export function FieldShell({ label, error, hint, required, className = '', htmlFor, children }: FieldShellProps) {
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

const inputClass = (error?: string) =>
  `h-9 w-full rounded-md border bg-surface px-3 text-sm text-ink placeholder:text-muted transition-colors disabled:opacity-60 ${
    error ? 'border-danger' : 'border-line-strong hover:border-muted focus:border-primary'
  }`

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: ReactNode
  containerClassName?: string
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, containerClassName, id, required, className = '', ...rest },
  ref
) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={containerClassName} htmlFor={fieldId}>
      <input
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={!!error || undefined}
        aria-describedby={error ? `${fieldId}-error` : undefined}
        className={`${inputClass(error)} ${className}`}
        {...rest}
      />
    </FieldShell>
  )
})

export const PasswordField = forwardRef<HTMLInputElement, TextFieldProps>(function PasswordField(
  { label, error, hint, containerClassName, id, required, ...rest },
  ref
) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const [visible, setVisible] = useState(false)
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={containerClassName} htmlFor={fieldId}>
      <div className="relative">
        <input
          ref={ref}
          id={fieldId}
          type={visible ? 'text' : 'password'}
          required={required}
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${fieldId}-error` : undefined}
          className={`${inputClass(error)} pr-10`}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted hover:text-ink"
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
          tabIndex={-1}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </FieldShell>
  )
})

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string
  error?: string
  hint?: ReactNode
  containerClassName?: string
  options: { value: string | number; label: string }[]
}

export function SelectField({ label, error, hint, containerClassName, id, required, options, ...rest }: SelectFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={containerClassName} htmlFor={fieldId}>
      <select id={fieldId} required={required} aria-invalid={!!error || undefined} className={inputClass(error)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldShell>
  )
}

export function Checkbox({
  label,
  description,
  checked,
  onChange,
  disabled
}: {
  label: string
  description?: string
  checked: boolean
  onChange(checked: boolean): void
  disabled?: boolean
}) {
  const id = useId()
  return (
    <label htmlFor={id} className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
      />
      <span className="flex flex-col">
        <span className="text-sm text-ink">{label}</span>
        {description && <span className="text-xs text-muted">{description}</span>}
      </span>
    </label>
  )
}
