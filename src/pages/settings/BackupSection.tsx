import { useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, DatabaseBackup, FolderOpen, HardDriveDownload, KeyRound, Lock, RotateCcw, ShieldCheck, Upload } from 'lucide-react'
import type { BackupDto, BackupInspection, BackupOverview } from '@shared/api'
import { BACKUP_INTERVALS, type BackupSettings } from '@shared/backupSchemas'
import { formatDateTime, formatInteger } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Checkbox, PasswordField, SelectField, TextField } from '@/components/ui/Field'
import { Badge, ErrorState, Spinner } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage, fieldErrors } from '@/services/api'

const KIND: Record<BackupDto['kind'], string> = { MANUAL: 'Manual', AUTOMATIC: 'Automático', PRE_MIGRATION: 'Antes de atualização', PRE_RESTORE: 'Antes de restauração' }

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
  return `${(n / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`
}

/** Backup manual e automático (pasta/dispositivo externo, criptografia, retenção), histórico e restauração. */
export function BackupSection() {
  const toast = useToast()
  const overview = useAsync(() => call(api.backup.overview()))
  const history = useAsync(() => call(api.backup.history()))
  const [form, setForm] = useState<BackupSettings | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [restoring, setRestoring] = useState<{ inspection: BackupInspection | null; recordId?: number } | null>(null)
  useEffect(() => setForm(overview.data?.settings ?? null), [overview.data])
  const refresh = () => {
    void overview.reload()
    void history.reload()
  }
  const run = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label)
    try {
      await fn()
      if (ok) toast.success(ok)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
      refresh()
    }
  }

  if (overview.error) return <ErrorState message={overview.error} onRetry={() => void overview.reload()} />
  if (!overview.data || !form) return <Spinner />
  const o: BackupOverview = overview.data
  const dirty = JSON.stringify(form) !== JSON.stringify(o.settings)

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <DatabaseBackup className="size-4 text-muted" /> Backup e restauração
          </span>
        }
        description="Cópia consistente do banco (sem interromper o uso), verificada por integridade e assinatura SHA-256."
        actions={
          <Button icon={<HardDriveDownload className="size-4" />} loading={busy === 'create'} disabled={!!busy || o.restorePending} onClick={() => void run('create', () => call(api.backup.create()), 'Backup concluído e verificado.')}>
            Fazer backup agora
          </Button>
        }
      />
      <div className="flex flex-col gap-4 px-5 pb-5">
        {o.restorePending && <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">Há uma restauração agendada: ela será aplicada ao reiniciar o sistema.</p>}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <p className="text-xs text-muted">Último backup</p>
            {o.lastSuccess ? (
              <p className="flex items-center gap-1.5 text-ink">
                <CircleCheck className="size-4 text-success" aria-hidden /> {formatDateTime(o.lastSuccess.createdAt)} · {KIND[o.lastSuccess.kind]}
              </p>
            ) : (
              <p className="text-warning">Nenhum backup ainda</p>
            )}
          </div>
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <p className="text-xs text-muted">Próximo automático</p>
            <p className="text-ink">{o.nextAutomaticAt ? formatDateTime(o.nextAutomaticAt) : 'Desativado'}</p>
          </div>
          <div className="rounded-lg bg-surface-2 p-3 text-sm">
            <p className="text-xs text-muted">Banco de dados / espaço livre no destino</p>
            <p className="text-ink">
              {formatBytes(o.databaseBytes)} / {o.freeBytes !== null ? formatBytes(o.freeBytes) : '—'}
            </p>
          </div>
        </div>
        {o.lastFailure && (
          <p className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Último backup {KIND[o.lastFailure.kind].toLowerCase()} falhou em {formatDateTime(o.lastFailure.createdAt)}: {o.lastFailure.message}
            </span>
          </p>
        )}

        <fieldset className="grid grid-cols-1 gap-3 rounded-lg border border-line p-4 md:grid-cols-4">
          <legend className="px-1 text-[13px] font-semibold text-ink">Configuração</legend>
          <div className="flex flex-col gap-1.5 md:col-span-4">
            <span className="text-[13px] font-medium text-ink-2">Pasta dos backups</span>
            <div className="flex flex-wrap items-center gap-2">
              <code className="flex-1 truncate rounded-md bg-surface-2 px-3 py-2 text-xs text-ink" title={form.directory ?? o.defaultDirectory}>
                {form.directory ?? `${o.defaultDirectory} (padrão)`}
              </code>
              {!o.directoryAvailable && !dirty && <Badge tone="danger">Indisponível</Badge>}
              <Button size="sm" variant="secondary" icon={<FolderOpen className="size-4" />} onClick={async () => {
                const dir = await call(api.backup.chooseDirectory()).catch((e) => (toast.error(errorMessage(e)), null))
                if (dir) setForm({ ...form, directory: dir })
              }}>
                Escolher pasta
              </Button>
              {form.directory && (
                <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, directory: null })}>
                  Usar a padrão
                </Button>
              )}
            </div>
            <p className="text-xs text-muted">Para levar uma cópia para fora da loja, escolha uma pasta em pendrive ou HD externo. Se o dispositivo estiver desconectado, o backup falha e o aviso aparece aqui.</p>
          </div>
          <div className="flex items-end md:col-span-1">
            <Checkbox label="Backup automático" checked={form.automatic} onChange={(v) => setForm({ ...form, automatic: v })} />
          </div>
          <SelectField label="Frequência" disabled={!form.automatic} value={form.intervalHours} onChange={(e) => setForm({ ...form, intervalHours: Number(e.target.value) as BackupSettings['intervalHours'] })} options={Object.entries(BACKUP_INTERVALS).map(([value, label]) => ({ value, label }))} />
          <TextField label="Manter os últimos (automáticos)" type="number" min={3} max={120} disabled={!form.automatic} value={form.retention} onChange={(e) => setForm({ ...form, retention: Number(e.target.value) })} />
          <div className="flex flex-col justify-end gap-2">
            <Checkbox label="Criptografar os backups" description={o.passwordConfigured ? 'Senha definida neste computador' : 'Defina a senha antes'} checked={form.encrypt} onChange={(v) => setForm({ ...form, encrypt: v })} />
          </div>
          <div className="flex flex-wrap justify-end gap-2 md:col-span-4">
            <Button variant="secondary" icon={<KeyRound className="size-4" />} onClick={() => setPasswordOpen(true)}>
              {o.passwordConfigured ? 'Alterar senha do backup' : 'Definir senha do backup'}
            </Button>
            <Button loading={busy === 'save'} disabled={!dirty || !!busy} onClick={() => void run('save', async () => overview.setData(await call(api.backup.updateSettings(form))), 'Configuração de backup salva.')}>
              Salvar configuração
            </Button>
          </div>
        </fieldset>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-[13px] font-semibold text-ink">Histórico</p>
            <Button size="sm" variant="secondary" icon={<Upload className="size-4" />} disabled={!!busy} onClick={() => setRestoring({ inspection: null })}>
              Restaurar de um arquivo…
            </Button>
          </div>
          {!history.data ? (
            <Spinner />
          ) : history.data.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted">Nenhum backup registrado.</p>
          ) : (
            <div className="max-h-80 overflow-auto rounded-lg border border-line">
              <table className="w-full text-sm" aria-label="Histórico de backups">
                <thead className="sticky top-0 bg-surface-2 text-left text-[12px] text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Data</th>
                    <th className="px-3 py-2 font-medium">Tipo</th>
                    <th className="px-3 py-2 font-medium">Arquivo</th>
                    <th className="px-3 py-2 text-right font-medium">Tamanho</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((b) => (
                    <tr key={b.id} className="border-t border-line">
                      <td className="px-3 py-2 whitespace-nowrap text-ink-2">{formatDateTime(b.createdAt)}</td>
                      <td className="px-3 py-2 text-ink-2">
                        {KIND[b.kind]}
                        {b.userName && <span className="block text-xs text-muted">{b.userName}</span>}
                      </td>
                      <td className="max-w-72 px-3 py-2">
                        <span className="flex items-center gap-1 truncate text-xs text-ink" title={b.path}>
                          {b.encrypted && <Lock className="size-3 shrink-0 text-muted" aria-label="Criptografado" />} {b.fileName}
                        </span>
                        {b.message && <span className="block truncate text-xs text-muted" title={b.message}>{b.message}</span>}
                      </td>
                      <td className="tabular px-3 py-2 text-right text-ink-2">{b.sizeBytes ? formatBytes(b.sizeBytes) : '—'}</td>
                      <td className="px-3 py-2">
                        {b.status === 'FAILED' ? <Badge tone="danger">Falhou</Badge> : b.status === 'REMOVED' ? <Badge>Removido</Badge> : b.exists ? <Badge tone="success">OK</Badge> : <Badge tone="warning">Arquivo não encontrado</Badge>}
                      </td>
                      <td className="px-3 py-1.5">
                        {b.exists && (
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" aria-label={`Verificar backup ${b.fileName}`} title="Verificar integridade" icon={<ShieldCheck className="size-3.5" />} disabled={!!busy} onClick={() => void run(`v${b.id}`, () => call(api.backup.verify({ id: b.id })), 'Backup íntegro: assinatura e banco conferidos.')} />
                            <Button size="sm" variant="ghost" aria-label={`Mostrar ${b.fileName} na pasta`} title="Mostrar na pasta" icon={<FolderOpen className="size-3.5" />} onClick={() => void call(api.backup.showInFolder({ id: b.id })).catch((e) => toast.error(errorMessage(e)))} />
                            <Button size="sm" variant="ghost" aria-label={`Restaurar ${b.fileName}`} title="Restaurar" icon={<RotateCcw className="size-3.5" />} disabled={!!busy} onClick={() => setRestoring({ inspection: null, recordId: b.id })} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {passwordOpen && <BackupPasswordModal onClose={() => setPasswordOpen(false)} onSaved={() => (setPasswordOpen(false), refresh())} />}
      {restoring && <RestoreModal recordId={restoring.recordId} onClose={() => setRestoring(null)} />}
    </Card>
  )
}

function BackupPasswordModal({ onClose, onSaved }: { onClose(): void; onSaved(): void }) {
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  return (
    <Modal
      open
      size="sm"
      title="Senha do backup"
      description="Guardada protegida pelo Windows neste computador. Anote-a em local seguro: sem ela, um backup criptografado não pode ser restaurado em outro computador."
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button
            loading={saving}
            onClick={async () => {
              setSaving(true)
              setErrors({})
              try {
                await call(api.backup.setPassword({ password, passwordConfirm: confirm }))
                toast.success('Senha do backup definida.')
                onSaved()
              } catch (e) {
                setErrors(fieldErrors(e))
                toast.error(errorMessage(e))
              } finally {
                setSaving(false)
              }
            }}
          >
            Salvar senha
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <PasswordField label="Nova senha do backup" autoComplete="new-password" value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
        <PasswordField label="Confirmar senha do backup" autoComplete="new-password" value={confirm} error={errors.passwordConfirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
    </Modal>
  )
}

/** Conferência do conteúdo + confirmação com a senha do usuário antes de substituir os dados. */
function RestoreModal({ recordId, onClose }: { recordId?: number; onClose(): void }) {
  const toast = useToast()
  const [inspection, setInspection] = useState<BackupInspection | null>(null)
  const [backupPassword, setBackupPassword] = useState('')
  const [needsPassword, setNeedsPassword] = useState(false)
  const [userPassword, setUserPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const inspect = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = recordId ? await call(api.backup.inspect({ id: recordId, backupPassword: backupPassword || undefined })) : await call(api.backup.inspectFile({ backupPassword: backupPassword || undefined }))
      if (r) setInspection(r)
    } catch (e) {
      setError(errorMessage(e))
      if (/criptografado|Senha do backup/.test(errorMessage(e))) setNeedsPassword(true)
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    if (recordId) void inspect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId])

  const restore = async () => {
    setBusy(true)
    setError(null)
    try {
      await call(api.backup.restore({ token: inspection!.token, userPassword, confirmText: confirmText as 'RESTAURAR' }))
      setDone(true)
      toast.success('Restauração agendada. O sistema vai reiniciar.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      size="md"
      title="Restaurar backup"
      onClose={onClose}
      locked={busy || done}
      footer={
        !done && (
          <>
            <Button variant="secondary" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            {inspection ? (
              <Button variant="danger" loading={busy} disabled={!userPassword || confirmText !== 'RESTAURAR'} onClick={() => void restore()}>
                Restaurar e reiniciar
              </Button>
            ) : (
              <Button loading={busy} onClick={() => void inspect()}>
                {recordId ? 'Conferir backup' : 'Escolher arquivo…'}
              </Button>
            )}
          </>
        )
      }
    >
      {done ? (
        <p className="flex items-center gap-2 text-sm text-ink" role="status">
          <Spinner label="Reiniciando o sistema para aplicar a restauração…" />
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {error && <ErrorState message={error} />}
          {(needsPassword || !recordId) && !inspection && (
            <PasswordField label="Senha do backup (se criptografado)" autoComplete="off" value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} />
          )}
          {inspection && (
            <>
              <dl className="grid grid-cols-2 gap-2 rounded-lg bg-surface-2 p-3 text-sm">
                <dt className="text-muted">Arquivo</dt>
                <dd className="truncate text-ink" title={inspection.fileName}>
                  {inspection.fileName}
                </dd>
                <dt className="text-muted">Empresa</dt>
                <dd className="text-ink">{inspection.companyName ?? '—'}</dd>
                <dt className="text-muted">Gravado em</dt>
                <dd className="text-ink">{formatDateTime(inspection.modifiedAt)}</dd>
                <dt className="text-muted">Última venda</dt>
                <dd className="text-ink">{inspection.lastSaleAt ? formatDateTime(inspection.lastSaleAt) : 'nenhuma'}</dd>
                <dt className="text-muted">Conteúdo</dt>
                <dd className="text-ink">
                  {formatInteger(inspection.counts.products)} produtos · {formatInteger(inspection.counts.customers)} clientes · {formatInteger(inspection.counts.sales)} vendas · {formatInteger(inspection.counts.users)} usuários
                </dd>
              </dl>
              {inspection.needsUpgrade && <p className="text-xs text-ink-2">Backup de versão anterior: o banco será atualizado automaticamente ao reiniciar.</p>}
              <p className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                Todos os dados atuais serão substituídos pelos deste backup. Antes da troca, o sistema guarda uma cópia do banco atual na pasta padrão de backups.
              </p>
              <PasswordField label="Sua senha" autoComplete="current-password" value={userPassword} onChange={(e) => setUserPassword(e.target.value)} />
              <TextField label='Digite RESTAURAR para confirmar' autoComplete="off" value={confirmText} onChange={(e) => setConfirmText(e.target.value.toUpperCase())} />
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
