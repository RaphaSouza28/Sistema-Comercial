import { useEffect, useRef, useState } from 'react'
import { Printer, ScanBarcode } from 'lucide-react'
import type { PrinterInfo } from '@shared/api'
import type { DevicesSettings } from '@shared/deviceSchemas'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader } from '@/components/ui/Card'
import { Checkbox, SelectField, TextField } from '@/components/ui/Field'
import { useToast } from '@/contexts/ToastContext'
import { useAsync } from '@/hooks/useAsync'
import { api, call, errorMessage, fieldErrors } from '@/services/api'

type Target = 'receipt' | 'document' | 'label'
const KEYS = { receipt: 'receiptPrinter', document: 'documentPrinter', label: 'labelPrinter' } as const

/** Impressoras (térmica, convencional, etiquetas), gaveta de dinheiro e teste do leitor de código de barras. */
export function DevicesSection() {
  const toast = useToast()
  const { data, setData } = useAsync(() => call(api.devices.settings()))
  const printers = useAsync(() => call(api.devices.printers()).catch(() => [] as PrinterInfo[]))
  const [form, setForm] = useState<DevicesSettings | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => setForm(data), [data])
  if (!form) return null
  const dirty = JSON.stringify(form) !== JSON.stringify(data)

  const setPrinter = <K extends keyof DevicesSettings>(key: K, patch: Partial<DevicesSettings[K]>) => setForm({ ...form, [key]: { ...form[key], ...patch } })
  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label)
    try {
      await fn()
      if (ok) toast.success(ok)
    } catch (e) {
      toast.error(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }
  const save = () =>
    run(
      'save',
      async () => {
        setErrors({})
        try {
          setData(await call(api.devices.update(form)))
        } catch (e) {
          setErrors(fieldErrors(e))
          throw e
        }
      },
      'Configuração de dispositivos salva.'
    )

  const printerOptions = [
    { value: '', label: 'Escolher na janela de impressão' },
    ...(printers.data ?? []).map((p) => ({ value: p.name, label: `${p.displayName}${p.isDefault ? ' (padrão)' : ''}` }))
  ]
  const printerBlock = (target: Target, title: string, extra?: React.ReactNode) => {
    const cfg = form[KEYS[target]]
    return (
      <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-4">
        <legend className="px-1 text-[13px] font-semibold text-ink">{title}</legend>
        <SelectField label={`Impressora — ${title.toLowerCase()}`} value={cfg.deviceName ?? ''} onChange={(e) => setPrinter(KEYS[target], { deviceName: e.target.value || null })} options={printerOptions} />
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="Cópias" value={cfg.copies} onChange={(e) => setPrinter(KEYS[target], { copies: Number(e.target.value) })} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
          {extra}
        </div>
        <Checkbox
          label="Imprimir direto (sem abrir a janela de impressão)"
          description={cfg.deviceName ? undefined : 'Sem impressora escolhida, usa a impressora padrão do Windows.'}
          checked={cfg.silent}
          onChange={(v) => setPrinter(KEYS[target], { silent: v })}
        />
        <Button size="sm" variant="secondary" className="w-fit" disabled={dirty || !!busy} loading={busy === target} onClick={() => void run(target, () => call(api.devices.testPrint({ target })), '')}>
          {dirty ? 'Salve para testar' : 'Imprimir página de teste'}
        </Button>
      </fieldset>
    )
  }

  const drawer = form.cashDrawer
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Printer className="size-4 text-muted" /> Impressoras e dispositivos
          </span>
        }
        description="Usa as impressoras instaladas no Windows (com o driver do fabricante). Comprovantes são não fiscais."
        actions={
          <Button loading={busy === 'save'} disabled={!dirty} onClick={() => void save()}>
            Salvar
          </Button>
        }
      />
      <div className="grid grid-cols-1 gap-4 px-5 pb-5 lg:grid-cols-3">
        {printerBlock(
          'receipt',
          'Comprovantes (térmica)',
          <SelectField
            label="Largura da bobina"
            value={form.receiptPrinter.paperWidthMm}
            onChange={(e) => setPrinter('receiptPrinter', { paperWidthMm: Number(e.target.value) as 58 | 80 })}
            options={[
              { value: 80, label: '80 mm' },
              { value: 58, label: '58 mm' }
            ]}
          />
        )}
        {printerBlock('document', 'Documentos A4 (convencional)')}
        {printerBlock(
          'label',
          'Etiquetas',
          <SelectField
            label="Mídia"
            value={form.labelPrinter.media}
            onChange={(e) => setPrinter('labelPrinter', { media: e.target.value as 'ROLL' | 'A4' })}
            options={[
              { value: 'ROLL', label: 'Rolo (impressora de etiquetas)' },
              { value: 'A4', label: 'Folha A4 adesiva' }
            ]}
          />
        )}
        <div className="flex flex-col gap-3 lg:col-span-3">
          <Checkbox
            label="Imprimir o comprovante automaticamente ao concluir cada venda"
            checked={form.receiptPrinter.autoPrintAfterSale}
            onChange={(v) => setPrinter('receiptPrinter', { autoPrintAfterSale: v })}
          />
          <div className="grid grid-cols-3 gap-3 md:w-2/3">
            <TextField label="Largura da etiqueta (mm)" type="number" min={20} max={120} value={form.labelPrinter.labelWidthMm} onChange={(e) => setPrinter('labelPrinter', { labelWidthMm: Number(e.target.value) })} />
            <TextField label="Altura da etiqueta (mm)" type="number" min={10} max={120} value={form.labelPrinter.labelHeightMm} onChange={(e) => setPrinter('labelPrinter', { labelHeightMm: Number(e.target.value) })} />
            <TextField label="Colunas na folha A4" type="number" min={1} max={6} disabled={form.labelPrinter.media === 'ROLL'} value={form.labelPrinter.columns} onChange={(e) => setPrinter('labelPrinter', { columns: Number(e.target.value) })} />
          </div>
        </div>

        <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-4 lg:col-span-2">
          <legend className="px-1 text-[13px] font-semibold text-ink">Gaveta de dinheiro</legend>
          <p className="text-xs text-muted">
            Gavetas ligadas à impressora térmica (conector RJ11) abrem com o comando ESC/POS. Compartilhe a impressora no Windows (ex.: nome "Termica") e informe
            \\localhost\Termica, ou informe a porta serial (COM). Toda abertura fica registrada na auditoria.
          </p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SelectField
              label="Conexão"
              value={drawer.mode}
              onChange={(e) => setPrinter('cashDrawer', { mode: e.target.value as DevicesSettings['cashDrawer']['mode'] })}
              options={[
                { value: 'NONE', label: 'Sem gaveta' },
                { value: 'ESCPOS_SHARE', label: 'Impressora compartilhada (ESC/POS)' },
                { value: 'ESCPOS_SERIAL', label: 'Porta serial (ESC/POS)' }
              ]}
            />
            <TextField
              label={drawer.mode === 'ESCPOS_SERIAL' ? 'Porta' : 'Compartilhamento'}
              placeholder={drawer.mode === 'ESCPOS_SERIAL' ? 'COM3' : '\\\\localhost\\Termica'}
              disabled={drawer.mode === 'NONE'}
              value={drawer.target ?? ''}
              error={errors['cashDrawer.target']}
              onChange={(e) => setPrinter('cashDrawer', { target: e.target.value })}
            />
            <SelectField
              label="Pino do conector"
              disabled={drawer.mode === 'NONE'}
              value={drawer.pin}
              onChange={(e) => setPrinter('cashDrawer', { pin: Number(e.target.value) as 2 | 5 })}
              options={[
                { value: 2, label: 'Pino 2 (padrão)' },
                { value: 5, label: 'Pino 5' }
              ]}
            />
          </div>
          <Checkbox label="Abrir a gaveta nas vendas com pagamento em dinheiro" disabled={drawer.mode === 'NONE'} checked={drawer.openOnCashSale} onChange={(v) => setPrinter('cashDrawer', { openOnCashSale: v })} />
          <Button size="sm" variant="secondary" className="w-fit" disabled={dirty || drawer.mode === 'NONE' || !!busy} loading={busy === 'drawer'} onClick={() => void run('drawer', () => call(api.devices.testDrawer()), 'Comando de abertura enviado à gaveta.')}>
            {dirty ? 'Salve para testar' : 'Testar abertura da gaveta'}
          </Button>
        </fieldset>
        <ScannerTest />
      </div>
    </Card>
  )
}

/** Leitores USB funcionam como teclado: digitam o código muito rápido e enviam Enter. */
function ScannerTest() {
  const [value, setValue] = useState('')
  const [result, setResult] = useState<{ code: string; msPerChar: number } | null>(null)
  const times = useRef<number[]>([])
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <legend className="flex items-center gap-1.5 px-1 text-[13px] font-semibold text-ink">
        <ScanBarcode className="size-4 text-muted" aria-hidden /> Leitor de código de barras
      </legend>
      <p className="text-xs text-muted">Leitores USB não precisam de configuração. Clique no campo e leia um código para testar.</p>
      <TextField
        label="Teste do leitor"
        value={value}
        onChange={(e) => {
          times.current.push(performance.now())
          setValue(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          const t = times.current
          const msPerChar = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 0
          setResult({ code: value, msPerChar })
          setValue('')
          times.current = []
        }}
      />
      {result && (
        <p className="text-sm text-ink-2" role="status">
          Lido: <strong className="text-ink">{result.code || '(vazio)'}</strong> ·{' '}
          {result.code.length > 3 && result.msPerChar < 40 ? 'leitura rápida — leitor funcionando.' : 'parece digitação manual.'}
        </p>
      )}
    </fieldset>
  )
}
