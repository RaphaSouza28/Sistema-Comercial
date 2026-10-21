import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Archive, History, ShoppingCart, Wallet } from 'lucide-react'
import { formatDateTime, formatMoney } from '@shared/format'
import { PageHeader } from '@/components/ui/Card'
import { ErrorState, Spinner } from '@/components/ui/Feedback'
import { Tabs } from '@/components/ui/Tabs'
import { useAsync } from '@/hooks/useAsync'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { api, call, errorMessage } from '@/services/api'
import { OpenCash } from '@/pages/cash/OpenCash'
import { SaleScreen } from './SaleScreen'
import { SalesHistory } from './SalesHistory'
import { SourceSaleScreen } from './SourceSaleScreen'

type Tab = 'sale' | 'history'

export function PdvPage() {
  const [tab, setTab] = useState<Tab>('sale')
  const session = useAsync(() => call(api.cash.current()))
  const toast = useToast()
  const { can } = useAuth()
  const devices = useAsync(() => call(api.devices.settings()))
  const drawerEnabled = can('cash.operate') && !!devices.data && devices.data.cashDrawer.mode !== 'NONE'
  const [opening, setOpening] = useState(false)
  const openDrawer = async () => {
    setOpening(true)
    try {
      await call(api.devices.openDrawer())
      toast.success('Gaveta aberta (registrado na auditoria).')
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setOpening(false)
    }
  }
  // /pdv?pedido=ID ou /pdv?orcamento=ID: venda a partir de um documento
  const [params, setParams] = useSearchParams()
  const orderId = Number(params.get('pedido')) || undefined
  const quoteId = Number(params.get('orcamento')) || undefined
  const source = orderId || quoteId ? { orderId, quoteId: orderId ? undefined : quoteId } : null

  return (
    <div className="animate-in">
      <PageHeader
        title="PDV"
        description={
          session.data
            ? `Caixa #${session.data.id} aberto por ${session.data.userName} em ${formatDateTime(session.data.openedAt)} · ${session.data.salesCount} venda(s) · ${formatMoney(session.data.salesTotalCents)}`
            : 'Ponto de venda'
        }
        actions={
          session.data && (
            <>
            {drawerEnabled && (
              <Button variant="secondary" icon={<Archive className="size-4" />} loading={opening} onClick={() => void openDrawer()}>
                Abrir gaveta
              </Button>
            )}
            <span className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink-2">
              <Wallet className="size-4 text-muted" aria-hidden /> Dinheiro na gaveta:{' '}
              <strong className="tabular text-ink">{formatMoney(session.data.cashBalanceCents)}</strong>
            </span>
            </>
          )
        }
      />
      <Tabs
        tabs={[
          { key: 'sale', label: 'Venda', icon: ShoppingCart },
          { key: 'history', label: 'Vendas realizadas', icon: History }
        ]}
        value={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      {tab === 'sale' &&
        (session.loading && !session.data ? (
          <Spinner />
        ) : session.error ? (
          <ErrorState message={session.error} onRetry={() => void session.reload()} />
        ) : session.data && source ? (
          <SourceSaleScreen source={source} onExit={() => setParams({}, { replace: true })} onSaleCompleted={() => void session.reload()} />
        ) : session.data ? (
          <SaleScreen onSaleCompleted={() => void session.reload()} />
        ) : (
          <OpenCash onOpened={() => void session.reload()} />
        ))}
      {tab === 'history' && <SalesHistory onChanged={() => void session.reload()} />}
    </div>
  )
}
