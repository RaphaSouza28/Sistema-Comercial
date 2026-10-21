import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { MODULES, canAccessModule } from '@shared/modules'
import { useAuth } from '@/contexts/AuthContext'
import { MODULE_ICONS } from '@/lib/moduleIcons'

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Busca rápida (Ctrl+K): navegação por módulos. Nas próximas fases inclui produtos e clientes. */
export function CommandPalette({ open, onClose }: { open: boolean; onClose(): void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const q = normalize(query.trim())
    return MODULES.filter((m) => canAccessModule(m, user?.permissions ?? [])).filter(
      (m) => !q || normalize(`${m.label} ${m.description}`).includes(q)
    )
  }, [query, user])

  useEffect(() => {
    if (open) {
      setQuery('')
      setIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => setIndex(0), [query])

  if (!open) return null

  const go = (path: string) => {
    navigate(path)
    onClose()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[index]) {
      go(results[index].path)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-center bg-black/40 pt-[12vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca rápida"
        className="animate-in h-fit w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 text-muted" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Ir para um módulo…"
            className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
            aria-label="Buscar módulo"
          />
          <kbd className="rounded border border-line px-1.5 text-[11px] text-muted">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1.5" role="listbox">
          {results.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nenhum módulo encontrado.</li>}
          {results.map((m, i) => {
            const Icon = MODULE_ICONS[m.key]
            return (
              <li key={m.key} role="option" aria-selected={i === index}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => go(m.path)}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ${i === index ? 'bg-primary-soft' : ''}`}
                >
                  <Icon className="size-4 text-muted" aria-hidden />
                  <span className="flex-1">
                    <span className="block text-sm text-ink">{m.label}</span>
                    <span className="block text-xs text-muted">{m.description}</span>
                  </span>
                  {i === index && <CornerDownLeft className="size-3.5 text-muted" aria-hidden />}
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </div>,
    document.body
  )
}
