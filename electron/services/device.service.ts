import { DEFAULT_DEVICES, devicesSchema, labelPrintSchema, type DevicesSettings } from '@shared/deviceSchemas'
import { effectivePrice } from '@shared/pricing'
import type { Db, DbClient } from '../database/connection'
import { deviceErrorMessage, drawerPulse, openRawDevice, type RawDevice } from '../integrations/devices/escpos'
import { writeAudit } from '../repositories/audit.repository'
import { getSetting, setSetting } from '../repositories/setting.repository'
import { AppError, conflict, notFound } from '../utils/errors'
import { requireActor, requirePermission, type Actor } from './context'
import type { LabelItem } from './labels'

const KEY = 'devices'

/** Configuração salva, completada com os padrões (campos novos em versões futuras). */
export async function readDevices(db: DbClient): Promise<DevicesSettings> {
  const stored = await getSetting<Partial<DevicesSettings>>(db, KEY, {})
  const merged = {
    receiptPrinter: { ...DEFAULT_DEVICES.receiptPrinter, ...stored.receiptPrinter },
    documentPrinter: { ...DEFAULT_DEVICES.documentPrinter, ...stored.documentPrinter },
    labelPrinter: { ...DEFAULT_DEVICES.labelPrinter, ...stored.labelPrinter },
    cashDrawer: { ...DEFAULT_DEVICES.cashDrawer, ...stored.cashDrawer }
  }
  const parsed = devicesSchema.safeParse(merged)
  return parsed.success ? parsed.data : DEFAULT_DEVICES
}

/**
 * Impressoras e dispositivos: configuração, gaveta de dinheiro (ESC/POS) e dados das etiquetas.
 * A impressão em si é feita pelo processo principal (Electron), que usa esta configuração.
 */
export class DeviceService {
  constructor(
    private readonly db: Db,
    /** Substituível nos testes; em produção abre o compartilhamento/porta configurado. */
    private readonly openDevice: (mode: 'ESCPOS_SHARE' | 'ESCPOS_SERIAL', target: string) => RawDevice = openRawDevice
  ) {}

  /** Lida por qualquer usuário autenticado (o PDV precisa saber se imprime/abre a gaveta). */
  async settings(actor: Actor | null): Promise<DevicesSettings> {
    requireActor(actor)
    return readDevices(this.db)
  }

  async update(actorInput: Actor | null, input: unknown): Promise<DevicesSettings> {
    const actor = requirePermission(actorInput, 'settings.manage')
    const data = devicesSchema.parse(input)
    await this.db.$transaction(async (tx) => {
      const before = await readDevices(tx)
      await setSetting(tx, KEY, data)
      await writeAudit(tx, { userId: actor.userId, action: 'settings.devices', details: { before, after: data } })
    })
    return data
  }

  /**
   * Envia o pulso de abertura à gaveta. Abertura manual exige permissão de caixa e fica na auditoria
   * (abrir a gaveta sem venda é um ponto clássico de fraude).
   */
  async openDrawer(actorInput: Actor | null, opts: { reason: 'manual' | 'sale' | 'test'; saleId?: number }): Promise<void> {
    const actor = opts.reason === 'test' ? requirePermission(actorInput, 'settings.manage') : requirePermission(actorInput, 'cash.operate', 'pdv.sell')
    const cfg = (await readDevices(this.db)).cashDrawer
    if (cfg.mode === 'NONE' || !cfg.target) throw conflict('Gaveta de dinheiro não configurada. Configure em Configurações → Impressoras e dispositivos.')
    const device = this.openDevice(cfg.mode, cfg.target)
    try {
      await device.write(drawerPulse(cfg.pin))
    } catch (error) {
      await writeAudit(this.db, { userId: actor.userId, action: 'cash.drawer.error', details: { reason: opts.reason, saleId: opts.saleId, device: device.description } })
      throw new AppError('CONFLICT', deviceErrorMessage(error, device.description))
    }
    await writeAudit(this.db, { userId: actor.userId, action: 'cash.drawer.open', details: { reason: opts.reason, saleId: opts.saleId ?? null, device: device.description } })
  }

  /** Etiquetas: nome, código (barras > SKU > código interno) e preço vigente de cada item. */
  async labelItems(actorInput: Actor | null, input: unknown): Promise<{ items: LabelItem[]; showPrice: boolean; format: 'print' | 'pdf' }> {
    requirePermission(actorInput, 'products.view', 'products.manage', 'stock.manage')
    const data = labelPrintSchema.parse(input)
    const products = await this.db.product.findMany({
      where: { id: { in: [...new Set(data.items.map((i) => i.productId))] }, deletedAt: null },
      include: { variants: { where: { deletedAt: null } } }
    })
    const now = new Date()
    const items = data.items.map((i): LabelItem => {
      const p = products.find((x) => x.id === i.productId)
      if (!p) throw notFound('Produto não encontrado.')
      const v = i.variantId ? p.variants.find((x) => x.id === i.variantId) : null
      if (i.variantId && !v) throw notFound('Variação não encontrada.')
      return {
        name: v ? `${p.name} — ${v.name}` : p.name,
        code: v?.barcode || v?.sku || p.barcode || p.internalCode,
        priceCents: v?.salePriceCents ?? effectivePrice(p, now),
        quantity: i.quantity
      }
    })
    return { items, showPrice: data.showPrice, format: data.format }
  }
}
