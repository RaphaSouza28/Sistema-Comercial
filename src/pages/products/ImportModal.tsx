import { useEffect, useState } from 'react'
import { CircleCheck, FileDown, FileUp } from 'lucide-react'
import type { ImportPreview, ImportResult } from '@shared/api'
import { Button } from '@/components/ui/Button'
import { Checkbox } from '@/components/ui/Field'
import { Badge, ErrorState } from '@/components/ui/Feedback'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/contexts/ToastContext'
import { api, call, errorMessage } from '@/services/api'

const actionBadge = {
  create: <Badge tone="success">Novo</Badge>,
  update: <Badge tone="primary">Atualizar</Badge>,
  error: <Badge tone="danger">Erro</Badge>
}

/** Importação de produtos: modelo → seleção do arquivo → prévia → confirmação → resultado. */
export function ImportModal({ open, onClose, onImported }: { open: boolean; onClose(): void; onImported(): void }) {
  const toast = useToast()
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [updateExisting, setUpdateExisting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setPreview(null)
      setResult(null)
      setError(null)
      setUpdateExisting(false)
    }
  }, [open])

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const pickFile = () =>
    run(async () => {
      const p = await call(api.products.importPreview())
      if (p) setPreview(p)
    })

  const saveTemplate = () =>
    run(async () => {
      const r = await call(api.products.saveImportTemplate())
      if (r) toast.success(`Modelo salvo em ${r.path}`)
    })

  const apply = () =>
    run(async () => {
      if (!preview) return
      const r = await call(api.products.importApply({ token: preview.token, updateExisting }))
      setResult(r)
      onImported()
    })

  const toApply = preview ? preview.createCount + (updateExisting ? preview.updateCount : 0) : 0

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={busy}
      size="lg"
      title="Importar produtos"
      description="Planilha CSV (Excel: Arquivo › Salvar como › CSV separado por ponto e vírgula)."
      footer={
        result ? (
          <Button onClick={onClose}>Concluir</Button>
        ) : preview ? (
          <>
            <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
              Escolher outro arquivo
            </Button>
            <Button onClick={() => void apply()} loading={busy} disabled={toApply === 0}>
              Importar {toApply} produto(s)
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
        )
      }
    >
      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      {result ? (
        <div className="flex flex-col items-center py-4 text-center">
          <CircleCheck className="size-10 text-success" aria-hidden />
          <p className="mt-3 font-medium text-ink">Importação concluída</p>
          <p className="mt-1 text-sm text-ink-2">
            {result.created} criado(s) · {result.updated} atualizado(s) · {result.skipped} ignorado(s)
          </p>
          {result.errors.length > 0 && (
            <ul className="mt-4 w-full rounded-lg bg-danger-soft p-3 text-left text-[13px] text-danger">
              {result.errors.map((e) => (
                <li key={e.line}>
                  Linha {e.line}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : preview ? (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium text-ink">{preview.fileName}</span>
            <Badge tone="success">{preview.createCount} novos</Badge>
            <Badge tone="primary">{preview.updateCount} já cadastrados</Badge>
            {preview.errorCount > 0 && <Badge tone="danger">{preview.errorCount} com erro</Badge>}
          </div>
          {preview.updateCount > 0 && (
            <div className="mb-3">
              <Checkbox
                label="Atualizar produtos já cadastrados"
                description="Produtos encontrados pelo código, SKU ou código de barras terão os dados da planilha aplicados. Alterações de preço ficam no histórico."
                checked={updateExisting}
                onChange={setUpdateExisting}
              />
            </div>
          )}
          <div className="max-h-80 overflow-auto rounded-lg border border-line">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-surface-2 text-left text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Linha</th>
                  <th className="px-3 py-2 font-medium">Ação</th>
                  <th className="px-3 py-2 font-medium">Produto</th>
                  <th className="px-3 py-2 font-medium">Observações</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.line} className="border-t border-line align-top">
                    <td className="tabular px-3 py-2 text-muted">{r.line}</td>
                    <td className="px-3 py-2">{actionBadge[r.action]}</td>
                    <td className="px-3 py-2 text-ink">
                      {r.name ?? '—'}
                      {r.code && <span className="block text-xs text-muted">{r.code}</span>}
                    </td>
                    <td className="px-3 py-2 text-ink-2">{r.messages.join(' · ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">Nada foi gravado ainda. Linhas com erro serão ignoradas.</p>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <button type="button" onClick={() => void saveTemplate()} disabled={busy} className="flex flex-col items-start gap-2 rounded-lg border border-line p-4 text-left hover:bg-surface-hover">
            <FileDown className="size-5 text-primary" aria-hidden />
            <span className="font-medium text-ink">1. Baixar modelo</span>
            <span className="text-[13px] text-muted">Planilha com as colunas aceitas e um exemplo. Apenas a coluna "nome" é obrigatória.</span>
          </button>
          <button type="button" onClick={() => void pickFile()} disabled={busy} className="flex flex-col items-start gap-2 rounded-lg border border-line p-4 text-left hover:bg-surface-hover">
            <FileUp className="size-5 text-primary" aria-hidden />
            <span className="font-medium text-ink">2. Selecionar planilha</span>
            <span className="text-[13px] text-muted">Você verá uma prévia com os produtos novos, os já cadastrados e os erros antes de confirmar.</span>
          </button>
        </div>
      )}
    </Modal>
  )
}
