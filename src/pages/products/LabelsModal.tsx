import { useState } from 'react'
import { FileDown, Printer, Trash2 } from 'lucide-react'
import type { StockItem } from '@shared/api'
import { StockItemPicker } from '@/components/StockItemPicker'
import { Button } from '@/components/ui/Button'
import { Checkbox, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/contexts/ToastContext'
import { api, call, errorMessage } from '@/services/api'

interface Line {
  item: StockItem
  quantity: number
}

/** Etiquetas com código de barras (EAN-13 ou Code 128), nome e preço vigente. */
export function LabelsModal({ onClose }: { onClose(): void }) {
  const toast = useToast()
  const [lines, setLines] = useState<Line[]>([])
  const [showPrice, setShowPrice] = useState(true)
  const [busy, setBusy] = useState<'print' | 'pdf' | null>(null)
  const key = (i: StockItem) => `${i.productId}:${i.variantId ?? ''}`
  const total = lines.reduce((a, l) => a + l.quantity, 0)

  const add = (item: StockItem) =>
    setLines((ls) => (ls.some((l) => key(l.item) === key(item)) ? ls.map((l) => (key(l.item) === key(item) ? { ...l, quantity: l.quantity + 1 } : l)) : [...ls, { item, quantity: 1 }]))

  const run = async (format: 'print' | 'pdf') => {
    setBusy(format)
    try {
      const r = await call(api.devices.printLabels({ items: lines.map((l) => ({ productId: l.item.productId, variantId: l.item.variantId, quantity: l.quantity })), showPrice, format }))
      if (r) toast.success(`Etiquetas salvas em ${r.path}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal
      open
      size="lg"
      title="Imprimir etiquetas"
      description="Código de barras do produto (ou SKU/código interno), nome e preço atual. Tamanho e impressora em Configurações."
      onClose={onClose}
      locked={!!busy}
      footer={
        <>
          <Button variant="secondary" icon={<FileDown className="size-4" />} disabled={!lines.length || !!busy} loading={busy === 'pdf'} onClick={() => void run('pdf')}>
            Salvar PDF
          </Button>
          <Button icon={<Printer className="size-4" />} disabled={!lines.length || !!busy} loading={busy === 'print'} onClick={() => void run('print')}>
            Imprimir {total ? `${total} etiqueta(s)` : ''}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <StockItemPicker onSelect={add} autoFocus label="Adicionar produto às etiquetas" />
        {lines.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {lines.map((l) => {
              const name = l.item.variantName ? `${l.item.name} — ${l.item.variantName}` : l.item.name
              return (
                <li key={key(l.item)} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="flex-1">
                    <span className="text-ink">{name}</span>
                    <span className="block text-xs text-muted">{l.item.barcode || l.item.sku || l.item.internalCode}</span>
                  </span>
                  <TextField
                    label={`Etiquetas de ${name}`}
                    type="number"
                    min={1}
                    max={500}
                    containerClassName="w-24 [&_label]:sr-only"
                    value={l.quantity}
                    onChange={(e) => setLines((ls) => ls.map((x) => (key(x.item) === key(l.item) ? { ...x, quantity: Math.min(500, Math.max(1, Number(e.target.value) || 1)) } : x)))}
                  />
                  <Button size="sm" variant="ghost" aria-label={`Remover ${name}`} icon={<Trash2 className="size-4 text-danger" />} onClick={() => setLines((ls) => ls.filter((x) => key(x.item) !== key(l.item)))} />
                </li>
              )
            })}
          </ul>
        )}
        <Checkbox label="Mostrar o preço na etiqueta" checked={showPrice} onChange={setShowPrice} />
      </div>
    </Modal>
  )
}
