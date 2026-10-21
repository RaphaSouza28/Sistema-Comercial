import type { ReactNode } from 'react'
import { HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { Loader2, ShieldAlert } from 'lucide-react'
import { MODULES, canAccessModule, type ModuleDefinition } from '@shared/modules'
import { ErrorState } from '@/components/ui/Feedback'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ToastProvider } from '@/contexts/ToastContext'
import { AppLayout } from '@/layouts/AppLayout'
import { DashboardPage } from '@/pages/Dashboard'
import { LoginPage } from '@/pages/Login'
import { ModulePlaceholder } from '@/pages/ModulePlaceholder'
import { ProductFormPage } from '@/pages/products/ProductFormPage'
import { ProductsPage } from '@/pages/products/ProductsPage'
import { SettingsPage } from '@/pages/Settings'
import { SetupWizardPage } from '@/pages/SetupWizard'
import { SuppliersPage } from '@/pages/SuppliersPage'
import { StockPage } from '@/pages/stock/StockPage'
import { PdvPage } from '@/pages/pdv/PdvPage'
import { CashPage } from '@/pages/cash/CashPage'
import { UsersPage } from '@/pages/Users'
import { CustomersPage } from '@/pages/customers/CustomersPage'
import { OrdersPage } from '@/pages/orders/OrdersPage'
import { QuotesPage } from '@/pages/quotes/QuotesPage'
import { CatalogPage } from '@/pages/catalog/CatalogPage'
import { PayablesPage } from '@/pages/finance/PayablesPage'
import { ReceivablesPage } from '@/pages/finance/ReceivablesPage'
import { ReportsPage } from '@/pages/reports/ReportsPage'
import { FiscalPage } from '@/pages/fiscal/FiscalPage'
import { TefPage } from '@/pages/tef/TefPage'

const PAGES: Record<string, () => ReactNode> = {
  dashboard: () => <DashboardPage />,
  products: () => <ProductsPage />,
  suppliers: () => <SuppliersPage />,
  stock: () => <StockPage />,
  pdv: () => <PdvPage />,
  cash: () => <CashPage />,
  customers: () => <CustomersPage />,
  orders: () => <OrdersPage />,
  quotes: () => <QuotesPage />,
  catalog: () => <CatalogPage />,
  payables: () => <PayablesPage />,
  receivables: () => <ReceivablesPage />,
  reports: () => <ReportsPage />,
  fiscal: () => <FiscalPage />,
  tef: () => <TefPage />,
  users: () => <UsersPage />,
  settings: () => <SettingsPage />
}

function Guard({ module, page: override }: { module: ModuleDefinition; page?: () => ReactNode }) {
  const { user } = useAuth()
  if (!user || !canAccessModule(module, user.permissions)) return <Forbidden />
  const page = override ?? PAGES[module.key]
  return page ? <>{page()}</> : <ModulePlaceholder module={module} />
}

const PRODUCTS_MODULE = MODULES.find((m) => m.key === 'products')!

function Forbidden() {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <ShieldAlert className="size-10 text-muted" aria-hidden />
      <h1 className="mt-4 text-lg font-semibold text-ink">Acesso não permitido</h1>
      <p className="mt-1 text-sm text-muted">Seu perfil não tem permissão para este módulo. Fale com o administrador.</p>
    </div>
  )
}

/** Primeira tela acessível ao usuário (operadores não têm dashboard). */
function HomeRedirect() {
  const { user } = useAuth()
  const first = MODULES.find((m) => canAccessModule(m, user?.permissions ?? []))
  if (!first) return <Forbidden />
  return first.path === '/' ? <Guard module={first} /> : <Navigate to={first.path} replace />
}

function NotFound() {
  return (
    <div className="flex flex-col items-center py-20 text-center">
      <h1 className="text-lg font-semibold text-ink">Página não encontrada</h1>
      <Link to="/" className="mt-4 text-sm font-medium text-primary hover:underline">
        Voltar ao início
      </Link>
    </div>
  )
}

function Root() {
  const { status, error, refresh } = useAuth()

  if (status === 'loading') {
    return (
      <div className="flex h-full items-center justify-center text-muted" role="status">
        <Loader2 className="size-6 animate-spin" aria-hidden />
        <span className="sr-only">Carregando…</span>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="w-full max-w-md">
          <ErrorState message={error ?? 'Falha ao iniciar o sistema.'} onRetry={() => void refresh()} />
        </div>
      </div>
    )
  }
  if (status === 'needs-setup') return <SetupWizardPage />
  if (status === 'anonymous') return <LoginPage />

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<HomeRedirect />} />
        {MODULES.filter((m) => m.path !== '/').map((m) => (
          <Route key={m.key} path={m.path} element={<Guard module={m} />} />
        ))}
        <Route path="/produtos/:id" element={<Guard module={PRODUCTS_MODULE} page={() => <ProductFormPage />} />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <HashRouter>
            <Root />
          </HashRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  )
}
