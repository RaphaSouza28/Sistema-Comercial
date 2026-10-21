import { NavLink } from 'react-router-dom'
import { PanelLeftClose, PanelLeftOpen, Store } from 'lucide-react'
import { MODULES, canAccessModule } from '@shared/modules'
import { useAuth } from '@/contexts/AuthContext'
import { MODULE_ICONS } from '@/lib/moduleIcons'

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle(): void }) {
  const { user } = useAuth()
  const modules = MODULES.filter((m) => canAccessModule(m, user?.permissions ?? []))

  return (
    <aside
      className={`flex h-full shrink-0 flex-col bg-sidebar text-sidebar-text transition-[width] duration-200 ${collapsed ? 'w-16' : 'w-60'}`}
      aria-label="Menu principal"
    >
      <div className={`flex h-14 items-center gap-2.5 border-b border-white/5 ${collapsed ? 'justify-center' : 'px-4'}`}>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-white">
          <Store className="size-[18px]" aria-hidden />
        </div>
        {!collapsed && <span className="truncate text-[15px] font-semibold text-white">Sistema Comercial</span>}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="flex flex-col gap-0.5">
          {modules.map((m) => {
            const Icon = MODULE_ICONS[m.key]
            return (
              <li key={m.key}>
                <NavLink
                  to={m.path}
                  end={m.path === '/'}
                  title={collapsed ? m.label : undefined}
                  className={({ isActive }) =>
                    `group flex h-9 items-center gap-3 rounded-md text-[13.5px] transition-colors ${
                      collapsed ? 'justify-center' : 'px-3'
                    } ${isActive ? 'bg-sidebar-active font-medium text-white' : 'hover:bg-white/5 hover:text-white'}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={`size-[18px] shrink-0 ${isActive ? 'text-primary-hover' : ''}`} aria-hidden />
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate">{m.label}</span>
                          {!m.implemented && (
                            <span className="rounded bg-white/5 px-1.5 py-px text-[10px] font-medium text-sidebar-muted">
                              Fase {m.phase}
                            </span>
                          )}
                        </>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            )
          })}
        </ul>
      </nav>

      <button
        type="button"
        onClick={onToggle}
        className={`flex h-11 items-center gap-3 border-t border-white/5 text-[13px] text-sidebar-muted hover:text-white ${collapsed ? 'justify-center' : 'px-5'}`}
        aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
        title={collapsed ? 'Expandir menu' : 'Recolher menu'}
      >
        {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
        {!collapsed && 'Recolher menu'}
      </button>
    </aside>
  )
}
