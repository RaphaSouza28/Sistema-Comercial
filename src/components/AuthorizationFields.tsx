import { ShieldCheck } from 'lucide-react'
import { PasswordField, TextField } from './ui/Field'

export interface AuthorizationValue {
  username: string
  password: string
}

/** Campos de autorização de supervisor (desconto acima do limite, cancelamento, devolução). */
export function AuthorizationFields({ value, onChange, reason }: { value: AuthorizationValue; onChange(v: AuthorizationValue): void; reason: string }) {
  return (
    <fieldset className="rounded-lg border border-warning/40 bg-warning-soft/50 p-3">
      <legend className="flex items-center gap-1.5 px-1 text-[13px] font-medium text-warning">
        <ShieldCheck className="size-4" aria-hidden /> Autorização do supervisor
      </legend>
      <p className="mb-3 text-xs text-ink-2">{reason}</p>
      <div className="grid grid-cols-2 gap-3">
        <TextField label="Usuário do supervisor" autoComplete="off" value={value.username} onChange={(e) => onChange({ ...value, username: e.target.value })} />
        <PasswordField label="Senha do supervisor" autoComplete="off" value={value.password} onChange={(e) => onChange({ ...value, password: e.target.value })} />
      </div>
    </fieldset>
  )
}
