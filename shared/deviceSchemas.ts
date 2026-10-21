import { z } from 'zod'

/** Impressora do Windows (nome exato) ou null = escolher na janela de impressão. */
const deviceName = z
  .string()
  .trim()
  .max(200)
  .nullish()
  .transform((v) => (v ? v : null))

const printer = z.object({
  deviceName,
  /** Imprime direto, sem abrir a janela de impressão (exige impressora escolhida ou a padrão do Windows). */
  silent: z.boolean().default(false),
  copies: z.number().int().min(1).max(5).default(1)
})

/** Destinos de comandos ESC/POS: impressora compartilhada (\\computador\compartilhamento) ou porta serial (COM1…COM256). */
export const SHARE_PATTERN = /^\\\\[A-Za-z0-9._-]+\\[^\\/:*?"<>|]+$/
export const SERIAL_PATTERN = /^COM([1-9]\d{0,2})$/i

export const devicesSchema = z
  .object({
    receiptPrinter: printer.extend({
      paperWidthMm: z.union([z.literal(58), z.literal(80)]).default(80),
      /** Imprime o comprovante não fiscal ao concluir cada venda. */
      autoPrintAfterSale: z.boolean().default(false)
    }),
    documentPrinter: printer,
    labelPrinter: printer.extend({
      /** ROLL = impressora de etiquetas (uma etiqueta por página); A4 = folha de etiquetas adesivas. */
      media: z.enum(['ROLL', 'A4']).default('ROLL'),
      labelWidthMm: z.number().int().min(20).max(120).default(50),
      labelHeightMm: z.number().int().min(10).max(120).default(30),
      columns: z.number().int().min(1).max(6).default(3)
    }),
    cashDrawer: z.object({
      /** Gaveta ligada à impressora térmica (ESC/POS) compartilhada no Windows ou em porta serial. */
      mode: z.enum(['NONE', 'ESCPOS_SHARE', 'ESCPOS_SERIAL']).default('NONE'),
      target: z
        .string()
        .trim()
        .max(200)
        .nullish()
        .transform((v) => (v ? v : null)),
      /** Pino do conector da gaveta (2 ou 5). */
      pin: z.union([z.literal(2), z.literal(5)]).default(2),
      openOnCashSale: z.boolean().default(true)
    })
  })
  .superRefine((v, ctx) => {
    const d = v.cashDrawer
    if (d.mode === 'ESCPOS_SHARE' && !(d.target && SHARE_PATTERN.test(d.target))) {
      ctx.addIssue({ code: 'custom', path: ['cashDrawer', 'target'], message: 'Informe a impressora compartilhada, ex.: \\\\localhost\\Termica' })
    }
    if (d.mode === 'ESCPOS_SERIAL' && !(d.target && SERIAL_PATTERN.test(d.target))) {
      ctx.addIssue({ code: 'custom', path: ['cashDrawer', 'target'], message: 'Informe a porta serial, ex.: COM3' })
    }
  })

export type DevicesSettings = z.output<typeof devicesSchema>
export type DevicesInput = z.input<typeof devicesSchema>

export const DEFAULT_DEVICES: DevicesSettings = devicesSchema.parse({ receiptPrinter: {}, documentPrinter: {}, labelPrinter: {}, cashDrawer: {} })

export const labelPrintSchema = z.object({
  items: z
    .array(z.object({ productId: z.number().int().positive(), variantId: z.number().int().positive().nullish().transform((v) => v ?? null), quantity: z.number().int().min(1).max(500) }))
    .min(1, 'Escolha ao menos um produto')
    .max(200),
  showPrice: z.boolean().default(true),
  format: z.enum(['print', 'pdf']).default('print')
})
export type LabelPrintInput = z.input<typeof labelPrintSchema>
