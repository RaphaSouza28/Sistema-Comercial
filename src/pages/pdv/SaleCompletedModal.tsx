import { useEffect, useRef, useState } from 'react'
import { CircleCheck, FileDown, Printer } from 'lucide-react'
import type { SaleDetail } from '@shared/api'
import { formatMoney } from '@shared/format'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/contexts/ToastContext'
import { api, call, errorMessage } from '@/services/api'

export function useReceipt() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const print = async (id: number, returnId?: number) => {
    setBusy(true)
    try {
      await call(api.sales.printReceipt({ id, returnId }))
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const pdf = async (id: number, returnId?: number) => {
    setBusy(true)
    try {
      const r = await call(api.sales.saveReceiptPdf({ id, returnId }))
      if (r) toast.success(`Comprovante salvo em ${r.path}`)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return { busy, print, pdf }
}

export function SaleCompletedModal({ sale, onClose }: { sale: SaleDetail | null; onClose(): void }) {
  const receipt = useReceipt()
  const toast = useToast()
  const handled = useRef<number | null>(null)
  // Uma vez por venda: aviso de dispositivo (gaveta) e impressão automática do comprovante, se configurada
  useEffect(() => {
    if (!sale || handled.current === sale.id) return
    handled.current = sale.id
    if (sale.deviceWarning) toast.warning(sale.deviceWarning)
    if (sale.duplicate) return
    void call(api.devices.settings())
      .then((d) => {
        if (d.receiptPrinter.autoPrintAfterSale) void receipt.print(sale.id)
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sale])
  return (
    <Modal
      open={!!sale}
      size="sm"
      title={sale ? `Venda #${sale.id} concluída` : ''}
      onClose={onClose}
      footer={
        <Button size="lg" onClick={onClose} className="w-full">
          Nova venda
        </Button>
      }
    >
      {sale && (
        <div className="flex flex-col items-center text-center">
          <CircleCheck className="size-12 text-success" aria-hidden />
          <p className="mt-2 text-sm text-ink-2">Total {formatMoney(sale.totalCents)}</p>
          {sale.changeCents > 0 ? (
            <>
              <p className="mt-4 text-sm text-ink-2">Troco</p>
              <p className="tabular text-4xl font-semibold text-success" aria-label="Troco a devolver">
                {formatMoney(sale.changeCents)}
              </p>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">Sem troco.</p>
          )}
          {sale.duplicate && <p className="mt-3 text-xs text-warning">Esta venda já havia sido registrada — nada foi duplicado.</p>}
          <div className="mt-6 flex w-full gap-2">
            <Button variant="secondary" className="flex-1" icon={<Printer className="size-4" />} loading={receipt.busy} onClick={() => void receipt.print(sale.id)}>
              Imprimir comprovante
            </Button>
            <Button variant="secondary" className="flex-1" icon={<FileDown className="size-4" />} disabled={receipt.busy} onClick={() => void receipt.pdf(sale.id)}>
              Salvar PDF
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
