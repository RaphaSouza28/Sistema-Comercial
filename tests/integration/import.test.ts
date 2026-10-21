import { afterEach, describe, expect, it } from 'vitest'
import { decodeText, parseCsv, toCsv } from '../../electron/utils/csv'
import { createTestDatabase, type TestDatabase } from '../helpers/db'
import { actors } from '../helpers/actors'

let t: TestDatabase
afterEach(async () => {
  await t?.cleanup()
})

describe('CSV', () => {
  it('lê ; com aspas, quebras de linha e arquivos ANSI do Excel', () => {
    expect(parseCsv('nome;preco\r\n"Caneta; azul";"1,50"\r\n"Diz ""oi""";2\r\n')).toEqual([
      ['nome', 'preco'],
      ['Caneta; azul', '1,50'],
      ['Diz "oi"', '2']
    ])
    const ansi = new Uint8Array([0x43, 0x61, 0x66, 0xe9]) // "Café" em Windows-1252
    expect(decodeText(ansi)).toBe('Café')
    expect(decodeText(new TextEncoder().encode('﻿Ação'))).toBe('Ação')
  })

  it('protege contra fórmulas ao exportar', () => {
    expect(toCsv([['=HYPERLINK("x")', '-10,5', 'a;b']])).toBe('﻿"\'=HYPERLINK(""x"")";-10,5;"a;b"\r\n')
  })
})

const sheet = (lines: string[]) => parseCsv(lines.join('\r\n'))

describe('importação de produtos', () => {
  it('prévia não grava nada; confirmação cria, atualiza e informa erros por linha', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    await s.suppliers.create(admin, { name: 'Distribuidora Sul' })
    const existing = await s.products.create(admin, { name: 'Caneta', sku: 'CAN-01', salePriceCents: 250 })

    const rows = sheet([
      'Código;SKU;Código Barras;Nome;Categoria;Subcategoria;Fornecedor;Unidade;Custo;Preço Venda;Estoque Inicial',
      ';CAD-01;789000111;Caderno 10 matérias;Papelaria;Cadernos;distribuidora sul;un;12,50;24,90;15',
      ';CAN-01;;Caneta azul;Papelaria;;;UN;;2,90;5',
      ';LAP-01;;Lápis;Papelaria;;Fornecedor X;UN;abc;1,00;',
      ';CAD-01;;Duplicado;;;;UN;;1,00;'
    ])
    const preview = await s.productTransfer.preview(admin, rows, 'produtos.csv')
    expect(preview).toMatchObject({ total: 4, createCount: 1, updateCount: 1, errorCount: 2 })
    expect(preview.rows[2].messages.join(' ')).toContain('Valor inválido em "custo"')
    expect(preview.rows[3].messages.join(' ')).toContain('repetido')
    expect(await t.db.product.count()).toBe(1)

    const result = await s.productTransfer.apply(admin, { token: preview.token, updateExisting: true })
    expect(result).toMatchObject({ created: 1, updated: 1, skipped: 2, errors: [] })

    const caderno = await t.db.product.findFirstOrThrow({ where: { sku: 'CAD-01' }, include: { category: true, subcategory: true, supplier: true } })
    expect(caderno).toMatchObject({ costCents: 1250, salePriceCents: 2490, stockMilli: 15000, unit: 'UN' })
    expect(caderno.category?.name).toBe('Papelaria')
    expect(caderno.subcategory?.name).toBe('Cadernos')
    expect(caderno.supplier?.name).toBe('Distribuidora Sul')
    expect(await t.db.stockMovement.count({ where: { productId: caderno.id, type: 'INITIAL' } })).toBe(1)

    const caneta = await t.db.product.findUniqueOrThrow({ where: { id: existing.id } })
    expect(caneta).toMatchObject({ name: 'Caneta azul', salePriceCents: 290, stockMilli: 0 })
    const hist = await s.products.priceHistory(admin, { id: existing.id })
    expect(hist[0]).toMatchObject({ oldCents: 250, newCents: 290 })
    expect(hist[0].reason).toContain('Importação')

    // A mesma prévia não pode ser aplicada duas vezes
    await expect(s.productTransfer.apply(admin, { token: preview.token })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('sem marcar "atualizar existentes", produtos já cadastrados são ignorados', async () => {
    t = await createTestDatabase()
    const { s, admin } = await actors(t.db)
    await s.products.create(admin, { name: 'Caneta', sku: 'CAN-01', salePriceCents: 250 })
    const preview = await s.productTransfer.preview(admin, sheet(['sku;nome;preco_venda', 'CAN-01;Caneta nova;9,99']), 'a.csv')
    const result = await s.productTransfer.apply(admin, { token: preview.token })
    expect(result).toMatchObject({ created: 0, updated: 0, skipped: 1 })
    expect((await t.db.product.findFirstOrThrow()).salePriceCents).toBe(250)
  })

  it('gerente sem permissão de custo não importa a coluna de custo', async () => {
    t = await createTestDatabase()
    const { s, manager } = await actors(t.db)
    const preview = await s.productTransfer.preview(manager, sheet(['nome;custo;preco_venda', 'Item;1,00;2,00', 'Item 2;;3,00']), 'a.csv')
    expect(preview.errorCount).toBe(1)
    expect(preview.createCount).toBe(1)
  })

  it('exportação respeita a permissão de custos', async () => {
    t = await createTestDatabase()
    const { s, admin, manager } = await actors(t.db)
    await s.products.create(admin, { name: 'Caderno', costCents: 1250, salePriceCents: 2490, initialStockMilli: 3000 })
    const full = await s.productTransfer.exportCsv(admin)
    expect(full.count).toBe(1)
    const rows = parseCsv(full.csv.replace(/^﻿/, ''))
    expect(rows[0]).toContain('custo')
    expect(rows[1]).toContain('12,50')
    expect(rows[1]).toContain('24,90')
    const limited = parseCsv((await s.productTransfer.exportCsv(manager)).csv.replace(/^﻿/, ''))
    expect(limited[0]).not.toContain('custo')
    expect(limited[1]).not.toContain('12,50')
  })
})
