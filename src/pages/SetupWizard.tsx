import { useState, type FormEvent } from 'react'
import { z } from 'zod'
import { ArrowLeft, ArrowRight, Building2, Check, SlidersHorizontal, UserRound } from 'lucide-react'
import { companySchema, passwordSchema, personNameSchema, usernameSchema } from '@shared/schemas'
import { CompanyFields, emptyCompany, type CompanyForm } from '@/components/CompanyFields'
import { Button } from '@/components/ui/Button'
import { Checkbox, PasswordField, TextField } from '@/components/ui/Field'
import { ErrorState } from '@/components/ui/Feedback'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { AuthLayout } from '@/layouts/AuthLayout'
import { scoped, validate } from '@/lib/validation'
import { errorMessage, fieldErrors } from '@/services/api'

const adminSchema = z
  .object({ name: personNameSchema, username: usernameSchema, password: passwordSchema, passwordConfirm: z.string() })
  .refine((v) => v.password === v.passwordConfirm, { message: 'As senhas não conferem', path: ['passwordConfirm'] })

const steps = [
  { title: 'Empresa', icon: Building2 },
  { title: 'Administrador', icon: UserRound },
  { title: 'Preferências', icon: SlidersHorizontal }
]

/** Assistente de primeiro acesso: empresa -> administrador -> preferências -> dashboard. */
export function SetupWizardPage() {
  const { completeSetup } = useAuth()
  const toast = useToast()
  const [step, setStep] = useState(0)
  const [company, setCompany] = useState<CompanyForm>(emptyCompany)
  const [admin, setAdmin] = useState({ name: '', username: '', password: '', passwordConfirm: '' })
  const [prefs, setPrefs] = useState({ lowStockAlerts: true, allowNegativeStock: false })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const next = (e: FormEvent) => {
    e.preventDefault()
    const stepErrors = step === 0 ? validate(companySchema, company) : step === 1 ? validate(adminSchema, admin) : {}
    setErrors(stepErrors)
    if (Object.keys(stepErrors).length) return
    if (step < steps.length - 1) setStep(step + 1)
    else void finish()
  }

  const finish = async () => {
    setSaving(true)
    setSubmitError(null)
    try {
      await completeSetup({ company, admin, preferences: prefs })
      toast.success('Configuração concluída. Bem-vindo!')
    } catch (err) {
      const fields = fieldErrors(err)
      setSubmitError(errorMessage(err))
      if (Object.keys(scoped(fields, 'company')).length) {
        setStep(0)
        setErrors(scoped(fields, 'company'))
      } else if (Object.keys(scoped(fields, 'admin')).length) {
        setStep(1)
        setErrors(scoped(fields, 'admin'))
      }
    } finally {
      setSaving(false)
    }
  }

  const adminField = (key: keyof typeof admin) => ({
    value: admin[key],
    error: errors[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setAdmin({ ...admin, [key]: e.target.value })
  })

  return (
    <AuthLayout>
      <form onSubmit={next} className="animate-in w-full max-w-2xl" noValidate>
        <p className="text-xs font-semibold tracking-wider text-primary uppercase">Primeiro acesso</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">Vamos configurar o sistema</h1>
        <p className="mt-1 text-sm text-muted">Leva menos de dois minutos. Você pode alterar tudo depois em Configurações.</p>

        <ol className="mt-8 flex items-center gap-2" aria-label="Etapas">
          {steps.map((s, i) => {
            const done = i < step
            const current = i === step
            return (
              <li key={s.title} className="flex flex-1 items-center gap-2">
                <span
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                    done ? 'bg-primary text-white' : current ? 'bg-primary-soft text-primary ring-2 ring-primary' : 'bg-surface-hover text-muted'
                  }`}
                  aria-current={current ? 'step' : undefined}
                >
                  {done ? <Check className="size-4" /> : i + 1}
                </span>
                <span className={`text-sm ${current ? 'font-medium text-ink' : 'text-muted'}`}>{s.title}</span>
                {i < steps.length - 1 && <span className="mx-2 h-px flex-1 bg-line" aria-hidden />}
              </li>
            )
          })}
        </ol>

        <div className="mt-6 rounded-xl border border-line bg-surface p-6">
          {submitError && (
            <div className="mb-4">
              <ErrorState message={submitError} />
            </div>
          )}

          {step === 0 && (
            <>
              <h2 className="mb-4 text-base font-semibold text-ink">Dados da empresa</h2>
              <CompanyFields value={company} onChange={setCompany} errors={errors} />
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="text-base font-semibold text-ink">Administrador do sistema</h2>
              <p className="mb-4 text-[13px] text-muted">
                Esta conta terá acesso completo: produtos, preços, funcionários, permissões e backups.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <TextField label="Nome completo" required autoFocus containerClassName="col-span-2" {...adminField('name')} />
                <TextField
                  label="Usuário para login"
                  required
                  autoComplete="username"
                  hint="Letras sem acento, números, ponto ou hífen."
                  containerClassName="col-span-2 md:col-span-1"
                  {...adminField('username')}
                />
                <div className="hidden md:block" />
                <PasswordField label="Senha" required autoComplete="new-password" hint="Mínimo de 8 caracteres, com letras e números." {...adminField('password')} />
                <PasswordField label="Confirmar senha" required autoComplete="new-password" {...adminField('passwordConfirm')} />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="mb-4 text-base font-semibold text-ink">Preferências iniciais</h2>
              <div className="flex flex-col gap-4">
                <Checkbox
                  label="Alertar produtos com estoque baixo"
                  description="Exibe avisos quando o estoque atingir o mínimo definido no produto."
                  checked={prefs.lowStockAlerts}
                  onChange={(v) => setPrefs({ ...prefs, lowStockAlerts: v })}
                />
                <Checkbox
                  label="Permitir vender com estoque negativo"
                  description="Recomendado deixar desmarcado. Pode ser liberado por produto mais tarde."
                  checked={prefs.allowNegativeStock}
                  onChange={(v) => setPrefs({ ...prefs, allowNegativeStock: v })}
                />
              </div>
              <div className="mt-6 rounded-lg bg-surface-2 p-4 text-[13px] text-ink-2">
                <p className="font-medium text-ink">Resumo</p>
                <p className="mt-1">
                  Empresa: <strong>{company.tradeName || company.legalName}</strong> · Administrador:{' '}
                  <strong>{admin.username.trim().toLowerCase()}</strong>
                </p>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-between">
          <Button
            variant="ghost"
            onClick={() => {
              setErrors({})
              setStep(step - 1)
            }}
            disabled={step === 0 || saving}
            icon={<ArrowLeft className="size-4" />}
          >
            Voltar
          </Button>
          <Button type="submit" loading={saving} icon={step === steps.length - 1 ? <Check className="size-4" /> : undefined}>
            {step === steps.length - 1 ? 'Concluir e acessar' : 'Continuar'}
            {step < steps.length - 1 && <ArrowRight className="size-4" />}
          </Button>
        </div>
      </form>
    </AuthLayout>
  )
}
