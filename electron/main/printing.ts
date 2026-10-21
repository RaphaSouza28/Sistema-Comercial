import { BrowserWindow, type WebContents, type WebContentsPrintOptions } from 'electron'
import type { PrinterInfo } from '@shared/api'
import type { DevicesSettings } from '@shared/deviceSchemas'
import { AppError } from '../utils/errors'

/**
 * Renderiza um HTML em uma janela oculta, isolada e sem JavaScript, para impressão
 * ou geração de PDF. As impressoras do Windows (térmica, convencional, etiquetas) são
 * usadas pelo driver instalado; a configuração vem de Configurações → Impressoras.
 */
async function withHiddenPage<T>(html: string, fn: (win: BrowserWindow) => Promise<T>): Promise<T> {
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false, devTools: false }
  })
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await fn(win)
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

export interface PrintOptions {
  deviceName?: string | null
  /** Sem janela de impressão: usa a impressora informada ou a padrão do Windows. */
  silent?: boolean
  copies?: number
  /** Tamanho da página em milímetros (etiquetas em rolo). */
  pageSizeMm?: { width: number; height: number }
}

/**
 * Imprime o HTML. Com janela de impressão, cancelar não é erro (resolve false); impressão direta
 * que falha gera erro com o motivo informado pelo Windows.
 */
export function printHtml(html: string, opts: PrintOptions = {}): Promise<boolean> {
  return withHiddenPage(
    html,
    (win) =>
      new Promise<boolean>((resolve, reject) => {
        const options: WebContentsPrintOptions = {
          silent: !!opts.silent,
          printBackground: true,
          copies: opts.copies ?? 1,
          ...(opts.deviceName ? { deviceName: opts.deviceName } : {}),
          ...(opts.pageSizeMm ? { pageSize: { width: opts.pageSizeMm.width * 1000, height: opts.pageSizeMm.height * 1000 }, margins: { marginType: 'none' } } : {})
        }
        win.webContents.print(options, (success, failureReason) => {
          if (success) resolve(true)
          else if (!opts.silent || failureReason === 'cancelled') resolve(false)
          else reject(new AppError('CONFLICT', `A impressora não imprimiu (${failureReason || 'sem detalhes'}). Verifique se está ligada e configurada.`))
        })
      })
  )
}

/** Opções de impressão do tipo de documento, conforme a configuração de dispositivos. */
export function printOptionsFor(devices: DevicesSettings, target: 'receipt' | 'document' | 'label'): PrintOptions {
  if (target === 'receipt') return { deviceName: devices.receiptPrinter.deviceName, silent: devices.receiptPrinter.silent, copies: devices.receiptPrinter.copies }
  if (target === 'label') {
    const l = devices.labelPrinter
    return { deviceName: l.deviceName, silent: l.silent, copies: l.copies, ...(l.media === 'ROLL' ? { pageSizeMm: { width: l.labelWidthMm, height: l.labelHeightMm } } : {}) }
  }
  return { deviceName: devices.documentPrinter.deviceName, silent: devices.documentPrinter.silent, copies: devices.documentPrinter.copies }
}

export async function listPrinters(sender: WebContents): Promise<PrinterInfo[]> {
  const printers = await sender.getPrintersAsync()
  return printers.map((p) => ({ name: p.name, displayName: p.displayName || p.name, isDefault: !!(p as { isDefault?: boolean }).isDefault }))
}

/** PDF em bobina de 80 mm (comprovantes) ou A4 (orçamentos, pedidos, catálogo, relatórios). */
export function htmlToPdf(html: string, format: 'receipt' | 'A4' | { widthMm: number; heightMm: number } = 'receipt'): Promise<Buffer> {
  return withHiddenPage(html, (win) =>
    win.webContents.printToPDF(
      format === 'A4'
        ? { printBackground: true, pageSize: 'A4', preferCSSPageSize: true }
        : format === 'receipt'
          ? { printBackground: true, pageSize: { width: 3.15, height: 11.69 }, margins: { top: 0.1, bottom: 0.1, left: 0.1, right: 0.1 } }
          : { printBackground: true, pageSize: { width: format.widthMm / 25.4, height: format.heightMm / 25.4 }, margins: { top: 0, bottom: 0, left: 0, right: 0 } }
    )
  )
}
