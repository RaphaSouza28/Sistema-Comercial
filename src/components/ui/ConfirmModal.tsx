import { useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

/** Confirmação de operações críticas (excluir, aplicar alterações em lote...). */
export function ConfirmModal({
  open,
  title,
  children,
  confirmLabel = 'Confirmar',
  danger = false,
  onConfirm,
  onClose
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm(): Promise<void> | void
  onClose(): void
}) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal
      open={open}
      size="sm"
      title={title}
      onClose={onClose}
      locked={busy}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            loading={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
              } finally {
                setBusy(false)
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-2">{children}</div>
    </Modal>
  )
}
