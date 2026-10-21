/// <reference lib="dom" />
/// <reference path="../../src/types/global.d.ts" />
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { completeSetup, launch, login, mockSaveDialog, shot, tempDataDir } from './helpers'

const DATA_DIR = tempDataDir('sc-e2e-cash-')

test('Fase 5: abertura, suprimento, sangria, fechamento com contagem e diferença, histórico e relatório do dia', async () => {
  const { app, page } = await launch(DATA_DIR)
  await completeSetup(page)
  const seeded = await page.evaluate(async () => {
    const roles = await window.api.roles.list()
    const op = roles.ok ? roles.data.find((r) => r.key === 'OPERATOR')! : null
    const p = await window.api.products.create({ name: 'Caderno', barcode: '555', salePriceCents: 2000, initialStockMilli: 10000 })
    const u = await window.api.users.create({ name: 'Ana Caixa', username: 'ana', roleId: op!.id, password: 'Operador123', passwordConfirm: 'Operador123', mustChangePassword: false })
    return [p.ok, u.ok]
  })
  expect(seeded).toEqual([true, true])
  await page.getByRole('button', { name: /Maria Souza/ }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()

  // ── Operadora abre o caixa pelo módulo Caixa ──
  await login(page, 'ana', 'Operador123')
  await page.getByRole('navigation').getByRole('link', { name: /Caixa/ }).click()
  await page.getByLabel('Valor inicial em dinheiro').fill('100')
  await page.getByRole('button', { name: 'Abrir caixa' }).click()
  await expect(page.getByText('Dinheiro na gaveta').first()).toBeVisible()

  // Uma venda de R$ 20,00 em dinheiro (troco de R$ 30,00)
  const sale = await page.evaluate(async () => {
    const item = await window.api.sales.searchItems({ query: '555' })
    if (!item.ok) return item
    return window.api.sales.finalize({
      requestId: crypto.randomUUID(),
      items: [{ productId: item.data[0].productId, quantityMilli: 1000 }],
      payments: [{ method: 'CASH', amountCents: 5000 }]
    })
  })
  expect(sale.ok).toBe(true)
  await page.reload()
  await page.getByRole('navigation').getByRole('link', { name: /Caixa/ }).click()
  await expect(page.getByRole('region', { name: 'Resumo do caixa' }).getByText('R$ 120,00')).toBeVisible()

  // ── Suprimento e sangria (com trava de saldo) ──
  await page.getByRole('button', { name: 'Suprimento', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Valor').fill('50')
  await dialog.getByRole('button', { name: 'Registrar' }).click()
  await expect(page.getByText('Suprimento de R$ 50,00 registrado.')).toBeVisible()
  await page.getByRole('button', { name: 'Sangria', exact: true }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Valor').fill('200')
  await dialog.getByRole('button', { name: 'Registrar' }).click()
  await expect(dialog.getByText('Valor maior que o dinheiro na gaveta (R$ 170,00).')).toBeVisible()
  await dialog.getByLabel('Valor').fill('70')
  await dialog.getByRole('button', { name: 'Registrar' }).click()
  await expect(page.getByText('Sangria de R$ 70,00 registrado.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Resumo do caixa' }).getByText('R$ 100,00').first()).toBeVisible()
  await shot(page, '40-caixa-aberto')

  // ── Fechamento: contador de cédulas (50 + 2×20 + 5 = 95) → falta R$ 5,00 ──
  await page.getByRole('button', { name: 'Fechar caixa' }).click()
  dialog = page.getByRole('dialog', { name: 'Fechar caixa #1' })
  await dialog.getByRole('button', { name: 'Contar cédulas e moedas' }).click()
  await dialog.getByLabel('Quantidade de R$ 50,00').fill('1')
  await dialog.getByLabel('Quantidade de R$ 20,00').fill('2')
  await dialog.getByLabel('Quantidade de R$ 5,00').fill('1')
  await expect(dialog.getByLabel('Diferença de caixa')).toHaveText('-R$ 5,00')
  await expect(dialog.getByRole('button', { name: 'Confirmar fechamento' })).toBeDisabled()
  await dialog.getByLabel(/^Justificativa da diferença/).fill('Troco dado a mais')
  await shot(page, '41-caixa-fechamento')
  await dialog.getByRole('button', { name: 'Confirmar fechamento' }).click()
  dialog = page.getByRole('dialog', { name: 'Caixa #1 fechado' })
  await expect(dialog.getByText('Troco dado a mais')).toBeVisible()
  const pdf = path.join(DATA_DIR, 'caixa.pdf')
  await mockSaveDialog(app, pdf)
  await dialog.getByRole('button', { name: 'Salvar PDF' }).click()
  await expect(page.getByText(/Relatório salvo em/)).toBeVisible()
  expect(fs.readFileSync(pdf).subarray(0, 4).toString()).toBe('%PDF')
  await dialog.getByRole('button', { name: 'Fechar', exact: true }).click()

  // ── Com o caixa fechado, o PDV pede abertura ──
  await page.getByRole('navigation').getByRole('link', { name: /PDV/ }).click()
  await expect(page.getByRole('heading', { name: 'Caixa fechado' })).toBeVisible()

  // ── Administradora: histórico e relatório do dia ──
  await page.getByRole('button', { name: /Ana Caixa/ }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await login(page, 'maria', 'SenhaSegura1')
  await page.getByRole('navigation').getByRole('link', { name: /Caixa/ }).click()
  await page.getByRole('tab', { name: 'Histórico de caixas' }).click()
  await expect(page.getByRole('cell', { name: 'Ana Caixa' })).toBeVisible()
  await expect(page.getByText('Falta R$ 5,00')).toBeVisible()
  await page.getByRole('tab', { name: 'Relatório do dia' }).click()
  const totals = page.getByRole('region', { name: 'Totais do dia' })
  await expect(totals.getByText('R$ 20,00')).toBeVisible() // vendas
  await expect(totals.getByText('R$ 50,00')).toBeVisible() // suprimentos
  await expect(totals.getByText('R$ 70,00')).toBeVisible() // sangrias
  await expect(totals.getByText('-R$ 5,00')).toBeVisible() // diferenças
  await shot(page, '42-caixa-relatorio-dia')
  await app.close()
})

test.afterAll(() => {
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {
    // diretório temporário
  }
})
