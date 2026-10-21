import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { api, call, errorMessage } from '@/services/api'

/** Impressão e PDF do relatório de caixa. */
export function useCashReport() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return {
    busy,
    print: (sessionId: number) => run(() => call(api.cash.printReport({ sessionId }))),
    pdf: (sessionId: number) =>
      run(async () => {
        const r = await call(api.cash.saveReportPdf({ sessionId }))
        if (r) toast.success(`Relatório salvo em ${r.path}`)
      })
  }
}
