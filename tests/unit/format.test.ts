import { describe, expect, it } from 'vitest'
import { formatDate, formatMoney, formatPercentBps, formatQuantity, parseMoney } from '../../shared/format'
import { formatDocument, isValidCnpj, isValidCpf } from '../../shared/documents'

describe('formatação monetária', () => {
  it('formata centavos no padrão R$ 1.234,56', () => {
    expect(formatMoney(123456)).toBe('R$ 1.234,56')
    expect(formatMoney(0)).toBe('R$ 0,00')
    expect(formatMoney(6714)).toBe('R$ 67,14')
    expect(formatMoney(-1050)).toBe('-R$ 10,50')
    expect(formatMoney(-0)).toBe('R$ 0,00')
  })

  it('converte texto digitado em centavos sem ponto flutuante', () => {
    expect(parseMoney('1.234,56')).toBe(123456)
    expect(parseMoney('R$ 10')).toBe(1000)
    expect(parseMoney('10,5')).toBe(1050)
    expect(parseMoney('0,1')).toBe(10)
    expect(parseMoney('0,29')).toBe(29)
    expect(parseMoney('')).toBeNull()
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('1,234')).toBeNull()
  })

  it('formata quantidades em milésimos e percentuais em pontos-base', () => {
    expect(formatQuantity(1500)).toBe('1,5')
    expect(formatQuantity(12000)).toBe('12')
    expect(formatPercentBps(3000)).toBe('30,0%')
    expect(formatPercentBps(250)).toBe('2,5%')
  })

  it('formata datas no padrão brasileiro', () => {
    expect(formatDate(new Date(2026, 9, 5))).toBe('05/10/2026')
  })
})

describe('CPF/CNPJ', () => {
  it('valida dígitos verificadores', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true)
    expect(isValidCpf('529.982.247-24')).toBe(false)
    expect(isValidCpf('111.111.111-11')).toBe(false)
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true)
    expect(isValidCnpj('11.222.333/0001-80')).toBe(false)
  })

  it('formata documentos', () => {
    expect(formatDocument('52998224725')).toBe('529.982.247-25')
    expect(formatDocument('11222333000181')).toBe('11.222.333/0001-81')
  })
})

describe('parseMoney com ponto', () => {
  it('trata ponto seguido de 1-2 dígitos como decimal e rejeita agrupamentos inválidos', () => {
    expect(parseMoney('10.50')).toBe(1050)
    expect(parseMoney('10.5')).toBe(1050)
    expect(parseMoney('1.234')).toBe(123400)
    expect(parseMoney('1.234.567,89')).toBe(123456789)
    expect(parseMoney('1.2.3')).toBeNull()
    expect(parseMoney('12.3456')).toBeNull()
    expect(parseMoney('1.234,5.6')).toBeNull()
  })
})
