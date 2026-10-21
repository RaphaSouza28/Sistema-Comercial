import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { RawDevice } from '../../electron/integrations/devices/escpos'
import { DeviceService } from '../../electron/services/device.service'
import { FiscalService } from '../../electron/services/fiscal/fiscal.service'
import type { FiscalProvider } from '../../electron/integrations/fiscal/provider'
import { buildLabelsHtml } from '../../electron/services/labels'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { actors } from '../helpers/actors'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})
const rid = () => randomUUID()
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

async function scenario() {
  t = await createTestDatabase()
  const a = await actors(t.db)
  const caneca = await a.s.products.create(a.admin, { name: 'Caneca', barcode: '7891234567895', costCents: 1000, salePriceCents: 2500, initialStockMilli: 10000 })
  const camiseta = await a.s.products.create(a.admin, {
    name: 'Camiseta',
    salePriceCents: 5000,
    ncm: '61091000',
    cfop: '5102',
    taxOrigin: '0',
    taxCode: '102',
    hasVariants: true,
    variantOptions: [{ name: 'Tamanho', values: ['P'] }],
    variants: [{ attributes: { Tamanho: 'P' }, sku: 'CAM-P', initialStockMilli: 5000 }]
  })
  await a.s.cash.open(a.admin, { requestId: rid(), openingCents: 0 })
  return { ...a, caneca, camiseta }
}

describe('dispositivos', () => {
  it('configuração validada, gaveta via ESC/POS com auditoria e falha compreensível', async () => {
    const { s, admin, operator } = await scenario()
    const written: Buffer[] = []
    let fail = false
    const devices = new DeviceService(t.db, (mode, target): RawDevice => ({
      description: `${mode} ${target}`,
      write: async (b) => {
        if (fail) throw Object.assign(new Error('not found'), { code: 'ENOENT' })
        written.push(b)
      }
    }))
    await expect(devices.openDrawer(operator, { reason: 'manual' })).rejects.toThrow(/não configurada/)
    const base = await devices.settings(operator)
    expect(base.receiptPrinter.paperWidthMm).toBe(80)
    await expect(devices.update(operator, base)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(devices.update(admin, { ...base, cashDrawer: { mode: 'ESCPOS_SERIAL', target: 'LPT1', pin: 2, openOnCashSale: true } })).rejects.toThrow(/porta serial/)
    await expect(devices.update(admin, { ...base, cashDrawer: { mode: 'ESCPOS_SHARE', target: 'C:\\Windows\\x', pin: 2, openOnCashSale: true } })).rejects.toThrow(/impressora compartilhada/)
    const saved = await devices.update(admin, { ...base, receiptPrinter: { ...base.receiptPrinter, paperWidthMm: 58, deviceName: 'EPSON TM-T20' }, cashDrawer: { mode: 'ESCPOS_SHARE', target: '\\\\localhost\\Termica', pin: 5, openOnCashSale: true } })
    expect(saved.receiptPrinter).toMatchObject({ paperWidthMm: 58, deviceName: 'EPSON TM-T20' })

    await devices.openDrawer(operator, { reason: 'manual' })
    expect([...written[0]]).toEqual([0x1b, 0x70, 0x01, 0x19, 0xfa])
    fail = true
    await expect(devices.openDrawer(operator, { reason: 'manual' })).rejects.toThrow(/Dispositivo não encontrado/)
    expect(await t.db.auditLog.count({ where: { action: 'cash.drawer.open' } })).toBe(1)
    expect(await t.db.auditLog.count({ where: { action: 'cash.drawer.error' } })).toBe(1)
    // Teste da gaveta só por quem configura
    fail = false
    await expect(devices.openDrawer(operator, { reason: 'test' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    void s
  })

  it('etiquetas com código de barras, preço vigente e escape do nome', async () => {
    const { s, admin, caneca, camiseta } = await scenario()
    await s.products.update(admin, { ...(await s.products.get(admin, { id: caneca.id })), name: 'Caneca <Café>', promoPriceCents: 1990 } as never)
    const devices = new DeviceService(t.db)
    const variant = (await s.products.get(admin, { id: camiseta.id })).variants[0]
    const data = await devices.labelItems(admin, { items: [{ productId: caneca.id, quantity: 2 }, { productId: camiseta.id, variantId: variant.id, quantity: 1 }] })
    expect(data.items).toEqual([
      { name: 'Caneca <Café>', code: '7891234567895', priceCents: 1990, quantity: 2 },
      { name: 'Camiseta — P', code: 'CAM-P', priceCents: 5000, quantity: 1 }
    ])
    const html = buildLabelsHtml(data.items, (await devices.settings(admin)).labelPrinter, true)
    expect(html.match(/class="label"/g)).toHaveLength(3)
    expect(html).toContain('Caneca &lt;Café&gt;')
    expect(html).toContain('R$ 19,90')
    expect(html).toContain('size: 50mm 30mm')
  })
})

describe('notas fiscais', () => {
  it('conferência, preparação com pendências, sem provedor nada é transmitido, descarte e cancelamento da venda', async () => {
    const { s, admin, operator, caneca, camiseta } = await scenario()
    await expect(s.fiscal.checklist(operator)).rejects.toMatchObject({ code: 'FORBIDDEN' })
    let check = await s.fiscal.checklist(admin)
    expect(check.providerConfigured).toBe(false)
    expect(check.company).toEqual([
      'Empresa: informe a inscrição estadual (ou "ISENTO").',
      'Empresa: informe o regime tributário (CRT).',
      'Empresa: endereço incompleto (logradouro, número, bairro, cidade, UF e CEP).'
    ])
    expect(check.products.map((p) => p.name)).toEqual(['Caneca'])
    expect(check.products[0].missing).toEqual(['NCM', 'CFOP', 'origem', 'CST/CSOSN'])

    const variant = (await s.products.get(admin, { id: camiseta.id })).variants[0]
    const sale = await s.sales.finalize(admin, {
      requestId: rid(),
      items: [{ productId: caneca.id, quantityMilli: 1000 }, { productId: camiseta.id, variantId: variant.id, quantityMilli: 1000 }],
      payments: [{ method: 'PIX', amountCents: 7500 }]
    })
    const doc = await s.fiscal.prepare(admin, { saleId: sale.id, type: 'NFCE' })
    expect(doc).toMatchObject({ status: 'PENDING', type: 'NFCE', provider: 'NONE', environment: 'HOMOLOGACAO', totalCents: 7500 })
    expect(doc.issues.some((m) => m.includes('"Caneca": falta NCM'))).toBe(true)
    expect(doc.payload!.items[1]).toMatchObject({ ncm: '61091000', cfop: '5102', origin: '0', taxCode: '102' })
    expect(doc.payload!.payments).toEqual([{ code: '17', method: 'PIX', amountCents: 7500 }])
    await expect(s.fiscal.prepare(admin, { saleId: sale.id, type: 'NFCE' })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(s.fiscal.prepare(admin, { saleId: sale.id, type: 'NFE' })).rejects.toMatchObject({ code: 'CONFLICT' })
    // Com pendências não transmite; sem provedor também não (e nunca vira "autorizada")
    await expect(s.fiscal.transmit(admin, { id: doc.id })).rejects.toThrow(/Corrija as pendências/)
    await expect(s.fiscal.cancel(admin, { id: doc.id, reason: 'Cliente desistiu da compra' })).rejects.toThrow(/Somente notas autorizadas/)

    // Venda cancelada descarta o rascunho
    await s.sales.cancel(admin, { saleId: sale.id, reason: 'Erro no lançamento' })
    expect((await s.fiscal.get(admin, { id: doc.id })).status).toBe('DISCARDED')

    // Cadastros completos: pronta para transmitir, mas sem provedor configurado
    await t.db.company.updateMany({ data: { document: '11222333000181', stateRegistration: 'ISENTO', taxRegime: '1', street: 'Rua A', number: '1', district: 'Centro', city: 'Recife', state: 'PE', zipCode: '50000000' } })
    await t.db.product.update({ where: { id: caneca.id }, data: { ncm: '69120000', cfop: '5102', taxOrigin: '0', taxCode: '102' } })
    check = await s.fiscal.checklist(admin)
    expect([check.company, check.products]).toEqual([[], []])
    const sale2 = await s.sales.finalize(admin, { requestId: rid(), items: [{ productId: caneca.id, quantityMilli: 1000 }], payments: [{ method: 'CASH', amountCents: 2500 }] })
    const doc2 = await s.fiscal.prepare(admin, { saleId: sale2.id, type: 'NFCE' })
    expect(doc2.issues).toEqual([])
    await expect(s.fiscal.transmit(admin, { id: doc2.id })).rejects.toThrow(/Nenhum provedor fiscal/)
    expect((await s.fiscal.get(admin, { id: doc2.id })).status).toBe('PENDING')
    expect((await s.fiscal.list(admin, {})).total).toBe(2)
    expect((await s.fiscal.discard(admin, { id: doc2.id })).status).toBe('DISCARDED')
    // NF-e exige destinatário identificado
    const nfe = await s.fiscal.prepare(admin, { saleId: sale2.id, type: 'NFE' })
    expect(nfe.issues.some((m) => m.includes('destinatário'))).toBe(true)
  })

  it('arquitetura de provedor: autorização só pela resposta do provedor; venda com nota autorizada não é cancelada sem cancelar a nota', async () => {
    const { s, admin, caneca } = await scenario()
    await t.db.company.updateMany({ data: { document: '11222333000181', stateRegistration: 'ISENTO', taxRegime: '1', street: 'Rua A', number: '1', district: 'Centro', city: 'Recife', state: 'PE', zipCode: '50000000' } })
    await t.db.product.update({ where: { id: caneca.id }, data: { ncm: '69120000', cfop: '5102', taxOrigin: '0', taxCode: '102' } })
    // Provedor de TESTE (dublê): verifica apenas o fluxo de estados do serviço
    const calls: string[] = []
    const fake: FiscalProvider = {
      key: 'NONE',
      label: 'dublê de teste',
      emit: async (doc) => (calls.push(`emit:${doc.payload.items.length}`), { status: 'AUTHORIZED', message: 'Autorizado o uso da NF-e', number: 15, accessKey: '2'.repeat(44), protocol: '1'.repeat(15), xml: '<nfeProc/>' }),
      query: async () => ({ status: 'AUTHORIZED', message: 'ok' }),
      cancel: async (_d, reason) => (calls.push(`cancel:${reason}`), { ok: true, protocol: '9'.repeat(15), message: 'Cancelamento homologado' })
    }
    const files: Record<string, string> = {}
    const fiscal = new FiscalService(t.db, { NONE: fake }, { write: (name, data) => ((files[name] = String(data)), name) })
    const sale = await s.sales.finalize(admin, { requestId: rid(), items: [{ productId: caneca.id, quantityMilli: 1000 }], payments: [{ method: 'CASH', amountCents: 2500 }] })
    const doc = await fiscal.prepare(admin, { saleId: sale.id, type: 'NFCE' })
    const sent = await fiscal.transmit(admin, { id: doc.id })
    expect(sent).toMatchObject({ status: 'AUTHORIZED', number: 15, hasXml: true })
    expect(files[`nota-${doc.id}.xml`]).toBe('<nfeProc/>')
    await expect(fiscal.transmit(admin, { id: doc.id })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(s.sales.cancel(admin, { saleId: sale.id, reason: 'Desistência' })).rejects.toThrow(/nota fiscal autorizada/)
    await expect(fiscal.cancel(admin, { id: doc.id, reason: 'curta' })).rejects.toThrow(/15 caracteres/)
    const cancelled = await fiscal.cancel(admin, { id: doc.id, reason: 'Cliente desistiu após a emissão' })
    expect(cancelled.status).toBe('CANCELLED')
    await s.sales.cancel(admin, { saleId: sale.id, reason: 'Desistência' })
    expect(calls).toEqual(['emit:1', 'cancel:Cliente desistiu após a emissão'])
  })
})

describe('TEF e conciliação', () => {
  it('sem TEF integrado; NSU/autorização do comprovante, conciliação e bloqueio de número de cartão', async () => {
    const { s, admin, operator, caneca } = await scenario()
    const status = await s.tef.providerStatus()
    expect(status).toMatchObject({ key: 'NONE', provider: null })
    const v1 = await s.sales.finalize(admin, {
      requestId: rid(),
      items: [{ productId: caneca.id, quantityMilli: 2000 }],
      payments: [{ method: 'CREDIT_CARD', amountCents: 5000, installments: 2, nsu: '123456', authorizationCode: 'ab12cd', cardBrand: 'VISA' }]
    })
    await expect(
      s.sales.finalize(admin, { requestId: rid(), items: [{ productId: caneca.id, quantityMilli: 1000 }], payments: [{ method: 'DEBIT_CARD', amountCents: 2500, nsu: '4111111111111111' }] })
    ).rejects.toThrow(/NSU: até 12 dígitos/)
    const v2 = await s.sales.finalize(admin, { requestId: rid(), items: [{ productId: caneca.id, quantityMilli: 1000 }], payments: [{ method: 'PIX', amountCents: 2500 }] })
    await s.sales.finalize(admin, { requestId: rid(), items: [{ productId: caneca.id, quantityMilli: 1000 }], payments: [{ method: 'CASH', amountCents: 2500 }] })

    await expect(s.tef.reconciliation(operator, { from: today(), to: today() })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    let rec = await s.tef.reconciliation(admin, { from: today(), to: today() })
    expect(rec.rows.map((r) => [r.saleId, r.method, r.nsu, r.authorizationCode])).toEqual([
      [v1.id, 'CREDIT_CARD', '123456', 'AB12CD'],
      [v2.id, 'PIX', null, null]
    ])
    const pix = rec.rows[1]
    await expect(s.tef.updateReference(admin, { paymentId: pix.paymentId, nsu: '5555444433332222' })).rejects.toThrow(/NSU: até 12 dígitos/)
    await s.tef.updateReference(admin, { paymentId: pix.paymentId, authorizationCode: 'E2E99' })
    expect((await s.tef.reconcile(admin, { paymentIds: rec.rows.map((r) => r.paymentId), reconciled: true })).updated).toBe(2)
    rec = await s.tef.reconciliation(admin, { from: today(), to: today(), status: 'pending' })
    expect(rec.rows).toHaveLength(0)
    rec = await s.tef.reconciliation(admin, { from: today(), to: today() })
    expect(rec.byMethod).toEqual(
      expect.arrayContaining([
        { method: 'CREDIT_CARD', count: 1, amountCents: 5000, reconciledCount: 1, reconciledCents: 5000 },
        { method: 'PIX', count: 1, amountCents: 2500, reconciledCount: 1, reconciledCents: 2500 }
      ])
    )
    expect(await t.db.auditLog.count({ where: { action: { in: ['payment.reference', 'payment.reconcile'] } } })).toBe(2)
  })
})
