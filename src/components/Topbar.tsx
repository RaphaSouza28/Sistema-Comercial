import { useEffect, useRef, useState } from 'react'
import { ChevronDown, KeyRound, LogOut, Moon, Search, Sun } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'

export function Topbar({ onSearch, onChangePassword }: { onSearch(): void; onChangePassword(): void }) {
  const { user, logout } = useAuth()
  const { resolved, toggle } = useTheme()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menuOpen])

  const initials = (user?.name ?? '?')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-surface px-5">
      <button
        type="button"
        onClick={onSearch}
        className="flex h-9 w-full max-w-sm items-center gap-2 rounded-md border border-line bg-surface-2 px-3 text-sm text-muted hover:border-line-strong"
      >
        <Search className="size-4" aria-hidden />
        <span className="flex-1 text-left">Busca rápida…</span>
        <kbd className="rounded border border-line bg-surface px-1.5 text-[11px]">Ctrl K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          onClick={toggle}
          className="flex size-9 items-center justify-center rounded-md text-ink-2 hover:bg-surface-hover hover:text-ink"
          aria-label={resolved === 'dark' ? 'Usar tema claro' : 'Usar tema escuro'}
          title={resolved === 'dark' ? 'Tema claro' : 'Tema escuro'}
        >
          {resolved === 'dark' ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2.5 rounded-md py-1 pr-2 pl-1 hover:bg-surface-hover"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
              {initials}
            </span>
            <span className="hidden text-left leading-tight sm:block">
              <span className="block text-[13px] font-medium text-ink">{user?.name}</span>
              <span className="block text-[11px] text-muted">{user?.role.name}</span>
            </span>
            <ChevronDown className="size-4 text-muted" aria-hidden />
          </button>
          {menuOpen && (
            <div role="menu" className="animate-in absolute right-0 z-40 mt-1 w-52 rounded-lg border border-line bg-surface p-1 shadow-lg">
              <div className="px-3 py-2 text-xs text-muted">
                Conectado como <span className="font-medium text-ink-2">{user?.username}</span>
              </div>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false)
                  onChangePassword()
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-hover"
              >
                <KeyRound className="size-4 text-muted" aria-hidden /> Alterar senha
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => void logout()}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-danger hover:bg-danger-soft"
              >
                <LogOut className="size-4" aria-hidden /> Sair
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
