import { useState, type FormEvent, type ReactNode } from 'react'
import type { DocumentPreview } from '@shared/api'
import type { DocumentItemInput } from '@shared/commerceSchemas'
import { AuthorizationFields } from '@/components/AuthorizationFields'
import { DocumentEditor, toItemsInput, type DocumentValue } from '@/components/DocumentEditor'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/contexts/ToastContext'
import { errorMessage, fieldErrors } from '@/services/api'

export interface DocumentBaseInput {
  customerId: number | null
  items: DocumentItemInput[]
  discountCents: number
  notes: string | null
  authorization?: { username: string; password: string }
}

/** Formulário comum de pedido e orçamento: itens, cliente, descontos, observações e autorização. */
export function DocumentFormModal({
  title,
  formId,
  allowFreeText,
  initial,
  initialNotes,
  extra,
  onSubmit,
  onClose
}: {
  title: string
  formId: string
  allowFreeText: boolean
  initial: DocumentValue
  initialNotes: string | null
  /** Campos específicos (entrega, validade, contato); recebe o valor atual e os erros do servidor. */
  extra(value: DocumentValue, errors: Record<string, string>): ReactNode
  onSubmit(input: DocumentBaseInput): Promise<void>
  onClose(): void
}) {
  const toast = useToast()
  const [value, setValue] = useState<DocumentValue>(initial)
  const [notes, setNotes] = useState(initialNotes ?? '')
  const [preview, setPreview] = useState<DocumentPreview | null>(null)
  const [auth, setAuth] = useState({ username: '', password: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (value.lines.length === 0) return toast.error('Adicione ao menos um item.')
    setSaving(true)
    setErrors({})
    try {
      await onSubmit({
        customerId: value.customer?.id ?? null,
        items: toItemsInput(value.lines),
        discountCents: value.discountCents,
        notes: notes || null,
        authorization: preview?.requiresAuthorization ? auth : undefined
      })
    } catch (err) {
      setErrors(fieldErrors(err))
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      size="lg"
      title={title}
      onClose={onClose}
      locked={saving}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={saving}>
            Salvar
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <DocumentEditor value={value} onChange={setValue} allowFreeText={allowFreeText} onPreview={setPreview} />
        <div className="grid grid-cols-6 gap-4 border-t border-line pt-4">
          {extra(value, errors)}
          <TextField label="Observações" containerClassName="col-span-6" value={notes} error={errors.notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {preview?.requiresAuthorization && (
          <AuthorizationFields value={auth} onChange={setAuth} reason="O desconto ultrapassa o seu limite. Um gerente ou administrador precisa autorizar." />
        )}
      </form>
    </Modal>
  )
}
