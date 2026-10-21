import { describe, expect, it } from 'vitest'
import { CODE128_PATTERNS, EAN_G, EAN_L, EAN_R, barcodeSvg, code128, ean13, eanCheckDigit, encodeBarcode, isValidEan13 } from '../../electron/integrations/devices/barcode'
import { drawerPulse } from '../../electron/integrations/devices/escpos'

/** Decodifica Code 128 a partir dos módulos (prova de ida e volta independente do codificador). */
function decode128(modules: boolean[]): number[] {
  const values: number[] = []
  let i = 0
  while (i < modules.length) {
    const widths: number[] = []
    for (let k = 0; k < 6 && i < modules.length; k++) {
      let w = 0
      const bar = modules[i]
      while (i < modules.length && modules[i] === bar) {
        w++
        i++
      }
      widths.push(w)
    }
    const idx = CODE128_PATTERNS.indexOf(widths.join(''))
    values.push(idx)
    if (idx === 106) break
  }
  return values
}

describe('códigos de barras', () => {
  it('tabela Code 128 consistente (107 símbolos distintos, 11 módulos cada, parada com 13)', () => {
    expect(CODE128_PATTERNS).toHaveLength(107)
    expect(new Set(CODE128_PATTERNS).size).toBe(107)
    for (const [i, p] of CODE128_PATTERNS.entries()) expect([...p].reduce((a, d) => a + Number(d), 0)).toBe(i === 106 ? 13 : 11)
  })

  it('Code 128-B com dígito verificador e ida e volta', () => {
    const m = code128('PRD-001')
    const decoded = decode128(m.slice(0, m.length - 13))
    expect(decoded[0]).toBe(104) // início B
    const data = decoded.slice(1, -1)
    expect(String.fromCharCode(...data.map((v) => v + 32))).toBe('PRD-001')
    const checksum = decoded.at(-1)!
    expect(checksum).toBe((104 + data.reduce((a, v, i) => a + v * (i + 1), 0)) % 103)
    expect(m.length).toBe(11 * (1 + 7 + 1) + 13)
    expect(() => code128('')).toThrow()
    expect(code128('Caneção').length).toBe(code128('Canecao').length) // acentos removidos
  })

  it('EAN-13: dígito verificador, tabelas e 95 módulos', () => {
    expect(eanCheckDigit('789123456789')).toBe(5)
    expect(eanCheckDigit('400638133393')).toBe(1)
    expect(isValidEan13('4006381333931')).toBe(true)
    expect(isValidEan13('4006381333932')).toBe(false)
    for (let d = 0; d < 10; d++) {
      expect(EAN_R[d]).toBe([...EAN_L[d]].map((b) => (b === '1' ? '0' : '1')).join(''))
      expect(EAN_G[d]).toBe([...EAN_R[d]].reverse().join(''))
    }
    const m = ean13('7891234567895')
    expect(m).toHaveLength(95)
    expect(m.slice(0, 3)).toEqual([true, false, true])
    expect(m.slice(45, 50)).toEqual([false, true, false, true, false])
    expect(encodeBarcode('7891234567895').symbology).toBe('EAN13')
    expect(encodeBarcode('7891234567890').symbology).toBe('CODE128') // verificador inválido
    expect(barcodeSvg('000123', 40, 10)).toMatch(/^<svg[^>]+width="40mm" height="10mm"/)
  })

  it('pulso da gaveta ESC/POS nos pinos 2 e 5', () => {
    expect([...drawerPulse(2)]).toEqual([0x1b, 0x70, 0x00, 0x19, 0xfa])
    expect([...drawerPulse(5)]).toEqual([0x1b, 0x70, 0x01, 0x19, 0xfa])
  })
})
