import { useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight, FileDown, Printer } from 'lucide-react'
import type { ApiResult, DocumentLineDto, FileResult } from '@shared/api'
import { formatMoney, formatQuantity } from '@shared/format'
import { newLineKey, type EditorLine } from '@/components/DocumentEditor'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/contexts/ToastContext'
import { call, errorMessage } from '@/services/api'

/** Linhas do editor a partir de um documento salvo (para edição). */
export function linesFromDetail(items: DocumentLineDto[]): EditorLine[] {
  return items.map((i) => ({
    key: newLineKey(),
    productId: i.productId,
    variantId: i.variantId,
    description: i.description,
    unit: i.unit,
    quantityMilli: i.quantityMilli,
    discountCents: i.discountCents,
    unitPriceCents: i.freeText ? i.unitPriceCents : null
  }))
}

export function DocumentLinesTable({ items }: { items: DocumentLineDto[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-[12px] text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Item</th>
            <th className="px-3 py-2 text-right font-medium">Qtd.</th>
            <th className="px-3 py-2 text-right font-medium">Unitário</th>
            <th className="px-3 py-2 text-right font-medium">Desconto</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id} className="border-t border-line">
              <td className="px-3 py-2 text-ink">
                {i.description}
                {i.freeText && <span className="ml-2 text-xs text-muted">(texto livre)</span>}
              </td>
              <td className="tabular px-3 py-2 text-right text-ink-2">
                {formatQuantity(i.quantityMilli)} {i.unit}
              </td>
              <td className="tabular px-3 py-2 text-right text-ink-2">{formatMoney(i.unitPriceCents)}</td>
              <td className="tabular px-3 py-2 text-right text-ink-2">{i.discountCents ? `-${formatMoney(i.discountCents)}` : '—'}</td>
              <td className="tabular px-3 py-2 text-right font-medium text-ink">{formatMoney(i.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DocumentTotals({ subtotalCents, discountCents, totalCents, items }: { subtotalCents: number; discountCents: number; totalCents: number; items: DocumentLineDto[] }) {
  const itemsDiscount = items.reduce((s, i) => s + i.discountCents, 0)
  return (
    <dl className="ml-auto w-64 text-sm">
      <div className="flex justify-between text-ink-2">
        <dt>Subtotal</dt>
        <dd className="tabular">{formatMoney(subtotalCents)}</dd>
      </div>
      <div className="flex justify-between text-ink-2">
        <dt>Descontos</dt>
        <dd className="tabular">-{formatMoney(itemsDiscount + discountCents)}</dd>
      </div>
      <div className="mt-1 flex justify-between border-t border-line pt-2 text-base font-semibold text-ink">
        <dt>Total</dt>
        <dd className="tabular">{formatMoney(totalCents)}</dd>
      </div>
    </dl>
  )
}

/** Botões "Imprimir" e "Salvar PDF" de um documento. */
export function PrintButtons({ print, savePdf }: { print(): Promise<ApiResult<null>>; savePdf(): Promise<ApiResult<FileResult | null>> }) {
  const toast = useToast()
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null)
  const run = async (kind: 'print' | 'pdf') => {
    setBusy(kind)
    try {
      if (kind === 'print') await call(print())
      else {
        const r = await call(savePdf())
        if (r) toast.success(`PDF salvo em ${r.path}`)
      }
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <Button variant="secondary" icon={<Printer className="size-4" />} loading={busy === 'print'} disabled={!!busy} onClick={() => void run('print')}>
        Imprimir
      </Button>
      <Button variant="secondary" icon={<FileDown className="size-4" />} loading={busy === 'pdf'} disabled={!!busy} onClick={() => void run('pdf')}>
        Salvar PDF
      </Button>
    </>
  )
}

export function Pager({ page, total, pageSize, onPage, label }: { page: number; total: number; pageSize: number; onPage(p: number): void; label: string }) {
  if (total <= pageSize) return null
  const pages = Math.ceil(total / pageSize)
  return (
    <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-muted">
      <span>
        {total} {label}
      </span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" aria-label="Página anterior" disabled={page <= 1} icon={<ChevronLeft className="size-4" />} onClick={() => onPage(page - 1)} />
        <span>
          {page} de {pages}
        </span>
        <Button size="sm" variant="ghost" aria-label="Próxima página" disabled={page >= pages} icon={<ChevronRight className="size-4" />} onClick={() => onPage(page + 1)} />
      </div>
    </div>
  )
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  )
}
