import { useEffect, useState, type FormEvent } from 'react'
import { Building2, Calculator, Info, Monitor, Moon, Palette, Sun } from 'lucide-react'
import type { CompanyDto, PricingSettings } from '@shared/api'
import { companySchema } from '@shared/schemas'
import { CompanyFields, emptyCompany, type CompanyForm } from '@/components/CompanyFields'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { ErrorState, Spinner } from '@/components/ui/Feedback'
import { PercentField } from '@/components/ui/NumberFields'
import { useTheme, type ThemePreference } from '@/contexts/ThemeContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { validate } from '@/lib/validation'
import { DevicesSection } from './settings/DevicesSection'
import { BackupSection } from './settings/BackupSection'
import { SecuritySection } from './settings/SecuritySection'
import { useAuth } from '@/contexts/AuthContext'
import { api, call, errorMessage, fieldErrors } from '@/services/api'

function toForm(c: CompanyDto | null): CompanyForm {
  if (!c) return emptyCompany
  const out = { ...emptyCompany }
  for (const key of Object.keys(emptyCompany) as (keyof CompanyForm)[]) out[key] = c[key] ?? ''
  return out
}

export function SettingsPage() {
  const { can } = useAuth()
  return (
    <div className="animate-in flex flex-col gap-4">
      <PageHeader title="Configurações" description="Dados da empresa, precificação, impressoras e dispositivos, backup, segurança, aparência e informações do sistema." />
      <CompanySection />
      <PricingSection />
      <DevicesSection />
      {can('backup.manage') && <BackupSection />}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <AppearanceSection />
        <SecuritySection />
      </div>
      <AboutSection />
    </div>
  )
}

function CompanySection() {
  const toast = useToast()
  const { data, error, loading, setData } = useAsync(() => call(api.company.get()))
  const [form, setForm] = useState<CompanyForm>(emptyCompany)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => setForm(toForm(data)), [data])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const clientErrors = validate(companySchema, form)
    setErrors(clientErrors)
    if (Object.keys(clientErrors).length) return
    setSaving(true)
    try {
      const updated = await call(api.company.update(form))
      setData(updated)
      toast.success('Dados da empresa salvos.')
    } catch (err) {
      setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Building2 className="size-4 text-muted" /> Empresa</span>} description="Usados em comprovantes, orçamentos e catálogo." />
      <form onSubmit={submit} className="px-5 pb-5" noValidate>
        {error && <ErrorState message={error} />}
        {loading && !data ? (
          <Spinner />
        ) : (
          <>
            <CompanyFields value={form} onChange={setForm} errors={errors} />
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setForm(toForm(data))} disabled={saving}>
                Descartar alterações
              </Button>
              <Button type="submit" loading={saving}>
                Salvar
              </Button>
            </div>
          </>
        )}
      </form>
    </Card>
  )
}

function PricingSection() {
  const toast = useToast()
  const { data, setData } = useAsync(() => call(api.settings.pricing()))
  const [form, setForm] = useState<PricingSettings | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => setForm(data), [data])
  if (!form) return null
  const set = (key: keyof PricingSettings) => (v: number | null) => setForm({ ...form, [key]: v ?? 0 })

  const save = async () => {
    setSaving(true)
    try {
      setData(await call(api.settings.updatePricing(form)))
      toast.success('Configurações de precificação salvas.')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={<span className="flex items-center gap-2"><Calculator className="size-4 text-muted" /> Precificação</span>}
        description="Valores sugeridos ao cadastrar produtos e limite para o alerta de margem baixa."
      />
      <div className="grid grid-cols-2 gap-4 px-5 pb-5 md:grid-cols-5">
        <PercentField label="Alerta de margem abaixo de" value={form.minMarginBps} onChange={set('minMarginBps')} />
        <PercentField label="Margem desejada padrão" value={form.defaultTargetMarginBps} onChange={set('defaultTargetMarginBps')} />
        <PercentField label="Impostos estimados" value={form.defaultTaxBps} onChange={set('defaultTaxBps')} />
        <PercentField label="Taxa de cartão" value={form.defaultCardFeeBps} onChange={set('defaultCardFeeBps')} />
        <PercentField label="Comissão" value={form.defaultCommissionBps} onChange={set('defaultCommissionBps')} />
        <div className="col-span-2 flex justify-end md:col-span-5">
          <Button loading={saving} disabled={JSON.stringify(form) === JSON.stringify(data)} onClick={() => void save()}>
            Salvar
          </Button>
        </div>
      </div>
    </Card>
  )
}

function AppearanceSection() {
  const { preference, setPreference } = useTheme()
  const options: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Claro', icon: Sun },
    { value: 'dark', label: 'Escuro', icon: Moon },
    { value: 'system', label: 'Igual ao Windows', icon: Monitor }
  ]
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Palette className="size-4 text-muted" /> Aparência</span>} description="Preferência deste computador." />
      <div className="grid grid-cols-3 gap-3 px-5 pb-5" role="radiogroup" aria-label="Tema">
        {options.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={preference === value}
            onClick={() => setPreference(value)}
            className={`flex flex-col items-center gap-2 rounded-lg border px-3 py-4 text-sm ${
              preference === value ? 'border-primary bg-primary-soft text-ink' : 'border-line text-ink-2 hover:bg-surface-hover'
            }`}
          >
            <Icon className="size-5" aria-hidden />
            {label}
          </button>
        ))}
      </div>
    </Card>
  )
}


function AboutSection() {
  const { data } = useAsync(() => call(api.app.info()))
  const rows: [string, string][] = data
    ? [
        ['Versão', `${data.version}${data.isPackaged ? '' : ' (desenvolvimento)'}`],
        ['Pasta de dados', data.dataDirectory],
        ['Banco de dados', data.databasePath],
        ['Electron / Node.js', `${data.electron} / ${data.node}`],
        ['Plataforma', data.platform]
      ]
    : []
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Info className="size-4 text-muted" /> Sobre o sistema</span>} />
      <dl className="grid grid-cols-[180px_1fr] gap-x-4 gap-y-2 px-5 pb-5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="selectable font-mono text-[12px] break-all text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}
