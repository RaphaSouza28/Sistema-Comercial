import { Link } from 'react-router-dom'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import {
  Banknote,
  DatabaseBackup,
  Boxes,
  CalendarDays,
  CalendarRange,
  ChevronRight,
  ClipboardList,
  FileText,
  HandCoins,
  Package,
  Receipt,
  RefreshCw,
  Ticket as TicketIcon,
  ShoppingBag,
  TrendingUp,
  TriangleAlert,
  Wallet
} from 'lucide-react'
import type { DashboardSummary } from '@shared/api'
import { formatDateTime, formatInteger, formatMoney, formatQuantity } from '@shared/format'
import { PAYMENT_METHOD_LABELS, dayLabel, monthLabel } from '@shared/labels'
import { ChartCard } from '@/components/dashboard/ChartCard'
import { ChartTooltip } from '@/components/dashboard/ChartTooltip'
import { StatTile } from '@/components/dashboard/StatTile'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, PageHeader } from '@/components/ui/Card'
import { Badge, ErrorState, Spinner } from '@/components/ui/Feedback'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useChartColors } from '@/hooks/useChartColors'
import { api, call } from '@/services/api'

const compactMoney = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
const axisMoney = (cents: number) => (cents === 0 ? '0' : `R$ ${compactMoney.format(cents / 100)}`)

export function DashboardPage() {
  const { user } = useAuth()
  const { data, error, loading, reload } = useAsync(() => call(api.dashboard.summary()))

  return (
    <div className="animate-in">
      <PageHeader
        title={`Olá, ${user?.name.split(' ')[0] ?? ''}`}
        description={data ? `Indicadores atualizados em ${formatDateTime(data.generatedAt)}` : 'Visão geral do seu negócio'}
        actions={
          <Button variant="secondary" onClick={() => void reload()} loading={loading && !!data} icon={<RefreshCw className="size-4" />}>
            Atualizar
          </Button>
        }
      />
      {error && <ErrorState message={error} onRetry={() => void reload()} />}
      {!data && loading && <Spinner label="Calculando indicadores…" />}
      {data && <DashboardContent d={data} />}
    </div>
  )
}

function DashboardContent({ d }: { d: DashboardSummary }) {
  const colors = useChartColors()
  const hasDaily = d.charts.daily.some((p) => p.count > 0)
  const hasMonthly = d.charts.monthly.some((p) => p.totalCents !== 0)
  const axisTick = { fill: colors.axis, fontSize: 12 }

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Faturamento" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile emphasis label="Faturamento hoje" value={formatMoney(d.revenue.todayCents)} icon={<CalendarDays />} />
        <StatTile emphasis label="Faturamento na semana" value={formatMoney(d.revenue.weekCents)} hint="Desde segunda-feira" icon={<CalendarRange />} />
        <StatTile emphasis label="Faturamento no mês" value={formatMoney(d.revenue.monthCents)} icon={<TrendingUp />} />
        <StatTile
          emphasis
          label="Saldo de caixa"
          value={formatMoney(d.cash.balanceCents)}
          hint={d.cash.openSessions ? `${d.cash.openSessions} caixa(s) aberto(s) · dinheiro em gaveta` : 'Nenhum caixa aberto'}
          icon={<Wallet />}
        />
      </section>

      <section aria-label="Vendas do mês" className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <StatTile label="Vendas no mês" value={formatInteger(d.month.salesCount)} icon={<ShoppingBag />} />
        <StatTile label="Ticket médio" value={formatMoney(d.month.averageTicketCents)} hint="Faturamento ÷ vendas do mês" icon={<TicketIcon />} />
        <StatTile
          label="Lucro bruto estimado"
          value={formatMoney(d.month.grossProfitCents)}
          hint="Vendas do mês líquidas de devoluções − custo dos produtos"
          icon={<Banknote />}
        />
        <StatTile label="Produtos cadastrados" value={formatInteger(d.productsCount)} hint="Ativos" icon={<Package />} />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Vendas por dia"
          description="Faturamento dos últimos 30 dias"
          empty={!hasDaily}
          table={{
            columns: [{ label: 'Dia' }, { label: 'Vendas', align: 'right' }, { label: 'Faturamento', align: 'right' }],
            rows: d.charts.daily.map((p) => [dayLabel(p.date), p.count, formatMoney(p.totalCents)])
          }}
        >
          <ResponsiveContainer>
            <AreaChart data={d.charts.daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="dailyFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colors.series1} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={colors.series1} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={dayLabel} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis tickFormatter={axisMoney} tick={axisTick} tickLine={false} axisLine={false} width={72} />
              <Tooltip
                cursor={{ stroke: colors.axis, strokeDasharray: '3 3' }}
                content={(props) => (
                  <ChartTooltip {...props} formatLabel={dayLabel} formatValue={(v) => formatMoney(v)} />
                )}
              />
              <Area
                type="monotone"
                dataKey="totalCents"
                name="Faturamento"
                stroke={colors.series1}
                strokeWidth={2}
                fill="url(#dailyFill)"
                activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <PendingCard d={d} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ChartCard
          className="xl:col-span-2"
          title="Faturamento mensal"
          description="Faturamento e lucro bruto estimado dos últimos 12 meses"
          empty={!hasMonthly}
          table={{
            columns: [{ label: 'Mês' }, { label: 'Faturamento', align: 'right' }, { label: 'Lucro bruto', align: 'right' }],
            rows: d.charts.monthly.map((m) => [monthLabel(m.month), formatMoney(m.totalCents), formatMoney(m.grossProfitCents)])
          }}
        >
          <ResponsiveContainer>
            <BarChart data={d.charts.monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke={colors.grid} vertical={false} />
              <XAxis dataKey="month" tickFormatter={monthLabel} tick={axisTick} tickLine={false} axisLine={false} />
              <YAxis tickFormatter={axisMoney} tick={axisTick} tickLine={false} axisLine={false} width={72} />
              <Tooltip
                cursor={{ fill: colors.grid, opacity: 0.5 }}
                content={(props) => <ChartTooltip {...props} formatLabel={monthLabel} formatValue={(v) => formatMoney(v)} />}
              />
              <Legend
                iconType="square"
                iconSize={10}
                formatter={(value) => <span style={{ color: colors.textSecondary, fontSize: 12 }}>{value}</span>}
              />
              <Bar dataKey="totalCents" name="Faturamento" fill={colors.series1} radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="grossProfitCents" name="Lucro bruto" fill={colors.series2} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Formas de pagamento"
          description="Valores recebidos no mês"
          empty={d.charts.paymentMethods.length === 0}
          table={{
            columns: [{ label: 'Forma' }, { label: 'Qtde.', align: 'right' }, { label: 'Total', align: 'right' }],
            rows: d.charts.paymentMethods.map((p) => [PAYMENT_METHOD_LABELS[p.method] ?? p.method, p.count, formatMoney(p.totalCents)])
          }}
        >
          <HorizontalBars
            data={d.charts.paymentMethods.map((p) => ({ label: PAYMENT_METHOD_LABELS[p.method] ?? p.method, value: p.totalCents }))}
            name="Total"
            format={formatMoney}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="Produtos mais vendidos"
          description="Por quantidade, no mês"
          empty={d.charts.topProducts.length === 0}
          table={{
            columns: [{ label: 'Produto' }, { label: 'Quantidade', align: 'right' }, { label: 'Faturamento', align: 'right' }],
            rows: d.charts.topProducts.map((p) => [p.name, formatQuantity(p.quantityMilli), formatMoney(p.totalCents)])
          }}
        >
          <HorizontalBars
            data={d.charts.topProducts.map((p) => ({ label: p.name, value: p.quantityMilli / 1000 }))}
            name="Quantidade"
            format={(v) => formatQuantity(Math.round(v * 1000))}
          />
        </ChartCard>

        <ChartCard
          title="Desempenho comercial"
          description="Faturamento por operador, no mês"
          empty={d.charts.operators.length === 0}
          table={{
            columns: [{ label: 'Operador' }, { label: 'Vendas', align: 'right' }, { label: 'Faturamento', align: 'right' }],
            rows: d.charts.operators.map((o) => [o.name, o.count, formatMoney(o.totalCents)])
          }}
        >
          <HorizontalBars data={d.charts.operators.map((o) => ({ label: o.name, value: o.totalCents }))} name="Faturamento" format={formatMoney} />
        </ChartCard>
      </div>
    </div>
  )
}

function HorizontalBars({ data, name, format }: { data: { label: string; value: number }[]; name: string; format(v: number): string }) {
  const colors = useChartColors()
  return (
    <ResponsiveContainer>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={colors.grid} horizontal={false} />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={130}
          tick={{ fill: colors.textSecondary, fontSize: 12 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: string) => (v.length > 18 ? `${v.slice(0, 17)}…` : v)}
        />
        <Tooltip
          cursor={{ fill: colors.grid, opacity: 0.5 }}
          content={(props) => <ChartTooltip {...props} formatValue={(v) => format(v)} />}
        />
        <Bar dataKey="value" name={name} fill={colors.series1} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function PendingCard({ d }: { d: DashboardSummary }) {
  const { can } = useAuth()
  const items = [
    {
      icon: Boxes,
      label: 'Reposição de estoque',
      value: formatInteger(d.lowStockCount),
      detail: 'no mínimo, esgotados ou negativos',
      alert: d.lowStockCount > 0,
      to: '/estoque',
      visible: can('stock.view', 'stock.manage')
    },
    {
      icon: ClipboardList,
      label: 'Pedidos pendentes',
      value: formatInteger(d.pendingOrders),
      detail: 'aguardando entrega',
      alert: false,
      to: '/pedidos',
      visible: can('orders.manage')
    },
    {
      icon: FileText,
      label: 'Orçamentos pendentes',
      value: formatInteger(d.pendingQuotes),
      detail: 'rascunhos e enviados',
      alert: false,
      to: '/orcamentos',
      visible: can('quotes.manage')
    },
    {
      icon: Receipt,
      label: 'Contas a pagar',
      value: formatMoney(d.payables.openCents),
      detail: `${d.payables.openCount} em aberto${d.payables.overdueCount ? ` · ${d.payables.overdueCount} atrasada(s)` : ''}`,
      alert: d.payables.overdueCount > 0,
      to: '/contas-a-pagar',
      visible: can('finance.payables')
    },
    {
      icon: HandCoins,
      label: 'Contas a receber',
      value: formatMoney(d.receivables.openCents),
      detail: `${d.receivables.openCount} em aberto${d.receivables.overdueCount ? ` · ${d.receivables.overdueCount} atrasada(s)` : ''}`,
      alert: d.receivables.overdueCount > 0,
      to: '/contas-a-receber',
      visible: can('finance.receivables')
    },
    {
      icon: DatabaseBackup,
      label: 'Backup',
      value: d.backup.lastFailed ? 'Falhou' : d.backup.lastAt ? 'OK' : '—',
      detail: d.backup.lastAt ? `último em ${formatDateTime(d.backup.lastAt)}` : 'nenhum backup feito ainda',
      // Sem backup há mais de 2 dias ou última tentativa com falha
      alert: d.backup.lastFailed || !d.backup.lastAt || Date.now() - new Date(d.backup.lastAt).getTime() > 2 * 86_400_000,
      to: '/configuracoes',
      visible: can('backup.manage')
    }
  ].filter((i) => i.visible)

  return (
    <Card>
      <CardHeader title="Pendências" description="O que precisa de atenção" />
      <ul className="px-2 pb-2">
        {items.map(({ icon: Icon, ...item }) => (
          <li key={item.label}>
            <Link to={item.to} className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-hover">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-2">
                <Icon className="size-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-ink-2">{item.label}</span>
                <span className="block truncate text-xs text-muted">{item.detail}</span>
              </span>
              <span className="tabular text-sm font-semibold text-ink">{item.value}</span>
              {item.alert && (
                <Badge tone="warning">
                  <TriangleAlert className="size-3" aria-hidden /> Atenção
                </Badge>
              )}
              <ChevronRight className="size-4 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
