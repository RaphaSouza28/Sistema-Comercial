/// <reference lib="dom" />
/// <reference path="../../src/types/global.d.ts" />
import fs from 'node:fs'
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { completeSetup, launch, mockSaveDialog, shot, tempDataDir } from './helpers'

const DATA_DIR = tempDataDir('sc-e2e-stock-')

/** Linha da posição de estoque de um produto. */
const row = (page: Page, name: string) => page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) })

test('Fase 3: entrada com leitor de código, saída bloqueada por falta de estoque, ajuste, histórico e inventário', async () => {
  const { app, page } = await launch(DATA_DIR)
  await completeSetup(page)

  // Dados de apoio pela API (cadastros já cobertos pelos testes da Fase 2)
  const seeded = await page.evaluate(async () => {
    const caneta = await window.api.products.create({ name: 'Caneta azul', barcode: '7890001', costCents: 1000, salePriceCents: 2500, initialStockMilli: 10000, minStockMilli: 3000 })
    const tenis = await window.api.products.create({
      name: 'Tênis',
      salePriceCents: 20000,
      hasVariants: true,
      variantOptions: [{ name: 'Tamanho', values: ['40', '41'] }],
      variants: [{ attributes: { Tamanho: '40' }, initialStockMilli: 2000 }, { attributes: { Tamanho: '41' } }]
    })
    const sup = await window.api.suppliers.create({ name: 'Papelaria Atacado' })
    return [caneta.ok, tenis.ok, sup.ok]
  })
  expect(seeded).toEqual([true, true, true])

  await page.getByRole('navigation').getByRole('link', { name: /Estoque/ }).click()
  await expect(page.getByRole('heading', { name: 'Estoque', exact: true })).toBeVisible()
  await expect(page.getByText('Itens em estoque')).toBeVisible()
  await expect(page.getByText('R$ 100,00').first()).toBeVisible() // custo total: 10 × R$ 10,00
  await expect(page.getByRole('alert').filter({ hasText: 'reposição' })).toBeVisible() // Tênis 41 esgotado

  // ── Entrada: leitor de código de barras (código + Enter); a 2ª leitura soma 1 ──
  await page.getByRole('button', { name: 'Entrada de mercadorias' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Fornecedor').selectOption({ label: 'Papelaria Atacado' })
  await dialog.getByLabel('Nº da nota / documento').fill('NF 123')
  const picker = dialog.getByLabel('Adicionar produto')
  await picker.fill('7890001')
  await picker.press('Enter')
  await picker.fill('7890001')
  await picker.press('Enter')
  await expect(dialog.getByLabel('Quantidade Caneta azul')).toHaveValue('2')
  await dialog.getByLabel('Quantidade Caneta azul').fill('10')
  await dialog.getByLabel('Custo Caneta azul').fill('12')
  await dialog.getByRole('radio', { name: 'Custo médio ponderado' }).click()
  await expect(dialog.getByText('R$ 120,00').first()).toBeVisible()
  await shot(page, '20-estoque-entrada')
  await dialog.getByRole('button', { name: 'Registrar entrada' }).click()
  await expect(page.getByText('Entrada registrada: 1 item(ns).')).toBeVisible()
  await expect(row(page, 'Caneta azul')).toContainText('20')
  await expect(row(page, 'Caneta azul')).toContainText('R$ 11,00') // média: (10×10 + 10×12) / 20

  // ── Saída sem estoque suficiente é bloqueada; depois, saída válida ──
  await page.getByRole('button', { name: 'Saída', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Motivo').selectOption({ label: 'Avaria' })
  await dialog.getByLabel('Adicionar produto').fill('caneta')
  await page.getByRole('option', { name: /Caneta azul/ }).click()
  await dialog.getByLabel('Quantidade Caneta azul').fill('25')
  await dialog.getByRole('button', { name: 'Registrar saída' }).click()
  await expect(dialog.getByText(/Estoque insuficiente de "Caneta azul"/)).toBeVisible()
  await dialog.getByLabel('Quantidade Caneta azul').fill('2')
  await dialog.getByRole('button', { name: 'Registrar saída' }).click()
  await expect(page.getByText('Saída registrada: 1 item(ns).')).toBeVisible()
  await expect(row(page, 'Caneta azul')).toContainText('18')

  // ── Ajuste pela linha ──
  await page.getByRole('button', { name: 'Ajustar Caneta azul' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Quantidade correta em estoque').fill('17')
  await expect(dialog.getByText('Diferença: -1 UN')).toBeVisible()
  await dialog.getByLabel('Motivo do ajuste').fill('Conferência do balcão')
  await dialog.getByRole('button', { name: 'Ajustar' }).click()
  await expect(page.getByText('Estoque ajustado.')).toBeVisible()
  await expect(row(page, 'Caneta azul')).toContainText('17')

  // ── Histórico de movimentações e exportação ──
  await page.getByRole('button', { name: 'Histórico de Caneta azul' }).click()
  await expect(page.getByRole('cell', { name: 'Conferência do balcão' })).toBeVisible()
  await expect(page.getByText(/Papelaria Atacado · Doc\. NF 123/)).toBeVisible()
  await expect(page.getByText('Avaria')).toBeVisible()
  await shot(page, '21-estoque-movimentacoes')
  const csv = path.join(DATA_DIR, 'movimentos.csv')
  await mockSaveDialog(app, csv)
  await page.getByRole('button', { name: 'Exportar CSV' }).click()
  await expect(page.getByText(/4 movimentação\(ões\) exportada/)).toBeVisible()
  expect(fs.readFileSync(csv, 'utf8')).toContain('Conferência do balcão')

  // ── Inventário com leitura de código (+1 por leitura) ──
  await page.getByRole('tab', { name: 'Inventário' }).click()
  await page.getByRole('button', { name: 'Novo inventário' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Iniciar contagem' }).click()
  await expect(page.getByText(/Inventário iniciado com 3 item/)).toBeVisible()
  const scan = page.getByLabel('Ler código de barras')
  for (let i = 0; i < 3; i++) {
    await scan.fill('7890001')
    await scan.press('Enter')
  }
  await expect(page.getByLabel('Contado Caneta azul')).toHaveValue('3')
  await page.getByLabel('Contado Tênis — 40').fill('2')
  await shot(page, '22-estoque-inventario')
  await page.getByRole('button', { name: 'Aplicar inventário' }).click()
  await expect(page.getByRole('dialog').getByText('1 com diferença')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Aplicar' }).click()
  await expect(page.getByText('Inventário aplicado. As diferenças foram lançadas no estoque.')).toBeVisible()
  await expect(page.getByText('Aplicado', { exact: true })).toBeVisible()

  // ── Posição final e filtro de reposição ──
  await page.getByRole('tab', { name: 'Posição de estoque' }).click()
  await expect(row(page, 'Caneta azul')).toContainText('3')
  await expect(row(page, 'Caneta azul')).toContainText('Baixo')
  await page.getByLabel('Situação do estoque').selectOption({ label: 'Esgotados' })
  await expect(page.getByText('— 41')).toBeVisible()
  await expect(row(page, 'Caneta azul')).toHaveCount(0)
  await shot(page, '23-estoque-posicao')

  await app.close()
})

test.afterAll(() => {
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {
    // diretório temporário
  }
})
