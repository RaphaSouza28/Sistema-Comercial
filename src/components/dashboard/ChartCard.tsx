import { useState, type ReactNode } from 'react'
import { ChartColumn, Table2 } from 'lucide-react'
import { Card, CardHeader } from '../ui/Card'
import { EmptyState } from '../ui/Feedback'

export interface TableView {
  columns: { label: string; align?: 'left' | 'right' }[]
  rows: (string | number)[][]
}

/** Cartão de gráfico com alternância para tabela e estado vazio. */
export function ChartCard({
  title,
  description,
  empty,
  emptyText = 'Sem vendas registradas no período.',
  table,
  height = 260,
  children,
  className = ''
}: {
  title: string
  description?: string
  empty: boolean
  emptyText?: string
  table: TableView
  height?: number
  children: ReactNode
  className?: string
}) {
  const [showTable, setShowTable] = useState(false)
  return (
    <Card className={className}>
      <CardHeader
        title={title}
        description={description}
        actions={
          !empty && (
            <button
              type="button"
              onClick={() => setShowTable((s) => !s)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-hover hover:text-ink"
              aria-pressed={showTable}
            >
              {showTable ? <ChartColumn className="size-3.5" /> : <Table2 className="size-3.5" />}
              {showTable ? 'Gráfico' : 'Tabela'}
            </button>
          )
        }
      />
      <div className="px-5 pb-4" style={{ minHeight: height }}>
        {empty ? (
          <div className="flex items-center justify-center" style={{ height }}>
            <EmptyState icon={<ChartColumn />} title="Nada para exibir ainda" description={emptyText} />
          </div>
        ) : showTable ? (
          <div className="overflow-auto" style={{ maxHeight: height }}>
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-muted">
                  {table.columns.map((c) => (
                    <th key={c.label} className={`py-2 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    {row.map((cell, j) => (
                      <td key={j} className={`tabular py-1.5 text-ink ${table.columns[j]?.align === 'right' ? 'text-right' : ''}`}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ height }}>{children}</div>
        )}
      </div>
    </Card>
  )
}
