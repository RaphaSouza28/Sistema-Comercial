import { useState, type FormEvent } from 'react'
import { api, call, errorMessage, fieldErrors } from '@/services/api'
import { useToast } from '@/contexts/ToastContext'
import { Button } from './ui/Button'
import { PasswordField } from './ui/Field'
import { Modal } from './ui/Modal'

export function ChangePasswordModal({
  open,
  onClose,
  required = false,
  onChanged
}: {
  open: boolean
  onClose(): void
  /** Troca obrigatória (senha redefinida pelo administrador). */
  required?: boolean
  onChanged?(): void
}) {
  const toast = useToast()
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', newPasswordConfirm: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setErrors({})
    try {
      await call(api.auth.changePassword(form))
      toast.success('Senha alterada com sucesso.')
      setForm({ currentPassword: '', newPassword: '', newPasswordConfirm: '' })
      onChanged?.()
      onClose()
    } catch (err) {
      setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={required || saving}
      size="sm"
      title={required ? 'Defina uma nova senha' : 'Alterar senha'}
      description={required ? 'Sua senha foi redefinida pelo administrador. Escolha uma senha pessoal para continuar.' : undefined}
      footer={
        <>
          {!required && (
            <Button variant="secondary" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
          )}
          <Button type="submit" form="change-password" loading={saving}>
            Salvar nova senha
          </Button>
        </>
      }
    >
      <form id="change-password" onSubmit={submit} className="flex flex-col gap-4">
        <PasswordField label="Senha atual" autoComplete="current-password" value={form.currentPassword} onChange={set('currentPassword')} error={errors.currentPassword} required />
        <PasswordField label="Nova senha" autoComplete="new-password" value={form.newPassword} onChange={set('newPassword')} error={errors.newPassword} hint="Mínimo de 8 caracteres, com letras e números." required />
        <PasswordField label="Confirmar nova senha" autoComplete="new-password" value={form.newPasswordConfirm} onChange={set('newPasswordConfirm')} error={errors.newPasswordConfirm} required />
      </form>
    </Modal>
  )
}
