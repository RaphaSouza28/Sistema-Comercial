import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { FileDown, FileSpreadsheet, FileText, Printer, Search, X } from 'lucide-react'
import type { ProductListItem, ReportResult } from '@shared/api'
import { REPORTS, type ReportInput, type ReportKey } from '@shared/financeSchemas'
import { formatDateTime, formatMoney, toDateKey } from '@shared/format'
import { displayCell, isNumericColumn } from '@shared/reportFormat'
import { ChartTooltip } from '@/components/dashboard/ChartTooltip'
import { Button } from '@/components/ui/Button'
import { Card, PageHeader } from '@/components/ui/Card'
import { SelectField } from '@/components/ui/Field'
import { EmptyState, ErrorState, Spinner } from '@/components/ui/Feedback'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { useChartColors } from '@/hooks/useChartColors'
import { useDebounced } from '@/hooks/useDebounced'
import { api, call, errorMessage } from '@/services/api'
import { inputDate } from '../finance/shared'

type Preset = 'today' | '7d' | 'month' | 'lastMonth' | 'year' | 'custom'
const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: '7d', label: 'Últimos 7 dias' },
  { key: 'month', label: 'Este mês' },
  { key: 'lastMonth', label: 'Mês passado' },
  { key: 'year', label: 'Este ano' },
  { key: 'custom', label: 'Personalizado' }
]

function presetRange(p: Preset): { from: string; to: string } | null {
  const now = new Date()
  if (p === 'today') return { from: toDateKey(), to: toDateKey() }
  if (p === '7d') return { from: toDateKey(now, -6), to: toDateKey() }
  if (p === 'month') return { from: toDateKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: toDateKey() }
  if (p === 'lastMonth') return { from: toDateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: toDateKey(new Date(now.getFullYear(), now.getMonth(), 0)) }
  if (p === 'year') return { from: toDateKey(new Date(now.getFullYear(), 0, 1)), to: toDateKey() }
  return null
}

const GROUPS = [...new Set(Object.values(REPORTS).map((r) => r.group))]
const compactMoney = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })
const axisMoney = (cents: number) => (cents === 0 ? '0' : `R$ ${compactMoney.format(cents / 100)}`)

export function ReportsPage() {
  const toast = useToast()
  const [key, setKey] = useState<ReportKey>('sales-daily')
  const [preset, setPreset] = useState<Preset>('month')
  const [range, setRange] = useState(() => presetRange('month')!)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [product, setProduct] = useState<ProductListItem | null>(null)
  const [exporting, setExporting] = useState<string | null>(null)
  const def = REPORTS[key]
  const filters = def.filters as readonly string[]
  const categories = useAsync(() => call(api.categories.list()).catch(() => []))

  const input: ReportInput = {
    key,
    from: range.from,
    to: range.to,
    categoryId: filters.includes('category') ? categoryId : null,
    productId: filters.includes('product') ? (product?.id ?? null) : null
  }
  const inputKey = JSON.stringify(input)
  const { data, error, loading } = useAsync(() => call(api.reports.run(input)), [inputKey])

  const choosePreset = (p: Preset) => {
    setPreset(p)
    const r = presetRange(p)
    if (r) setRange(r)
  }

  const exportAs = async (format: 'csv' | 'xlsx' | 'pdf' | 'print') => {
    setExporting(format)
    try {
      if (format === 'print') await call(api.reports.print(input))
      else {
        const r = await call(api.reports.export({ report: input, format }))
        if (r) toast.success(`Relatório salvo em ${r.path}`)
      }
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="animate-in">
      <PageHeader
        title="Relatórios"
        description="Calculados a partir das vendas, devoluções, movimentações e contas registradas."
        actions={
          <>
            <Button variant="secondary" icon={<Printer className="size-4" />} loading={exporting === 'print'} disabled={!!exporting || !data} onClick={() => void exportAs('print')}>
              Imprimir
            </Button>
            <Button variant="secondary" icon={<FileText className="size-4" />} loading={exporting === 'pdf'} disabled={!!exporting || !data} onClick={() => void exportAs('pdf')}>
              PDF
            </Button>
            <Button variant="secondary" icon={<FileSpreadsheet className="size-4" />} loading={exporting === 'xlsx'} disabled={!!exporting || !data} onClick={() => void exportAs('xlsx')}>
              Excel
            </Button>
            <Button variant="secondary" icon={<FileDown className="size-4" />} loading={exporting === 'csv'} disabled={!!exporting || !data} onClick={() => void exportAs('csv')}>
              CSV
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[230px_1fr]">
        <nav aria-label="Relatórios disponíveis" className="flex flex-col gap-4">
          {GROUPS.map((g) => (
            <div key={g}>
              <p className="mb-1 px-2 text-[11px] font-semibold tracking-wide text-muted uppercase">{g}</p>
              {(Object.entries(REPORTS) as [ReportKey, (typeof REPORTS)[ReportKey]][])
                .filter(([, r]) => r.group === g)
                .map(([k, r]) => (
                  <button
                    key={k}
                    type="button"
                    aria-current={k === key ? 'page' : undefined}
                    onClick={() => setKey(k)}
                    className={`block w-full rounded-md px-2 py-1.5 text-left text-sm ${k === key ? 'bg-primary-soft font-medium text-ink' : 'text-ink-2 hover:bg-surface-hover'}`}
                  >
                    {r.label}
                  </button>
                ))}
            </div>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <Card className="flex flex-wrap items-end gap-3 p-4">
            {filters.includes('period') ? (
              <>
                <SelectField label="Período" containerClassName="w-44" value={preset} onChange={(e) => choosePreset(e.target.value as Preset)} options={PRESETS.map((p) => ({ value: p.key, label: p.label }))} />
                <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
                  De
                  <input
                    type="date"
                    aria-label="Data inicial do relatório"
                    className={inputDate}
                    value={range.from}
                    max={range.to}
                    onChange={(e) => e.target.value && (setPreset('custom'), setRange({ ...range, from: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
                  Até
                  <input
                    type="date"
                    aria-label="Data final do relatório"
                    className={inputDate}
                    value={range.to}
                    min={range.from}
                    onChange={(e) => e.target.value && (setPreset('custom'), setRange({ ...range, to: e.target.value }))}
                  />
                </label>
              </>
            ) : (
              <p className="pb-2 text-sm text-muted">Posição atual — o período não se aplica.</p>
            )}
            {filters.includes('category') && (
              <SelectField
                label="Categoria"
                containerClassName="w-52"
                value={categoryId ?? ''}
                onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : null)}
                options={[{ value: '', label: 'Todas' }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.parentName ? `${c.parentName} › ${c.name}` : c.name }))]}
              />
            )}
            {filters.includes('product') && <ProductFilter value={product} onChange={setProduct} />}
          </Card>

          {error && <ErrorState message={error} />}
          {!data && loading && <Spinner />}
          {data && <ReportView report={data} loading={loading} />}
        </div>
      </div>
    </div>
  )
}

function ProductFilter({ value, onChange }: { value: ProductListItem | null; onChange(p: ProductListItem | null): void }) {
  const [query, setQuery] = useState('')
  const debounced = useDebounced(query, 200)
  const results = useAsync(() => (debounced.trim() ? call(api.products.list({ search: debounced, pageSize: 10 })).then((r) => r.items) : Promise.resolve([])), [debounced])
  if (value)
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink-2">Produto</span>
        <span className="flex h-9 items-center gap-2 rounded-md bg-surface-2 px-3 text-sm text-ink">
          {value.name}
          <button type="button" aria-label="Remover filtro de produto" onClick={() => onChange(null)} className="text-muted hover:text-ink">
            <X className="size-4" />
          </button>
        </span>
      </div>
    )
  return (
    <div className="relative flex w-64 flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink-2">Produto</span>
      <Search className="pointer-events-none absolute bottom-2.5 left-3 size-4 text-muted" aria-hidden />
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Todos" aria-label="Filtrar por produto" className="h-9 rounded-md border border-line-strong bg-surface pr-3 pl-9 text-sm text-ink placeholder:text-muted" />
      {query && (results.data?.length ?? 0) > 0 && (
        <ul role="listbox" className="absolute top-full z-30 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
          {results.data!.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button type="button" className="w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-primary-soft" onClick={() => (onChange(p), setQuery(''))}>
                {p.name} <span className="text-xs text-muted">#{p.internalCode}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReportView({ report, loading }: { report: ReportResult; loading: boolean }) {
  const colors = useChartColors()
  const palette = [colors.series1, colors.series2]
  const chartData = useMemo(() => (report.chart && report.rows.length > 1 ? report.rows.slice(0, report.chart.type === 'bar' && report.chart.x === 'product' ? 15 : 400) : null), [report])
  const axisTick = { fill: colors.axis, fontSize: 12 }

  return (
    <div className={`flex flex-col gap-4 ${loading ? 'opacity-60' : ''}`}>
      <div>
        <h2 className="text-lg font-semibold text-ink">{report.title}</h2>
        <p className="text-sm text-muted">
          {report.subtitle} · gerado em {formatDateTime(report.generatedAt)}
        </p>
      </div>

      {chartData && report.chart && (
        <Card className="p-4">
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              {report.chart.type === 'line' ? (
                <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={colors.grid} vertical={false} />
                  <XAxis dataKey={report.chart.x} tick={axisTick} tickLine={false} axisLine={false} minTickGap={24} />
                  <YAxis tickFormatter={axisMoney} tick={axisTick} tickLine={false} axisLine={false} width={72} />
                  <Tooltip cursor={{ stroke: colors.axis, strokeDasharray: '3 3' }} content={(props) => <ChartTooltip {...props} formatValue={(v) => formatMoney(v)} />} />
                  {report.chart.series.map((s, i) => (
                    <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={palette[i % 2]} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: colors.surface, strokeWidth: 2 }} />
                  ))}
                </LineChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                  <CartesianGrid stroke={colors.grid} vertical={false} />
                  <XAxis dataKey={report.chart.x} tick={axisTick} tickLine={false} axisLine={false} minTickGap={8} interval="preserveStartEnd" />
                  <YAxis tickFormatter={axisMoney} tick={axisTick} tickLine={false} axisLine={false} width={72} />
                  <Tooltip cursor={{ fill: colors.grid, opacity: 0.5 }} content={(props) => <ChartTooltip {...props} formatValue={(v) => formatMoney(v)} />} />
                  {report.chart.series.length > 1 && (
                    <Legend iconType="square" iconSize={10} formatter={(value) => <span style={{ color: colors.textSecondary, fontSize: 12 }}>{value}</span>} />
                  )}
                  {report.chart.series.map((s, i) => (
                    <Bar key={s.key} dataKey={s.key} name={s.label} fill={palette[i % 2]} radius={[4, 4, 0, 0]} maxBarSize={28} />
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card className="overflow-hidden">
        {report.rows.length === 0 ? (
          <EmptyState icon={<FileText />} title="Nenhum registro" description="Não há movimento para os filtros escolhidos." />
        ) : (
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm" aria-label={report.title}>
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-line bg-surface-2 text-left text-[12px] tracking-wide text-muted uppercase">
                  {report.columns.map((c) => (
                    <th key={c.key} className={`px-3 py-2.5 font-medium whitespace-nowrap ${isNumericColumn(c) ? 'text-right' : ''}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.rows.map((row, i) => (
                  <tr key={i} className="border-b border-line last:border-0 hover:bg-surface-hover/60">
                    {report.columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2 ${isNumericColumn(c) ? 'tabular text-right whitespace-nowrap' : ''} text-ink-2`}>
                        {displayCell(row[c.key] ?? null, c.format)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              {report.totals && (
                <tfoot className="sticky bottom-0">
                  <tr className="border-t-2 border-line-strong bg-surface-2 font-semibold text-ink">
                    {report.columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2.5 ${isNumericColumn(c) ? 'tabular text-right whitespace-nowrap' : ''}`}>
                        {displayCell(report.totals![c.key] ?? null, c.format)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
      {report.notes.length > 0 && (
        <ul className="list-disc pl-5 text-xs text-muted">
          {report.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
