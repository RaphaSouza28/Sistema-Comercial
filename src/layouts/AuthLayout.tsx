import type { ReactNode } from 'react'
import { Boxes, ChartColumn, ShieldCheck, ShoppingCart, Store } from 'lucide-react'

const highlights = [
  { icon: ShoppingCart, text: 'PDV rápido com controle de caixa' },
  { icon: Boxes, text: 'Estoque com movimentações rastreáveis' },
  { icon: ChartColumn, text: 'Indicadores calculados a partir das suas vendas' },
  { icon: ShieldCheck, text: 'Dados guardados neste computador, com backup' }
]

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full">
      <aside className="hidden w-[420px] shrink-0 flex-col justify-between bg-sidebar p-10 text-sidebar-text lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-white">
            <Store className="size-5" aria-hidden />
          </div>
          <span className="text-lg font-semibold text-white">Sistema Comercial</span>
        </div>
        <div>
          <h2 className="text-2xl leading-snug font-semibold text-white">Gestão completa da sua loja, em um só lugar.</h2>
          <ul className="mt-8 flex flex-col gap-4">
            {highlights.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm">
                <span className="flex size-8 items-center justify-center rounded-lg bg-white/5">
                  <Icon className="size-4 text-primary-hover" aria-hidden />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-sidebar-muted">Funciona offline. Seus dados ficam neste computador.</p>
      </aside>
      <main className="flex flex-1 items-center justify-center overflow-y-auto bg-bg p-6">{children}</main>
    </div>
  )
}
