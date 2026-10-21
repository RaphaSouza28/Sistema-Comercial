/// <reference lib="dom" />
/// <reference path="../../src/types/global.d.ts" />
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { completeSetup, launch, login, mockSaveDialog, shot, tempDataDir } from './helpers'

const DATA_DIR = tempDataDir('sc-e2e-pdv-')
const ADMIN = { username: 'maria', password: 'SenhaSegura1' }

test('Fase 4: operador vende com leitor, desconto autorizado, troco, PDF, devolução com vale-troca e cancelamento', async () => {
  const { app, page } = await launch(DATA_DIR)
  await completeSetup(page)
  const seeded = await page.evaluate(async () => {
    const roles = await window.api.roles.list()
    const op = roles.ok ? roles.data.find((r) => r.key === 'OPERATOR')! : null
    const results = await Promise.all([
      window.api.products.create({ name: 'Caneta azul', barcode: '7891', costCents: 100, salePriceCents: 250, initialStockMilli: 10000 }),
      window.api.products.create({ name: 'Caderno universitário', costCents: 800, salePriceCents: 2000, promoPriceCents: 1500, initialStockMilli: 20000 }),
      window.api.users.create({ name: 'João Caixa', username: 'joao', roleId: op!.id, password: 'Operador123', passwordConfirm: 'Operador123', mustChangePassword: false })
    ])
    return results.map((r) => r.ok)
  })
  expect(seeded).toEqual([true, true, true])
  await page.getByRole('button', { name: /Maria Souza/ }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()

  // ── Operador entra direto no PDV e abre o caixa ──
  await login(page, 'joao', 'Operador123')
  await expect(page.getByRole('heading', { name: 'Caixa fechado' })).toBeVisible()
  await page.getByLabel('Valor inicial em dinheiro').fill('50')
  await page.getByRole('button', { name: 'Abrir caixa' }).click()
  await expect(page.getByText('Dinheiro na gaveta:')).toBeVisible()

  // ── Leitor: "3*código" + Enter; busca por nome ──
  const search = page.getByLabel('Buscar produto no PDV')
  await search.fill('3*7891')
  await search.press('Enter')
  await expect(page.getByLabel('Quantidade Caneta azul')).toHaveValue('3')
  await expect(page.getByLabel('Total da venda')).toHaveText('R$ 7,50')
  await search.fill('cader')
  await page.getByRole('option', { name: /Caderno universitário/ }).click()
  await expect(page.getByText('Promoção')).toBeVisible()
  await expect(page.getByLabel('Total da venda')).toHaveText('R$ 22,50')

  // ── Desconto acima do limite do operador ──
  await page.getByRole('button', { name: 'Desconto', exact: true }).click()
  await page.getByRole('dialog').getByLabel('Desconto em reais').fill('2,50')
  await page.getByRole('dialog').getByRole('button', { name: /^Aplicar/ }).click()
  await expect(page.getByLabel('Total da venda')).toHaveText('R$ 20,00')
  await expect(page.getByText(/Desconto acima do seu limite/)).toBeVisible()
  await shot(page, '30-pdv-carrinho')

  // ── Pagamento em dinheiro com troco + autorização do supervisor ──
  await page.keyboard.press('F8')
  let dialog = page.getByRole('dialog', { name: 'Pagamento' })
  await dialog.getByLabel('Valor em dinheiro').fill('50')
  await dialog.getByRole('button', { name: 'Adicionar pagamento' }).click()
  await expect(dialog.getByLabel('Troco')).toHaveText('R$ 30,00')
  await dialog.getByLabel('Usuário do supervisor').fill(ADMIN.username)
  await dialog.getByLabel('Senha do supervisor').fill('errada')
  await dialog.getByRole('button', { name: 'Finalizar venda (F9)' }).click()
  await expect(dialog.getByText(/Autorização negada/)).toBeVisible()
  await dialog.getByLabel('Senha do supervisor').fill(ADMIN.password)
  await shot(page, '31-pdv-pagamento')
  await dialog.getByRole('button', { name: 'Finalizar venda (F9)' }).click()
  dialog = page.getByRole('dialog', { name: 'Venda #1 concluída' })
  await expect(dialog.getByLabel('Troco a devolver')).toHaveText('R$ 30,00')

  // ── Comprovante não fiscal em PDF ──
  const pdf = path.join(DATA_DIR, 'comprovante.pdf')
  await mockSaveDialog(app, pdf)
  await dialog.getByRole('button', { name: 'Salvar PDF' }).click()
  await expect(page.getByText(/Comprovante salvo em/)).toBeVisible()
  expect(fs.readFileSync(pdf).subarray(0, 4).toString()).toBe('%PDF')
  await dialog.getByRole('button', { name: 'Nova venda' }).click()
  await expect(page.getByText('Carrinho vazio')).toBeVisible()

  // ── Devolução de 1 caneta com vale-troca (autorizada) ──
  await page.getByRole('tab', { name: 'Vendas realizadas' }).click()
  await page.getByRole('button', { name: '#1', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Venda #1' })
  await expect(dialog.getByText('Desconto autorizado por Maria Souza')).toBeVisible()
  await dialog.getByRole('button', { name: 'Devolução / troca' }).click()
  await dialog.getByLabel('Devolver Caneta azul').fill('1')
  await dialog.getByLabel('Reembolso').selectOption('VOUCHER')
  await dialog.getByLabel('Motivo da devolução').fill('Cliente trocou de cor')
  await dialog.getByLabel('Usuário do supervisor').fill(ADMIN.username)
  await dialog.getByLabel('Senha do supervisor').fill(ADMIN.password)
  await dialog.getByRole('button', { name: 'Registrar devolução' }).click()
  const toastText = await page.getByText(/Vale-troca VT[0-9A-F]{6}/).textContent()
  const voucher = toastText!.match(/VT[0-9A-F]{6}/)![0]
  await expect(dialog.getByText(voucher)).toBeVisible()
  await shot(page, '32-pdv-devolucao')
  await dialog.getByRole('button', { name: 'Fechar' }).click()

  // ── Nova venda pagando com vale-troca + dinheiro ──
  await page.getByRole('tab', { name: 'Venda', exact: true }).click()
  await search.fill('7891')
  await search.press('Enter')
  await page.keyboard.press('F8')
  dialog = page.getByRole('dialog', { name: 'Pagamento' })
  await dialog.getByRole('radio', { name: 'Vale-troca' }).click()
  await dialog.getByLabel('Código do vale').fill(voucher)
  await dialog.getByRole('button', { name: 'Saldo' }).click()
  await expect(dialog.getByText(/Saldo disponível: R\$ 2,22/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Adicionar pagamento' }).click()
  await dialog.getByRole('radio', { name: 'Dinheiro' }).click()
  await expect(dialog.getByLabel('Valor em dinheiro')).toHaveValue('0,28')
  await dialog.getByRole('button', { name: 'Adicionar pagamento' }).click()
  await dialog.getByRole('button', { name: 'Finalizar venda (F9)' }).click()
  await expect(page.getByRole('dialog', { name: 'Venda #2 concluída' })).toBeVisible()
  await page.getByRole('button', { name: 'Nova venda' }).click()

  // ── Cancelamento autorizado da venda 2 ──
  await page.getByRole('tab', { name: 'Vendas realizadas' }).click()
  await page.getByRole('button', { name: '#2', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Venda #2' })
  await dialog.getByRole('button', { name: 'Cancelar venda' }).click()
  await dialog.getByLabel('Motivo do cancelamento').fill('Cliente desistiu')
  await dialog.getByLabel('Usuário do supervisor').fill(ADMIN.username)
  await dialog.getByLabel('Senha do supervisor').fill(ADMIN.password)
  await dialog.getByRole('button', { name: 'Confirmar cancelamento' }).click()
  await expect(dialog.getByText(/Cancelada em .* por Maria Souza: Cliente desistiu/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Fechar' }).click()
  await expect(page.getByText('Cancelada', { exact: true })).toBeVisible()
  await shot(page, '33-pdv-vendas')

  // ── Leitor USB: duas leituras em sequência rápida não se perdem ──
  await page.getByRole('tab', { name: 'Venda', exact: true }).click()
  await search.fill('7891')
  await search.press('Enter')
  await search.fill('7891')
  await search.press('Enter')
  await expect(page.getByLabel('Quantidade Caneta azul')).toHaveValue('2')
  await page.getByRole('button', { name: 'Cancelar venda' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Limpar carrinho' }).click()
  await expect(page.getByText('Carrinho vazio')).toBeVisible()

  // ── Estoque final: 10 − 3 (venda) + 1 (devolução) − 1 (venda 2) + 1 (cancelamento) = 8 ──
  const stock = await page.evaluate(() => window.api.stock.search({ query: '7891' }))
  expect(stock.ok && stock.data[0].stockMilli).toBe(8000)
  await app.close()
})

test.afterAll(() => {
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {
    // diretório temporário
  }
})
