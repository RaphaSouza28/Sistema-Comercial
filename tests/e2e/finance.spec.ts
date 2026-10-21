/// <reference lib="dom" />
/// <reference path="../../src/types/global.d.ts" />
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { completeSetup, launch, mockOpenDialog, mockSaveDialog, shot, tempDataDir } from './helpers'

const DATA_DIR = tempDataDir('sc-e2e-finance-')
const key = (offset: number) => {
  const d = new Date(Date.now() + offset * 86400000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('Fase 7: crediário no PDV, contas a receber, contas a pagar com comprovante e relatórios exportados', async () => {
  const { app, page } = await launch(DATA_DIR)
  await completeSetup(page)
  const seeded = await page.evaluate(async () => {
    const results = await Promise.all([
      window.api.products.create({ name: 'Cadeira de escritório', costCents: 20000, salePriceCents: 45000, initialStockMilli: 5000 }),
      window.api.customers.create({ name: 'Bruno Prazo', document: '529.982.247-25', creditLimitCents: 100000 }),
      window.api.suppliers.create({ name: 'Companhia de Energia' })
    ])
    return results.map((r) => r.ok)
  })
  expect(seeded).toEqual([true, true, true])
  const nav = page.getByRole('navigation')

  // ── PDV: venda no crediário em 3 parcelas ──
  await nav.getByRole('link', { name: /PDV/ }).click()
  await page.getByLabel('Valor inicial em dinheiro').fill('100')
  await page.getByRole('button', { name: 'Abrir caixa' }).click()
  const search = page.getByLabel('Buscar produto no PDV')
  await search.fill('cadeira')
  await page.getByRole('option', { name: /Cadeira de escritório/ }).click()
  await page.getByRole('button', { name: 'Identificar cliente' }).click()
  const picker = page.getByRole('dialog', { name: 'Identificar cliente' })
  await picker.getByLabel('Buscar por nome, CPF/CNPJ ou telefone').fill('bruno')
  await picker.getByRole('button', { name: /Bruno Prazo/ }).click()
  await page.keyboard.press('F8')
  let dialog = page.getByRole('dialog', { name: 'Pagamento' })
  await dialog.getByRole('radio', { name: 'Crediário' }).click()
  await expect(dialog.getByText(/disponível R\$ 1\.000,00 de R\$ 1\.000,00/)).toBeVisible()
  await dialog.getByLabel('Parcelas').selectOption('3')
  await dialog.getByRole('button', { name: 'Adicionar pagamento' }).click()
  await expect(dialog.getByText('Crediário · 3x')).toBeVisible()
  await shot(page, '60-pdv-crediario')
  await dialog.getByRole('button', { name: 'Finalizar venda (F9)' }).click()
  await expect(page.getByRole('dialog', { name: 'Venda #1 concluída' })).toBeVisible()
  await page.getByRole('button', { name: 'Nova venda' }).click()

  // ── Contas a receber: 3 parcelas; recebe a 1ª em dinheiro (entra na gaveta) ──
  await nav.getByRole('link', { name: /Contas a receber/ }).click()
  await expect(page.getByText('Venda #1 — parcela 1/3')).toBeVisible()
  await expect(page.getByText('Venda #1 — parcela 3/3')).toBeVisible()
  await page.getByRole('button', { name: 'Receber Venda #1 — parcela 1/3' }).click()
  dialog = page.getByRole('dialog', { name: 'Registrar recebimento' })
  await expect(dialog.getByLabel('Valor recebido')).toHaveValue('150,00')
  await dialog.getByLabel('Juros/multa').fill('5')
  await expect(dialog.getByText('R$ 155,00')).toBeVisible()
  await dialog.getByRole('button', { name: 'Confirmar recebimento' }).click()
  await expect(page.getByText('Recebimento registrado. Conta quitada.')).toBeVisible()
  dialog = page.getByRole('dialog', { name: 'Venda #1 — parcela 1/3' })
  await expect(dialog.getByText('Recebida')).toBeVisible()
  await shot(page, '61-contas-a-receber')
  await dialog.getByRole('button', { name: 'Fechar' }).click()

  // ── Contas a pagar: conta atrasada, recorrente, paga com dinheiro da gaveta, com comprovante ──
  await nav.getByRole('link', { name: /Contas a pagar/ }).click()
  await page.getByRole('button', { name: 'Nova conta' }).click()
  dialog = page.getByRole('dialog', { name: 'Nova conta a pagar' })
  await dialog.getByLabel('Descrição').fill('Conta de luz')
  await dialog.getByLabel('Fornecedor').selectOption({ label: 'Companhia de Energia' })
  await dialog.getByLabel('Categoria').fill('Energia')
  await dialog.getByLabel(/^Valor\s*\*?$/).fill('120')
  await dialog.getByLabel(/^Vencimento\s*\*?$/).fill(key(-3))
  await dialog.getByLabel('Repetir').selectOption('MONTHLY')
  await dialog.getByRole('button', { name: 'Salvar' }).click()
  dialog = page.getByRole('dialog', { name: 'Conta de luz' })
  await expect(dialog.getByText('Atrasada · 3 dias')).toBeVisible()

  const receipt = path.join(DATA_DIR, 'boleto-luz.pdf')
  fs.writeFileSync(receipt, '%PDF-1.4\n%comprovante de teste\n')
  await mockOpenDialog(app, receipt)
  await dialog.getByRole('button', { name: 'Anexar comprovante' }).click()
  await expect(dialog.getByText('Comprovante: boleto-luz.pdf')).toBeVisible()
  expect(fs.readdirSync(path.join(DATA_DIR, 'anexos', 'contas-a-pagar'))).toHaveLength(1)

  await dialog.getByRole('button', { name: 'Pagar', exact: true }).click()
  const pay = page.getByRole('dialog', { name: 'Registrar pagamento' })
  await pay.getByLabel('Forma de pagamento').selectOption('CASH')
  await pay.getByLabel('Retirar o dinheiro da gaveta do caixa aberto').check()
  await pay.getByRole('button', { name: 'Confirmar pagamento' }).click()
  await expect(page.getByText('Pagamento registrado. A próxima conta recorrente foi criada.')).toBeVisible()
  dialog = page.getByRole('dialog', { name: 'Conta de luz' })
  await expect(dialog.getByText(/saiu da gaveta do caixa/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Fechar' }).click()
  // A próxima ocorrência aparece em aberto
  await expect(page.getByRole('button', { name: 'Pagar Conta de luz' })).toBeVisible()
  await shot(page, '62-contas-a-pagar')

  // Gaveta: 100 + 155 recebidos − 120 pagos
  const drawer = await page.evaluate(async () => {
    const r = await window.api.cash.current()
    return r.ok ? r.data!.cashBalanceCents : null
  })
  expect(drawer).toBe(13500)

  // ── Relatórios: vendas do mês, fluxo de caixa e exportações ──
  await nav.getByRole('link', { name: /Relatórios/ }).click()
  await expect(page.getByRole('heading', { name: 'Vendas por dia' })).toBeVisible()
  const table = page.getByRole('table', { name: 'Vendas por dia' })
  await expect(table.getByRole('row').last()).toContainText('R$ 450,00')
  await expect(table.getByRole('row').last()).toContainText('R$ 250,00') // lucro bruto
  await shot(page, '63-relatorio-vendas')

  const xlsx = path.join(DATA_DIR, 'vendas.xlsx')
  await mockSaveDialog(app, xlsx)
  await page.getByRole('button', { name: 'Excel' }).click()
  await expect(page.getByText(/Relatório salvo em/)).toBeVisible()
  expect(fs.readFileSync(xlsx).subarray(0, 2).toString()).toBe('PK')

  await page.getByRole('button', { name: 'Fluxo de caixa' }).click()
  await expect(page.getByRole('heading', { name: 'Fluxo de caixa' })).toBeVisible()
  const flow = page.getByRole('table', { name: 'Fluxo de caixa' })
  // Entradas: 155 (parcela) — o crediário não é entrada na venda; saída: 120
  await expect(flow.getByRole('row').last()).toContainText('R$ 155,00')
  await expect(flow.getByRole('row').last()).toContainText('R$ 120,00')
  const csv = path.join(DATA_DIR, 'fluxo.csv')
  await mockSaveDialog(app, csv)
  await page.getByRole('button', { name: 'CSV' }).click()
  await expect(page.getByText(/Relatório salvo em/).first()).toBeVisible()
  await expect.poll(() => fs.existsSync(csv)).toBe(true)
  expect(fs.readFileSync(csv, 'utf8')).toContain('Contas recebidas (R$)')

  const pdf = path.join(DATA_DIR, 'fluxo.pdf')
  await mockSaveDialog(app, pdf)
  await page.getByRole('button', { name: 'PDF' }).click()
  await expect.poll(() => fs.existsSync(pdf)).toBe(true)
  expect(fs.readFileSync(pdf).subarray(0, 4).toString()).toBe('%PDF')
  await shot(page, '64-relatorio-fluxo')

  await app.close()
})
