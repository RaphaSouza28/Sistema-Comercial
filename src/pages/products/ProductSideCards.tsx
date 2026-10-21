import { useState } from 'react'
import { History, ImageOff, ImagePlus, Trash2 } from 'lucide-react'
import { formatDateTime, formatMoney } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { EmptyState, Spinner } from '@/components/ui/Feedback'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage } from '@/services/api'

export function ProductImageCard({
  productId,
  imageUrl,
  canEdit,
  onChanged
}: {
  productId: number | null
  imageUrl: string | null
  canEdit: boolean
  onChanged(url: string | null): void
}) {
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const pick = async () => {
    if (!productId) return
    setBusy(true)
    try {
      const r = await call(api.products.pickImage({ id: productId }))
      if (r) {
        onChanged(r.imageUrl)
        toast.success('Imagem atualizada.')
      }
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!productId) return
    setBusy(true)
    try {
      await call(api.products.removeImage({ id: productId }))
      onChanged(null)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4">
      <p className="mb-3 text-[13px] font-medium text-ink-2">Imagem</p>
      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-2">
        {imageUrl ? <img src={imageUrl} alt="Imagem do produto" className="size-full object-contain" /> : <ImageOff className="size-8 text-muted" aria-hidden />}
      </div>
      {canEdit &&
        (productId ? (
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="secondary" className="flex-1" loading={busy} icon={<ImagePlus className="size-4" />} onClick={() => void pick()}>
              {imageUrl ? 'Trocar' : 'Escolher imagem'}
            </Button>
            {imageUrl && <Button size="sm" variant="ghost" aria-label="Remover imagem" disabled={busy} icon={<Trash2 className="size-4 text-danger" />} onClick={() => void remove()} />}
          </div>
        ) : (
          <p className="mt-2 text-xs text-muted">Salve o produto para adicionar uma imagem.</p>
        ))}
    </Card>
  )
}

const FIELD_LABEL = { COST: 'Custo', SALE: 'Preço de venda', PROMO: 'Preço promocional', WHOLESALE: 'Preço de atacado' }

export function PriceHistoryCard({ productId, refreshKey }: { productId: number; refreshKey: string }) {
  const { data, loading } = useAsync(() => call(api.products.priceHistory({ id: productId })), [productId, refreshKey])
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><History className="size-4 text-muted" /> Histórico de preços</span>} />
      {!data && loading && <Spinner />}
      {data && data.length === 0 && <EmptyState title="Sem alterações registradas" />}
      {data && data.length > 0 && (
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-surface-2 text-left text-muted">
              <tr>
                <th className="px-5 py-2 font-medium">Data</th>
                <th className="px-3 py-2 font-medium">Campo</th>
                <th className="px-3 py-2 text-right font-medium">De</th>
                <th className="px-3 py-2 text-right font-medium">Para</th>
                <th className="px-3 py-2 font-medium">Usuário</th>
                <th className="px-5 py-2 font-medium">Motivo</th>
              </tr>
            </thead>
            <tbody>
              {data.map((h) => (
                <tr key={h.id} className="border-t border-line">
                  <td className="tabular px-5 py-2 whitespace-nowrap text-ink-2">{formatDateTime(h.createdAt)}</td>
                  <td className="px-3 py-2 text-ink">
                    {FIELD_LABEL[h.field]}
                    {h.variantName && <span className="block text-xs text-muted">{h.variantName}</span>}
                  </td>
                  <td className="tabular px-3 py-2 text-right text-muted">{h.oldCents === null ? '—' : formatMoney(h.oldCents)}</td>
                  <td className="tabular px-3 py-2 text-right font-medium text-ink">{h.newCents === null ? '—' : formatMoney(h.newCents)}</td>
                  <td className="px-3 py-2 text-ink-2">{h.userName ?? '—'}</td>
                  <td className="px-5 py-2 text-ink-2">{h.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
