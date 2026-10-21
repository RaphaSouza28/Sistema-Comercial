import { useState, type FormEvent } from 'react'
import { LockOpen } from 'lucide-react'
import { formatMoney } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { MoneyField } from '@/components/ui/NumberFields'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { api, call, errorMessage } from '@/services/api'

export function OpenCash({ onOpened }: { onOpened(): void }) {
  const { can } = useAuth()
  const toast = useToast()
  const [opening, setOpening] = useState(0)
  const [requestId] = useState(() => crypto.randomUUID())
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const s = await call(api.cash.open({ requestId, openingCents: opening }))
      toast.success(`Caixa #${s.id} aberto com ${formatMoney(s.openingCents)}.`)
      onOpened()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mx-auto max-w-md p-6 text-center">
      <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <LockOpen className="size-6" aria-hidden />
      </span>
      <h2 className="mt-4 text-lg font-semibold text-ink">Caixa fechado</h2>
      <p className="mt-1 text-sm text-muted">Abra o caixa informando o dinheiro inicial (troco) para começar a vender.</p>
      {can('cash.operate') ? (
        <form onSubmit={submit} className="mt-5 flex flex-col gap-4 text-left" noValidate>
          <MoneyField label="Valor inicial em dinheiro" value={opening} onChange={(v) => setOpening(v ?? 0)} hint="Conte o dinheiro da gaveta antes de abrir." />
          <Button type="submit" size="lg" loading={saving}>
            Abrir caixa
          </Button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-warning">Seu perfil não pode abrir caixa.</p>
      )}
    </Card>
  )
}
