/// <reference lib="dom" />
/// <reference path="../../src/types/global.d.ts" />
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { completeSetup, launch, mockSaveDialog, shot, tempDataDir } from './helpers'

const DATA_DIR = tempDataDir('sc-e2e-commerce-')

test('Fase 6: cliente com LGPD, orçamento com texto livre, pedido, venda no PDV, serviço e catálogo', async () => {
  const { app, page } = await launch(DATA_DIR)
  await completeSetup(page)
  const seeded = await page.evaluate(async () => {
    const r = await window.api.products.create({ name: 'Caneca personalizada', costCents: 1000, salePriceCents: 2500, initialStockMilli: 10000 })
    return r.ok
  })
  expect(seeded).toBe(true)
  const nav = page.getByRole('navigation')

  // ── Serviço: sem estoque nem variações ──
  await nav.getByRole('link', { name: /Produtos/ }).click()
  await page.getByRole('button', { name: 'Novo produto' }).click()
  await page.getByLabel('Nome do produto').fill('Instalação')
  await page.getByLabel(/^Preço de venda \(varejo\)/).fill('80')
  await page.getByLabel('É um serviço (sem controle de estoque)').check()
  await expect(page.getByLabel('Estoque inicial')).toHaveCount(0)
  await expect(page.getByLabel('Este produto possui variações')).toHaveCount(0)
  await page.getByRole('button', { name: 'Cadastrar produto' }).click()
  await expect(page.getByText('Código 000002', { exact: true })).toBeVisible()

  // ── Cliente com consentimento; busca sem acentos ──
  await nav.getByRole('link', { name: /Clientes/ }).click()
  await page.getByRole('button', { name: 'Novo cliente' }).click()
  let dialog = page.getByRole('dialog', { name: 'Novo cliente' })
  await dialog.getByLabel('Nome completo ou razão social').fill('José da Silva')
  await dialog.getByLabel('CPF ou CNPJ').fill('111.111.111-11')
  await dialog.getByLabel('Telefone').fill('(11) 98765-4321')
  await dialog.getByLabel(/autorizou o uso dos dados/).check()
  await dialog.getByRole('button', { name: 'Salvar' }).click()
  await expect(dialog.getByText('CPF/CNPJ inválido')).toBeVisible()
  await dialog.getByLabel('CPF ou CNPJ').fill('529.982.247-25')
  await dialog.getByRole('button', { name: 'Salvar' }).click()
  dialog = page.getByRole('dialog', { name: 'José da Silva' })
  await expect(dialog.getByText(/Autorizado em/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Fechar' }).click()
  await page.getByLabel('Buscar clientes').fill('jose silva')
  await expect(page.getByRole('cell', { name: /José da Silva/ })).toBeVisible()

  // ── Orçamento com produto + item de texto livre ──
  await nav.getByRole('link', { name: /Orçamentos/ }).click()
  await page.getByRole('button', { name: 'Novo orçamento' }).click()
  dialog = page.getByRole('dialog', { name: 'Novo orçamento' })
  await dialog.getByRole('button', { name: 'Selecionar cliente' }).click()
  const picker = page.getByRole('dialog', { name: 'Identificar cliente' })
  await picker.getByLabel('Buscar por nome, CPF/CNPJ ou telefone').fill('jose')
  await picker.getByRole('button', { name: /José da Silva/ }).click()
  await expect(dialog.getByText('José da Silva')).toBeVisible()
  await dialog.getByLabel('Adicionar produto ao documento').fill('caneca')
  await dialog.getByRole('option', { name: /Caneca personalizada/ }).click()
  await dialog.getByLabel('Quantidade Caneca personalizada').fill('2')
  await dialog.getByRole('button', { name: 'Adicionar item de texto livre' }).click()
  await dialog.getByLabel('Descrição do item 2').fill('Arte exclusiva')
  await dialog.getByLabel('Preço Arte exclusiva').fill('15')
  await expect(dialog.getByLabel('Total do documento')).toHaveText('R$ 65,00')
  await shot(page, '50-orcamento-editor')
  await dialog.getByRole('button', { name: 'Salvar' }).click()
  dialog = page.getByRole('dialog', { name: 'Orçamento #1' })
  await expect(dialog.getByText('Rascunho')).toBeVisible()
  await expect(dialog.getByText(/itens de texto livre/)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Vender no PDV' })).toHaveCount(0)

  // PDF do orçamento
  const quotePdf = path.join(DATA_DIR, 'orcamento.pdf')
  await mockSaveDialog(app, quotePdf)
  await dialog.getByRole('button', { name: 'Salvar PDF' }).click()
  await expect(page.getByText(/PDF salvo em/)).toBeVisible()
  expect(fs.readFileSync(quotePdf).subarray(0, 4).toString()).toBe('%PDF')

  // Troca o texto livre pelo serviço cadastrado, aprova e gera o pedido
  await dialog.getByRole('button', { name: 'Editar' }).click()
  dialog = page.getByRole('dialog', { name: 'Editar orçamento #1' })
  await dialog.getByRole('button', { name: 'Remover Arte exclusiva' }).click()
  await dialog.getByLabel('Adicionar produto ao documento').fill('instala')
  await dialog.getByRole('option', { name: /Instalação/ }).click()
  await dialog.getByLabel('Desconto geral').fill('5')
  await expect(dialog.getByLabel('Total do documento')).toHaveText('R$ 125,00')
  await dialog.getByRole('button', { name: 'Salvar' }).click()
  dialog = page.getByRole('dialog', { name: 'Orçamento #1' })
  await dialog.getByRole('button', { name: 'Aprovado' }).click()
  await expect(dialog.getByText('Aprovado', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Gerar pedido' }).click()
  await page.getByRole('dialog', { name: 'Gerar pedido do orçamento #1' }).getByRole('button', { name: 'Gerar pedido' }).click()
  await expect(page.getByText('Pedido #1 gerado a partir do orçamento.')).toBeVisible()
  await expect(dialog.getByText('#1', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Fechar' }).click()

  // ── Pedido: confirma e envia ao PDV ──
  await nav.getByRole('link', { name: /Pedidos/ }).click()
  await page.getByRole('button', { name: 'Abrir pedido 1' }).click()
  dialog = page.getByRole('dialog', { name: 'Pedido #1' })
  await expect(dialog.getByText('Pendente')).toBeVisible()
  await dialog.getByRole('button', { name: 'Marcar como confirmado' }).click()
  await expect(dialog.getByText('Confirmado', { exact: true })).toBeVisible()
  await shot(page, '51-pedido')
  await dialog.getByRole('button', { name: 'Vender no PDV' }).click()

  // Caixa precisa estar aberto; depois a venda do pedido fica bloqueada para edição
  await expect(page.getByRole('heading', { name: 'Caixa fechado' })).toBeVisible()
  await page.getByLabel('Valor inicial em dinheiro').fill('0')
  await page.getByRole('button', { name: 'Abrir caixa' }).click()
  await expect(page.getByText(/Venda do pedido #1/)).toBeVisible()
  await expect(page.getByLabel('Total da venda')).toHaveText('R$ 125,00')
  await expect(page.getByText('José da Silva')).toBeVisible()
  await shot(page, '52-pdv-pedido')
  await page.keyboard.press('F8')
  dialog = page.getByRole('dialog', { name: 'Pagamento' })
  await dialog.getByRole('radio', { name: 'PIX' }).click()
  await dialog.getByRole('button', { name: 'Adicionar pagamento' }).click()
  await dialog.getByRole('button', { name: 'Finalizar venda (F9)' }).click()
  await expect(page.getByRole('dialog', { name: 'Venda #1 concluída' })).toBeVisible()
  await page.getByRole('button', { name: 'Nova venda' }).click()
  await expect(page.getByText('Carrinho vazio')).toBeVisible()

  // Estoque: só a caneca sai (serviço não movimenta estoque)
  const stock = await page.evaluate(async () => {
    const r = await window.api.products.list({ page: 1, pageSize: 50 })
    return r.ok ? r.data.items.map((p) => [p.name, p.stockMilli]) : null
  })
  expect(stock).toEqual(expect.arrayContaining([['Caneca personalizada', 8000]]))

  // Pedido vinculado à venda; histórico do cliente
  await nav.getByRole('link', { name: /Pedidos/ }).click()
  await expect(page.getByText('Venda #1')).toBeVisible()
  await nav.getByRole('link', { name: /Clientes/ }).click()
  await page.getByRole('button', { name: 'Abrir' }).first().click()
  dialog = page.getByRole('dialog', { name: 'José da Silva' })
  await expect(dialog.getByText('R$ 125,00').first()).toBeVisible()
  await dialog.getByRole('tab', { name: /Pedidos/ }).click()
  await expect(dialog.getByRole('cell', { name: '#1' })).toBeVisible()

  // LGPD: exportação dos dados
  const exported = path.join(DATA_DIR, 'cliente.json')
  await mockSaveDialog(app, exported)
  await dialog.getByRole('button', { name: 'Exportar dados (LGPD)' }).click()
  await expect(page.getByText(/Dados exportados para/)).toBeVisible()
  expect(JSON.parse(fs.readFileSync(exported, 'utf8')).cliente.name).toBe('José da Silva')
  await dialog.getByRole('button', { name: 'Fechar' }).click()

  // ── Catálogo com PDF ──
  await nav.getByRole('link', { name: /Catálogo/ }).click()
  await expect(page.getByText('Caneca personalizada')).toBeVisible()
  await expect(page.getByText('Instalação')).toBeVisible()
  await shot(page, '53-catalogo')
  const catalogPdf = path.join(DATA_DIR, 'catalogo.pdf')
  await mockSaveDialog(app, catalogPdf)
  await page.getByRole('button', { name: 'Salvar PDF' }).click()
  await expect(page.getByText(/PDF salvo em/)).toBeVisible()
  expect(fs.readFileSync(catalogPdf).subarray(0, 4).toString()).toBe('%PDF')

  await app.close()
})
