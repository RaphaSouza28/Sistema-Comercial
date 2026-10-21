import fs from 'node:fs'
import path from 'node:path'
import {
  app,
  BrowserWindow,
  dialog,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions,
  type WebContents
} from 'electron'
import { IPC_CHANNELS as C, type AppInfo } from '@shared/api'
import { idSchema } from '@shared/catalogSchemas'
import type { Services } from '../../services'
import { requireActor, requirePermission } from '../../services/context'
import { productImageUrl } from '../../services/product.mappers'
import { decodeText, parseCsv } from '../../utils/csv'
import { validationError } from '../../utils/errors'
import { dayKey } from '../../utils/dates'
import { logger } from '../../utils/logger'
import { readSecuritySettings } from '../../services/settings.service'
import { deleteProductImage, importProductImage, productMediaDir } from '../media'
import { buildCatalogHtml, buildOrderHtml, buildQuoteHtml } from '../../services/documentsHtml'
import { htmlToPdf, listPrinters, printHtml, printOptionsFor } from '../printing'
import { buildCashReportHtml, buildReceiptHtml, buildReceivableReceiptHtml, buildTestPageHtml, withPaperWidth } from '../../services/receipt'
import { buildLabelsHtml } from '../../services/labels'
import { fiscalDir } from '../fiscalFiles'
import { buildReportHtml, reportToCsv, reportToXlsx } from '../../services/reportExport'
import { reportExportSchema } from '@shared/financeSchemas'
import { z } from 'zod'
import { ATTACHMENT_EXTENSIONS, attachmentPath, deleteAttachment, importAttachment } from '../attachments'

const receiptIdSchema = z.object({ paymentId: z.number().int().positive() })
const testPrintSchema = z.object({ target: z.enum(['receipt', 'document', 'label']) })
const backupFileSchema = z.object({ backupPassword: z.string().max(128).optional() })
import { createRouter, SessionStore } from './router'

export interface RegisterIpcOptions {
  services: Services
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean
  paths: { userData: string; databasePath: string }
}

export function registerIpcHandlers({ services, isTrustedSender, paths }: RegisterIpcOptions): SessionStore {
  const sessions = new SessionStore()
  const handle = createRouter({ services, sessions, isTrustedSender })

  handle(C.app.info, async (): Promise<AppInfo> => ({
    name: app.getName(),
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    dataDirectory: paths.userData,
    databasePath: paths.databasePath,
    electron: process.versions.electron,
    node: process.versions.node,
    platform: `${process.platform} ${process.arch}`
  }))

  // Primeiro acesso
  handle(C.setup.status, () => services.setup.status())
  handle(C.setup.complete, async (input, { sender }) => {
    const user = await services.setup.complete(input)
    sessions.set(sender, user.id)
    return { ...user, idleMinutes: sessions.idleMinutes }
  })

  // Autenticação
  handle(C.auth.login, async (input, { sender }) => {
    const user = await services.auth.login(input)
    sessions.set(sender, user.id)
    return { ...user, idleMinutes: sessions.idleMinutes }
  })
  handle(C.auth.logout, async (_input, { actor, sender }) => {
    await services.auth.logout(actor)
    sessions.delete(sender.id)
    return null
  })
  handle(C.auth.session, async (_input, { actor }) =>
    actor ? { ...(await services.auth.loadActor(actor.userId)).session, idleMinutes: sessions.idleMinutes } : null
  )
  handle(C.auth.changePassword, (input, { actor }) => services.auth.changePassword(actor, input))

  // Dashboard e empresa
  handle(C.dashboard.summary, (_input, { actor }) => services.dashboard.summary(actor))
  handle(C.company.get, (_input, { actor }) => services.company.get(actor))
  handle(C.company.update, (input, { actor }) => services.company.update(actor, input))

  // Usuários e perfis
  handle(C.users.list, (_input, { actor }) => services.users.list(actor))
  handle(C.users.create, (input, { actor }) => services.users.create(actor, input))
  handle(C.users.update, (input, { actor }) => services.users.update(actor, input))
  handle(C.users.resetPassword, (input, { actor }) => services.users.resetPassword(actor, input))
  handle(C.roles.list, (_input, { actor }) => services.users.listRoles(actor))
  handle(C.roles.permissions, (_input, { actor }) => services.users.listPermissions(actor))
  handle(C.roles.updatePermissions, (input, { actor }) => services.users.updateRolePermissions(actor, input))

  // Configurações
  handle(C.settings.pricing, (_input, { actor }) => services.settings.pricing(actor))
  handle(C.settings.updatePricing, (input, { actor }) => services.settings.updatePricing(actor, input))

  // Categorias e fornecedores
  handle(C.categories.list, (_input, { actor }) => services.categories.list(actor))
  handle(C.categories.create, (input, { actor }) => services.categories.create(actor, input))
  handle(C.categories.update, (input, { actor }) => services.categories.update(actor, input))
  handle(C.categories.remove, (input, { actor }) => services.categories.remove(actor, input))
  handle(C.suppliers.list, (input, { actor }) => services.suppliers.list(actor, input))
  handle(C.suppliers.create, (input, { actor }) => services.suppliers.create(actor, input))
  handle(C.suppliers.update, (input, { actor }) => services.suppliers.update(actor, input))
  handle(C.suppliers.remove, (input, { actor }) => services.suppliers.remove(actor, input))

  // Produtos
  const P = services.products
  handle(C.products.list, (input, { actor }) => P.list(actor, input))
  handle(C.products.get, (input, { actor }) => P.get(actor, input))
  handle(C.products.create, (input, { actor }) => P.create(actor, input))
  handle(C.products.update, (input, { actor }) => P.update(actor, input))
  handle(C.products.quickCreate, (input, { actor }) => P.quickCreate(actor, input))
  handle(C.products.setActive, (input, { actor }) => P.setActive(actor, input))
  handle(C.products.remove, (input, { actor }) => P.remove(actor, input))
  handle(C.products.priceHistory, (input, { actor }) => P.priceHistory(actor, input))
  handle(C.products.lookup, (input, { actor }) => P.lookup(actor, input))
  handle(C.products.categoryPricingPreview, (input, { actor }) => P.categoryPricingPreview(actor, input))
  handle(C.products.categoryPricingApply, (input, { actor }) => P.categoryPricingApply(actor, input))

  handle(C.products.pickImage, async (input, { actor, sender }) => {
    requirePermission(actor, 'products.manage')
    const { id } = idSchema.parse(input)
    await P.get(actor, { id }) // valida existência antes de abrir o seletor
    const win = BrowserWindow.fromWebContents(sender)
    const options: OpenDialogOptions = {
      title: 'Escolher imagem do produto',
      properties: ['openFile'],
      filters: [{ name: 'Imagens', extensions: ['jpg', 'jpeg', 'png'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const fileName = importProductImage(paths.userData, result.filePaths[0])
    try {
      const previous = await P.setImage(actor, id, fileName)
      deleteProductImage(paths.userData, previous)
    } catch (error) {
      deleteProductImage(paths.userData, fileName)
      throw error
    }
    return { imageUrl: productImageUrl(fileName)! }
  })
  handle(C.products.removeImage, async (input, { actor }) => {
    const { id } = idSchema.parse(input)
    deleteProductImage(paths.userData, await P.setImage(actor, id, null))
    return null
  })

  const saveCsv = async (sender: WebContents, defaultName: string, content: string) => {
    const win = BrowserWindow.fromWebContents(sender)
    const options: SaveDialogOptions = {
      title: 'Salvar planilha',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: 'Planilha CSV', extensions: ['csv'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, content, 'utf8')
    return result.filePath
  }
  handle(C.products.exportCsv, async (_input, { actor, sender }) => {
    const { csv, count } = await services.productTransfer.exportCsv(actor)
    const stamp = dayKey(new Date())
    const file = await saveCsv(sender, `produtos-${stamp}.csv`, csv)
    return file ? { path: file, count } : null
  })
  handle(C.products.saveImportTemplate, async (_input, { actor, sender }) => {
    requirePermission(actor, 'products.manage')
    const file = await saveCsv(sender, 'modelo-importacao-produtos.csv', services.productTransfer.templateCsv())
    return file ? { path: file } : null
  })
  handle(C.products.importPreview, async (_input, { actor, sender }) => {
    requirePermission(actor, 'products.manage')
    const win = BrowserWindow.fromWebContents(sender)
    const options: OpenDialogOptions = {
      title: 'Importar produtos',
      properties: ['openFile'],
      filters: [{ name: 'Planilha CSV', extensions: ['csv', 'txt'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const file = result.filePaths[0]
    if (fs.statSync(file).size > 20 * 1024 * 1024) throw validationError('O arquivo deve ter no máximo 20 MB.')
    const rows = parseCsv(decodeText(fs.readFileSync(file)))
    return services.productTransfer.preview(actor, rows, path.basename(file))
  })
  handle(C.products.importApply, (input, { actor }) => services.productTransfer.apply(actor, input))

  // Estoque
  const S = services.stock
  handle(C.stock.overview, (input, { actor }) => S.overview(actor, input))
  handle(C.stock.summary, (_input, { actor }) => S.summary(actor))
  handle(C.stock.search, (input, { actor }) => S.search(actor, input))
  handle(C.stock.movements, (input, { actor }) => S.movements(actor, input))
  handle(C.stock.entry, (input, { actor }) => S.entry(actor, input))
  handle(C.stock.exit, (input, { actor }) => S.exit(actor, input))
  handle(C.stock.adjust, (input, { actor }) => S.adjust(actor, input))
  handle(C.stock.exportMovements, async (input, { actor, sender }) => {
    const { csv, count } = await S.exportMovementsCsv(actor, input)
    const file = await saveCsv(sender, `movimentacoes-estoque-${dayKey(new Date())}.csv`, csv)
    return file ? { path: file, count } : null
  })
  // ── Impressão conforme Configurações → Impressoras e dispositivos ──
  const printReceipt = async (actor: Parameters<typeof services.devices.settings>[0], html: string) => {
    const d = await services.devices.settings(actor)
    return printHtml(withPaperWidth(html, d.receiptPrinter.paperWidthMm), printOptionsFor(d, 'receipt'))
  }
  const printDocument = async (actor: Parameters<typeof services.devices.settings>[0], html: string) =>
    printHtml(html, printOptionsFor(await services.devices.settings(actor), 'document'))

  // Caixa, clientes e PDV
  handle(C.cash.current, (_input, { actor }) => services.cash.current(actor))
  handle(C.cash.open, (input, { actor }) => services.cash.open(actor, input))
  handle(C.cash.addMovement, (input, { actor }) => services.cash.addMovement(actor, input))
  handle(C.cash.summary, (input, { actor }) => services.cash.summary(actor, input))
  handle(C.cash.close, (input, { actor }) => services.cash.close(actor, input))
  handle(C.cash.get, (input, { actor }) => services.cash.get(actor, input))
  handle(C.cash.history, (input, { actor }) => services.cash.history(actor, input))
  handle(C.cash.daily, (input, { actor }) => services.cash.daily(actor, input))
  const cashReport = async (input: unknown, actor: Parameters<typeof services.cash.get>[0]) =>
    buildCashReportHtml(await services.company.get(actor), await services.cash.get(actor, input))
  handle(C.cash.printReport, async (input, { actor }) => {
    await printReceipt(actor, await cashReport(input, actor))
    return null
  })
  handle(C.cash.saveReportPdf, async (input, { actor, sender }) => {
    const pdf = await htmlToPdf(await cashReport(input, actor))
    const win = BrowserWindow.fromWebContents(sender)
    const { sessionId } = (input ?? {}) as { sessionId?: number }
    const options: SaveDialogOptions = {
      title: 'Salvar relatório de caixa',
      defaultPath: path.join(app.getPath('documents'), `caixa-${sessionId}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, pdf)
    return { path: result.filePath }
  })
  handle(C.customers.search, (input, { actor }) => services.customers.search(actor, input))
  handle(C.customers.quickCreate, (input, { actor }) => services.customers.quickCreate(actor, input))
  const V = services.sales
  handle(C.sales.searchItems, (input, { actor }) => V.searchItems(actor, input))
  handle(C.sales.sellers, (_input, { actor }) => V.sellers(actor))
  handle(C.sales.preview, (input, { actor }) => V.preview(actor, input))
  handle(C.sales.finalize, async (input, { actor }) => {
    const sale = await V.finalize(actor, input)
    // Gaveta: abre nas vendas com dinheiro (não na repetição de uma venda já registrada)
    if (!sale.duplicate && sale.payments.some((p) => p.method === 'CASH')) {
      const { cashDrawer } = await services.devices.settings(actor)
      if (cashDrawer.mode !== 'NONE' && cashDrawer.openOnCashSale) {
        try {
          await services.devices.openDrawer(actor, { reason: 'sale', saleId: sale.id })
        } catch (error) {
          logger.warn('Gaveta não abriu após a venda', { saleId: sale.id, error: error instanceof Error ? error.message : String(error) })
          return { ...sale, deviceWarning: `Venda registrada, mas a gaveta não abriu: ${error instanceof Error ? error.message : String(error)}` }
        }
      }
    }
    return sale
  })
  handle(C.sales.list, (input, { actor }) => V.list(actor, input))
  handle(C.sales.get, (input, { actor }) => V.get(actor, input))
  handle(C.sales.cancel, (input, { actor }) => V.cancel(actor, input))
  handle(C.sales.returnItems, (input, { actor }) => V.returnItems(actor, input))
  handle(C.sales.voucher, (input, { actor }) => V.voucher(actor, input))
  const receiptFor = async (input: unknown, actor: Parameters<typeof V.get>[0]) => {
    const { id, returnId } = (input ?? {}) as { id?: number; returnId?: number }
    const sale = await V.get(actor, { id })
    const company = await services.company.get(actor)
    return buildReceiptHtml(company, sale, typeof returnId === 'number' ? returnId : undefined)
  }
  handle(C.sales.printReceipt, async (input, { actor }) => {
    await printReceipt(actor, await receiptFor(input, actor))
    return null
  })
  handle(C.sales.saveReceiptPdf, async (input, { actor, sender }) => {
    const pdf = await htmlToPdf(await receiptFor(input, actor))
    const win = BrowserWindow.fromWebContents(sender)
    const { id } = (input ?? {}) as { id?: number }
    const options: SaveDialogOptions = {
      title: 'Salvar comprovante',
      defaultPath: path.join(app.getPath('documents'), `comprovante-venda-${id}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, pdf)
    return { path: result.filePath }
  })

  handle(C.sales.source, (input, { actor }) => V.source(actor, input))

  // ── Fase 6: clientes, pedidos, orçamentos e catálogo ──
  const saveFile = async (sender: WebContents, defaultName: string, ext: string, label: string, content: Buffer | string) => {
    const win = BrowserWindow.fromWebContents(sender)
    const options: SaveDialogOptions = {
      title: 'Salvar arquivo',
      defaultPath: path.join(app.getPath('documents'), defaultName),
      filters: [{ name: label, extensions: [ext] }]
    }
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    fs.writeFileSync(result.filePath, content)
    return { path: result.filePath }
  }
  const Cu = services.customers
  handle(C.customers.list, (input, { actor }) => Cu.list(actor, input))
  handle(C.customers.get, (input, { actor }) => Cu.get(actor, input))
  handle(C.customers.create, (input, { actor }) => Cu.create(actor, input))
  handle(C.customers.update, (input, { actor }) => Cu.update(actor, input))
  handle(C.customers.remove, (input, { actor }) => Cu.remove(actor, input))
  handle(C.customers.anonymize, (input, { actor }) => Cu.anonymize(actor, input))
  handle(C.customers.exportData, async (input, { actor, sender }) => {
    const { fileName, json } = await Cu.exportData(actor, input)
    return saveFile(sender, fileName, 'json', 'Arquivo JSON', json)
  })

  const O = services.orders
  const Q = services.quotes
  handle(C.documents.preview, (input, { actor }) => O.preview(actor, input))
  handle(C.orders.list, (input, { actor }) => O.list(actor, input))
  handle(C.orders.get, (input, { actor }) => O.get(actor, input))
  handle(C.orders.create, (input, { actor }) => O.create(actor, input))
  handle(C.orders.update, (input, { actor }) => O.update(actor, input))
  handle(C.orders.setStatus, (input, { actor }) => O.setStatus(actor, input))
  handle(C.orders.cancel, (input, { actor }) => O.cancel(actor, input))
  const orderHtml = async (input: unknown, actor: Parameters<typeof O.get>[0]) => buildOrderHtml(await services.company.get(actor), await O.get(actor, input))
  handle(C.orders.print, async (input, { actor }) => {
    await printDocument(actor, await orderHtml(input, actor))
    return null
  })
  handle(C.orders.savePdf, async (input, { actor, sender }) => {
    const { id } = (input ?? {}) as { id?: number }
    return saveFile(sender, `pedido-${id}.pdf`, 'pdf', 'PDF', await htmlToPdf(await orderHtml(input, actor), 'A4'))
  })

  handle(C.quotes.list, (input, { actor }) => Q.list(actor, input))
  handle(C.quotes.get, (input, { actor }) => Q.get(actor, input))
  handle(C.quotes.create, (input, { actor }) => Q.create(actor, input))
  handle(C.quotes.update, (input, { actor }) => Q.update(actor, input))
  handle(C.quotes.setStatus, (input, { actor }) => Q.setStatus(actor, input))
  handle(C.quotes.toOrder, (input, { actor }) => Q.toOrder(actor, input))
  const quoteHtml = async (input: unknown, actor: Parameters<typeof Q.get>[0]) => buildQuoteHtml(await services.company.get(actor), await Q.get(actor, input))
  handle(C.quotes.print, async (input, { actor }) => {
    await printDocument(actor, await quoteHtml(input, actor))
    return null
  })
  handle(C.quotes.savePdf, async (input, { actor, sender }) => {
    const { id } = (input ?? {}) as { id?: number }
    return saveFile(sender, `orcamento-${id}.pdf`, 'pdf', 'PDF', await htmlToPdf(await quoteHtml(input, actor), 'A4'))
  })

  const catalogHtml = async (input: unknown, actor: Parameters<typeof services.catalog.data>[0]) => {
    const { imagePaths, ...data } = await services.catalog.data(actor, input)
    const mediaDir = productMediaDir(paths.userData)
    // Imagens embutidas (data URI): a página do PDF não acessa arquivos nem o protocolo interno
    const imageSrc = (productId: number) => {
      const file = imagePaths.get(productId)
      if (!file || !/^[0-9a-f-]{36}\.jpg$/.test(file)) return null
      const full = path.join(mediaDir, file)
      return fs.existsSync(full) ? `data:image/jpeg;base64,${fs.readFileSync(full).toString('base64')}` : null
    }
    return buildCatalogHtml(await services.company.get(actor), data, imageSrc)
  }
  handle(C.catalog.data, async (input, { actor }) => {
    const { imagePaths: _ignored, ...data } = await services.catalog.data(actor, input)
    return data
  })
  handle(C.catalog.print, async (input, { actor }) => {
    await printDocument(actor, await catalogHtml(input, actor))
    return null
  })
  handle(C.catalog.savePdf, async (input, { actor, sender }) =>
    saveFile(sender, `catalogo-${dayKey(new Date())}.pdf`, 'pdf', 'PDF', await htmlToPdf(await catalogHtml(input, actor), 'A4'))
  )

  // ── Fase 7: financeiro e relatórios ──
  const Pa = services.payables
  handle(C.payables.list, (input, { actor }) => Pa.list(actor, input))
  handle(C.payables.get, (input, { actor }) => Pa.get(actor, input))
  handle(C.payables.create, (input, { actor }) => Pa.create(actor, input))
  handle(C.payables.update, (input, { actor }) => Pa.update(actor, input))
  handle(C.payables.pay, (input, { actor }) => Pa.pay(actor, input))
  handle(C.payables.reverse, (input, { actor }) => Pa.reverse(actor, input))
  handle(C.payables.cancel, (input, { actor }) => Pa.cancel(actor, input))
  handle(C.payables.summary, (_input, { actor }) => Pa.summary(actor))
  handle(C.payables.categories, (_input, { actor }) => Pa.categories(actor))
  handle(C.payables.attachReceipt, async (input, { actor, sender }) => {
    const { id } = idSchema.parse(input)
    await Pa.get(actor, { id }) // valida permissão e existência antes de abrir o seletor
    const win = BrowserWindow.fromWebContents(sender)
    const options: OpenDialogOptions = {
      title: 'Anexar comprovante',
      properties: ['openFile'],
      filters: [{ name: 'PDF ou imagem', extensions: ATTACHMENT_EXTENSIONS }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const file = importAttachment(paths.userData, result.filePaths[0])
    try {
      const { dto, previous } = await Pa.setReceipt(actor, { id }, { path: file.fileName, name: file.originalName })
      deleteAttachment(paths.userData, previous)
      return dto
    } catch (error) {
      deleteAttachment(paths.userData, file.fileName)
      throw error
    }
  })
  handle(C.payables.openReceipt, async (input, { actor }) => {
    const full = attachmentPath(paths.userData, await Pa.receiptFile(actor, input))
    const error = await shell.openPath(full)
    if (error) throw validationError(`Não foi possível abrir o comprovante: ${error}`)
    return null
  })
  handle(C.payables.removeReceipt, async (input, { actor }) => {
    const { dto, previous } = await Pa.setReceipt(actor, input, null)
    deleteAttachment(paths.userData, previous)
    return dto
  })

  const Re = services.receivables
  handle(C.receivables.list, (input, { actor }) => Re.list(actor, input))
  handle(C.receivables.get, (input, { actor }) => Re.get(actor, input))
  handle(C.receivables.create, (input, { actor }) => Re.create(actor, input))
  handle(C.receivables.update, (input, { actor }) => Re.update(actor, input))
  handle(C.receivables.receive, (input, { actor }) => Re.receive(actor, input))
  handle(C.receivables.reverse, (input, { actor }) => Re.reverse(actor, input))
  handle(C.receivables.cancel, (input, { actor }) => Re.cancel(actor, input))
  handle(C.receivables.summary, (_input, { actor }) => Re.summary(actor))
  handle(C.receivables.printReceipt, async (input, { actor }) => {
    const { paymentId } = receiptIdSchema.parse(input)
    const payment = await Re.paymentForReceipt(actor, paymentId)
    await printReceipt(actor, buildReceivableReceiptHtml(await services.company.get(actor), payment))
    return null
  })

  const Rp = services.reports
  handle(C.reports.run, (input, { actor }) => Rp.run(actor, input))
  handle(C.reports.print, async (input, { actor }) => {
    await printDocument(actor, buildReportHtml(await services.company.get(actor), await Rp.run(actor, input)))
    return null
  })
  handle(C.reports.export, async (input, { actor, sender }) => {
    const { report, format } = reportExportSchema.parse(input)
    const result = await Rp.run(actor, report)
    const base = `${result.title.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}-${report.from}-a-${report.to}`
    if (format === 'csv') return saveFile(sender, `${base}.csv`, 'csv', 'CSV (Excel)', reportToCsv(result))
    if (format === 'xlsx') return saveFile(sender, `${base}.xlsx`, 'xlsx', 'Planilha do Excel', reportToXlsx(result))
    return saveFile(sender, `${base}.pdf`, 'pdf', 'PDF', await htmlToPdf(buildReportHtml(await services.company.get(actor), result), 'A4'))
  })

  // ── Fase 8: dispositivos, notas fiscais e TEF ──
  const D = services.devices
  handle(C.devices.settings, (_input, { actor }) => D.settings(actor))
  handle(C.devices.update, (input, { actor }) => D.update(actor, input))
  handle(C.devices.printers, (_input, { actor, sender }) => {
    requirePermission(actor, 'settings.manage')
    return listPrinters(sender)
  })
  handle(C.devices.testPrint, async (input, { actor }) => {
    requirePermission(actor, 'settings.manage')
    const { target } = testPrintSchema.parse(input)
    const d = await D.settings(actor)
    const company = await services.company.get(actor)
    const html = target === 'label' ? buildLabelsHtml([{ name: 'Etiqueta de teste', code: '7891234567895', priceCents: 1990, quantity: 1 }], d.labelPrinter, true) : buildTestPageHtml(company, target, d)
    await printHtml(target === 'receipt' ? withPaperWidth(html, d.receiptPrinter.paperWidthMm) : html, printOptionsFor(d, target))
    return null
  })
  handle(C.devices.openDrawer, async (_input, { actor }) => {
    await D.openDrawer(actor, { reason: 'manual' })
    return null
  })
  handle(C.devices.testDrawer, async (_input, { actor }) => {
    await D.openDrawer(actor, { reason: 'test' })
    return null
  })
  handle(C.devices.printLabels, async (input, { actor, sender }) => {
    const { items, showPrice, format } = await D.labelItems(actor, input)
    const d = await D.settings(actor)
    const html = buildLabelsHtml(items, d.labelPrinter, showPrice)
    if (format === 'print') {
      await printHtml(html, printOptionsFor(d, 'label'))
      return null
    }
    const l = d.labelPrinter
    const pdf = await htmlToPdf(html, l.media === 'ROLL' ? { widthMm: l.labelWidthMm, heightMm: l.labelHeightMm } : 'A4')
    return saveFile(sender, `etiquetas-${dayKey(new Date())}.pdf`, 'pdf', 'PDF', pdf)
  })

  const F = services.fiscal
  const T = services.tef
  handle(C.integrations.status, async (_input, { actor }) => {
    requireActor(actor)
    const [fiscal, tef] = await Promise.all([F.providerStatus(), T.providerStatus()])
    return {
      fiscal: { provider: fiscal.key, label: fiscal.label, enabled: !!fiscal.provider, environment: fiscal.environment },
      tef: { provider: tef.key, label: tef.label, enabled: !!tef.provider }
    }
  })
  handle(C.fiscal.settings, (_input, { actor }) => F.settings(actor))
  handle(C.fiscal.updateSettings, (input, { actor }) => F.updateSettings(actor, input))
  handle(C.fiscal.checklist, (_input, { actor }) => F.checklist(actor))
  handle(C.fiscal.list, (input, { actor }) => F.list(actor, input))
  handle(C.fiscal.get, (input, { actor }) => F.get(actor, input))
  handle(C.fiscal.prepare, (input, { actor }) => F.prepare(actor, input))
  handle(C.fiscal.transmit, (input, { actor }) => F.transmit(actor, input))
  handle(C.fiscal.query, (input, { actor }) => F.query(actor, input))
  handle(C.fiscal.cancel, (input, { actor }) => F.cancel(actor, input))
  handle(C.fiscal.discard, (input, { actor }) => F.discard(actor, input))
  const fiscalFile = (kind: 'xml' | 'danfe') => async (input: unknown, { actor, sender }: { actor: Parameters<typeof F.get>[0]; sender: WebContents }) => {
    const file = await F.filePath(actor, input, kind)
    const full = path.join(fiscalDir(paths.userData), path.basename(file.path))
    if (!fs.existsSync(full)) throw validationError('Arquivo do documento fiscal não encontrado.')
    return saveFile(sender, file.name, kind === 'xml' ? 'xml' : 'pdf', kind === 'xml' ? 'XML' : 'PDF', fs.readFileSync(full))
  }
  handle(C.fiscal.saveXml, fiscalFile('xml'))
  handle(C.fiscal.saveDanfe, fiscalFile('danfe'))
  handle(C.tef.settings, (_input, { actor }) => T.settings(actor))
  handle(C.tef.updateSettings, (input, { actor }) => T.updateSettings(actor, input))
  handle(C.tef.reconciliation, (input, { actor }) => T.reconciliation(actor, input))
  handle(C.tef.updateReference, (input, { actor }) => T.updateReference(actor, input))
  handle(C.tef.reconcile, (input, { actor }) => T.reconcile(actor, input))

  // ── Fase 9: backup, restauração e segurança ──
  const B = () => {
    if (!services.backup) throw new Error('Serviço de backup não configurado')
    return services.backup
  }
  handle(C.backup.overview, (_input, { actor }) => B().overview(actor))
  handle(C.backup.history, (_input, { actor }) => B().history(actor))
  handle(C.backup.updateSettings, (input, { actor }) => B().updateSettings(actor, input))
  handle(C.backup.setPassword, async (input, { actor }) => {
    await B().setPassword(actor, input)
    return null
  })
  handle(C.backup.create, (_input, { actor }) => B().create(actor))
  handle(C.backup.verify, (input, { actor }) => B().verify(actor, input))
  handle(C.backup.inspect, (input, { actor }) => B().inspectRecord(actor, input))
  handle(C.backup.chooseDirectory, async (_input, { actor, sender }) => {
    requirePermission(actor, 'backup.manage')
    const win = BrowserWindow.fromWebContents(sender)
    const options: OpenDialogOptions = { title: 'Pasta dos backups (pode ser um pendrive ou HD externo)', properties: ['openDirectory', 'createDirectory'] }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0]
  })
  handle(C.backup.inspectFile, async (input, { actor, sender }) => {
    requirePermission(actor, 'backup.manage')
    const { backupPassword } = backupFileSchema.parse(input ?? {})
    const win = BrowserWindow.fromWebContents(sender)
    const options: OpenDialogOptions = {
      title: 'Escolher arquivo de backup',
      properties: ['openFile'],
      filters: [{ name: 'Backup do Sistema Comercial', extensions: ['db', 'scbak'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return B().inspectFile(actor, result.filePaths[0], backupPassword)
  })
  handle(C.backup.restore, async (input, { actor }) => {
    const r = await B().restore(actor, input)
    // Reinicia para trocar o banco antes de abri-lo (o arquivo só é liberado ao encerrar o processo)
    setTimeout(() => {
      if (!process.env.SISTEMA_COMERCIAL_NO_RELAUNCH) app.relaunch()
      app.quit()
    }, 1200)
    return r
  })
  handle(C.backup.showInFolder, async (input, { actor }) => {
    shell.showItemInFolder(await B().recordPath(actor, input))
    return null
  })
  handle(C.security.settings, (_input, { actor }) => services.settings.security(actor))
  handle(C.security.update, async (input, { actor }) => {
    const s = await services.settings.updateSecurity(actor, input)
    sessions.idleMinutes = s.idleMinutes
    return s
  })
  void readSecuritySettings(services.settings.db).then((s) => (sessions.idleMinutes = s.idleMinutes))

  const I = services.inventories
  handle(C.inventories.list, (_input, { actor }) => I.list(actor))
  handle(C.inventories.create, (input, { actor }) => I.create(actor, input))
  handle(C.inventories.get, (input, { actor }) => I.get(actor, input))
  handle(C.inventories.saveCounts, (input, { actor }) => I.saveCounts(actor, input))
  handle(C.inventories.apply, (input, { actor }) => I.apply(actor, input))
  handle(C.inventories.cancel, (input, { actor }) => I.cancel(actor, input))

  return sessions
}
