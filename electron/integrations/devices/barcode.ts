/**
 * Códigos de barras para etiquetas, sem dependências: EAN-13 (códigos de 13 dígitos com dígito
 * verificador válido) e Code 128 (conjunto B) para os demais códigos internos/SKU.
 * O resultado é uma sequência de módulos (true = barra) desenhada em SVG.
 */

// Code 128: larguras barra/espaço de cada símbolo (0–106); cada um soma 11 módulos, o de parada 13.
export const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
]
const START_B = 104
const STOP = 106

function widthsToModules(widths: string): boolean[] {
  const out: boolean[] = []
  for (let i = 0; i < widths.length; i++) for (let w = 0; w < Number(widths[i]); w++) out.push(i % 2 === 0)
  return out
}

/** Code 128-B: caracteres ASCII 32–126 (acentos são removidos antes). */
export function code128(text: string): boolean[] {
  const clean = text.normalize('NFD').replace(/[̀-ͯ]/g, '')
  if (!clean || /[^\x20-\x7e]/.test(clean)) throw new Error('Código com caracteres não suportados')
  const values = [...clean].map((c) => c.charCodeAt(0) - 32)
  const checksum = (START_B + values.reduce((a, v, i) => a + v * (i + 1), 0)) % 103
  return [START_B, ...values, checksum, STOP].flatMap((v) => widthsToModules(CODE128_PATTERNS[v]))
}

// EAN-13
export const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011']
export const EAN_G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111']
export const EAN_R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100']
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL']

export function eanCheckDigit(first12: string): number {
  const sum = [...first12].reduce((a, d, i) => a + Number(d) * (i % 2 === 0 ? 1 : 3), 0)
  return (10 - (sum % 10)) % 10
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && eanCheckDigit(code.slice(0, 12)) === Number(code[12])
}

export function ean13(code: string): boolean[] {
  if (!isValidEan13(code)) throw new Error('EAN-13 inválido')
  const bits = (s: string) => [...s].map((b) => b === '1')
  const parity = PARITY[Number(code[0])]
  const left = [...code.slice(1, 7)].flatMap((d, i) => bits((parity[i] === 'L' ? EAN_L : EAN_G)[Number(d)]))
  const right = [...code.slice(7)].flatMap((d) => bits(EAN_R[Number(d)]))
  return [...bits('101'), ...left, ...bits('01010'), ...right, ...bits('101')]
}

/** Escolhe a simbologia: EAN-13 quando válido, senão Code 128. */
export function encodeBarcode(code: string): { symbology: 'EAN13' | 'CODE128'; modules: boolean[] } {
  return isValidEan13(code) ? { symbology: 'EAN13', modules: ean13(code) } : { symbology: 'CODE128', modules: code128(code) }
}

/** SVG com zona de silêncio de 10 módulos de cada lado; largura e altura em milímetros. */
export function barcodeSvg(code: string, widthMm: number, heightMm: number): string {
  const { modules } = encodeBarcode(code)
  const quiet = 10
  const total = modules.length + quiet * 2
  const rects: string[] = []
  for (let i = 0; i < modules.length; ) {
    if (!modules[i]) {
      i++
      continue
    }
    let j = i
    while (j < modules.length && modules[j]) j++
    rects.push(`<rect x="${i + quiet}" y="0" width="${j - i}" height="100"/>`)
    i = j
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 100" preserveAspectRatio="none" width="${widthMm}mm" height="${heightMm}mm" shape-rendering="crispEdges">${rects.join('')}</svg>`
}
