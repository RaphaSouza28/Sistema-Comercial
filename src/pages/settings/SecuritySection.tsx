import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { SecuritySettings } from '@shared/backupSchemas'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { SelectField } from '@/components/ui/Field'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage } from '@/services/api'

/** Bloqueio por inatividade: a sessão é encerrada e o sistema volta à tela de login. */
export function SecuritySection() {
  const toast = useToast()
  const { refresh } = useAuth()
  const { data, setData } = useAsync(() => call(api.security.settings()))
  const [form, setForm] = useState<SecuritySettings | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => setForm(data), [data])
  if (!form) return null
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-muted" /> Segurança
          </span>
        }
        description="Senhas guardadas com hash seguro (scrypt), bloqueio após tentativas erradas e auditoria das operações críticas."
      />
      <div className="flex flex-wrap items-end gap-3 px-5 pb-5">
        <SelectField
          label="Encerrar a sessão após inatividade"
          containerClassName="w-72"
          value={form.idleMinutes}
          onChange={(e) => setForm({ idleMinutes: Number(e.target.value) as SecuritySettings['idleMinutes'] })}
          options={[
            { value: 0, label: 'Nunca' },
            { value: 15, label: '15 minutos' },
            { value: 30, label: '30 minutos' },
            { value: 60, label: '1 hora' },
            { value: 120, label: '2 horas' }
          ]}
        />
        <Button
          loading={saving}
          disabled={form.idleMinutes === data?.idleMinutes}
          onClick={async () => {
            setSaving(true)
            try {
              setData(await call(api.security.update(form)))
              toast.success('Configuração de segurança salva.')
              void refresh() // aplica o novo limite à sessão atual
            } catch (e) {
              toast.error(errorMessage(e))
            } finally {
              setSaving(false)
            }
          }}
        >
          Salvar
        </Button>
        <p className="w-full text-xs text-muted">Recomendado em computadores compartilhados: quem voltar ao caixa precisa entrar com o próprio usuário.</p>
      </div>
    </Card>
  )
}
