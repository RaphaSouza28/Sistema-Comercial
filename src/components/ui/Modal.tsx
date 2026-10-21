import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  title: string
  description?: string
  onClose(): void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Impede fechar com ESC/clique fora (ex.: durante gravação). */
  locked?: boolean
}

const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl' }

/** Modais abertos, do mais antigo ao mais recente: ESC fecha só o de cima. */
const openStack: string[] = []

export function Modal({ open, title, description, onClose, children, footer, size = 'md', locked = false }: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef({ onClose, locked })
  closeRef.current = { onClose, locked }

  // Foco inicial e restauração: só quando o modal abre/fecha (não a cada renderização).
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const first = panelRef.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])')
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || openStack[openStack.length - 1] !== titleId) return
      e.stopImmediatePropagation()
      if (!closeRef.current.locked) closeRef.current.onClose()
    }
    openStack.push(titleId)
    window.addEventListener('keydown', onKey)
    return () => {
      openStack.splice(openStack.indexOf(titleId), 1)
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !locked && onClose()} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`animate-in relative flex max-h-[90vh] w-full flex-col rounded-xl border border-line bg-surface shadow-2xl ${widths[size]}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-ink">
              {title}
            </h2>
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          <button
            type="button"
            data-close
            onClick={onClose}
            disabled={locked}
            className="rounded-md p-1 text-muted hover:bg-surface-hover hover:text-ink disabled:opacity-40"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}
