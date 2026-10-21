import { useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, History, PackageX, SlidersHorizontal, TriangleAlert, Wallet } from 'lucide-react'
import { formatInteger, formatMoney } from '@shared/format'
import { StatTile } from '@/components/dashboard/StatTile'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/Card'
import { Tabs } from '@/components/ui/Tabs'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call } from '@/services/api'
import type { StockItem } from '@shared/api'
import { InventoriesTab } from './InventoriesTab'
import { MovementsTab } from './MovementsTab'
import { OverviewTab } from './OverviewTab'
import { AdjustModal, EntryModal, ExitModal } from './StockOperations'

type Tab = 'overview' | 'movements' | 'inventories'

export function StockPage() {
  const { can } = useAuth()
  const canManage = can('stock.manage')
  const [tab, setTab] = useState<Tab>('overview')
  const [version, setVersion] = useState(0)
  const summary = useAsync(() => call(api.stock.summary()), [version])
  const [entryOpen, setEntryOpen] = useState(false)
  const [exitOpen, setExitOpen] = useState(false)
  const [adjusting, setAdjusting] = useState<StockItem | 'pick' | null>(null)
  const [historyOf, setHistoryOf] = useState<StockItem | null>(null)
  const refresh = () => setVersion((v) => v + 1)
  const s = summary.data
  const needsRestock = s ? s.lowCount + s.outCount + s.negativeCount : 0

  return (
    <div className="animate-in">
      <PageHeader
        title="Estoque"
        description="Posição, movimentações, entradas, saídas e inventário."
        actions={
          canManage && (
            <>
              <Button variant="secondary" icon={<SlidersHorizontal className="size-4" />} onClick={() => setAdjusting('pick')}>
                Ajuste
              </Button>
              <Button variant="secondary" icon={<ArrowUpFromLine className="size-4" />} onClick={() => setExitOpen(true)}>
                Saída
              </Button>
              <Button icon={<ArrowDownToLine className="size-4" />} onClick={() => setEntryOpen(true)}>
                Entrada de mercadorias
              </Button>
            </>
          )
        }
      />

      {s && (
        <section aria-label="Resumo do estoque" className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
          <StatTile label="Itens em estoque" value={formatInteger(s.positions)} hint="Produtos e variações ativos" icon={<Boxes />} />
          <StatTile
            label="Custo total do estoque"
            value={s.stockValueCents === null ? '—' : formatMoney(s.stockValueCents)}
            hint={s.stockValueCents === null ? 'Sem permissão para ver custos' : 'Quantidade × custo unitário'}
            icon={<Wallet />}
          />
          <StatTile label="Precisam de reposição" value={formatInteger(needsRestock)} hint={`${s.lowCount} baixo · ${s.outCount} esgotado${s.negativeCount ? ` · ${s.negativeCount} negativo` : ''}`} icon={<PackageX />} />
          <StatTile label="Sem movimentação" value={formatInteger(s.staleCount)} hint={`Nos últimos ${s.staleDays} dias`} icon={<History />} />
        </section>
      )}

      {s?.lowStockAlerts && needsRestock > 0 && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          <TriangleAlert className="size-5 shrink-0" aria-hidden />
          <span className="flex-1">
            {needsRestock} item(ns) no estoque mínimo, esgotados ou negativos. Veja a lista de reposição.
          </span>
        </div>
      )}

      <Tabs
        tabs={[
          { key: 'overview', label: 'Posição de estoque', icon: Boxes },
          { key: 'movements', label: 'Movimentações', icon: History },
          { key: 'inventories', label: 'Inventário', icon: ClipboardCheck }
        ]}
        value={tab}
        onChange={(k) => setTab(k as Tab)}
      />
      {tab === 'overview' && (
        <OverviewTab
          version={version}
          onAdjust={canManage ? setAdjusting : undefined}
          onHistory={(item) => {
            setHistoryOf(item)
            setTab('movements')
          }}
        />
      )}
      {tab === 'movements' && <MovementsTab version={version} item={historyOf} onClearItem={() => setHistoryOf(null)} />}
      {tab === 'inventories' && <InventoriesTab onChanged={refresh} />}

      <EntryModal open={entryOpen} onClose={() => setEntryOpen(false)} onDone={refresh} />
      <ExitModal open={exitOpen} onClose={() => setExitOpen(false)} onDone={refresh} />
      <AdjustModal item={adjusting} onClose={() => setAdjusting(null)} onDone={refresh} />
    </div>
  )
}
