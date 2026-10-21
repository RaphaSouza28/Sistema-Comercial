/// <reference lib="dom" />
/// <reference path="../../src/types/global.d.ts" />
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { completeSetup, launch, login, mockOpenDialog, mockSaveDialog, ROOT, shot, tempDataDir } from './helpers'

const DATA_DIR = tempDataDir('sc-e2e-prod-')

test.describe.configure({ mode: 'serial' })

test('Fase 2: categorias, fornecedor, produto com precificação, variações, imagem, importação e exportação', async () => {
  const { app, page } = await launch(DATA_DIR)
  await completeSetup(page)
  const nav = page.getByRole('navigation')

  // ── Categorias ──
  await nav.getByRole('link', { name: /Produtos/ }).click()
  await expect(page.getByRole('heading', { name: 'Produtos', exact: true })).toBeVisible()
  await expect(page.getByText('Nenhum produto cadastrado')).toBeVisible()
  await page.getByRole('tab', { name: 'Categorias' }).click()
  for (const [name, parent] of [['Vestuário', null], ['Camisetas', 'Vestuário']] as const) {
    await page.getByRole('button', { name: 'Nova categoria' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Nome').fill(name)
    if (parent) await dialog.getByLabel('Pertence a').selectOption({ label: parent })
    else await dialog.getByLabel('Margem padrão').fill('35')
    await dialog.getByRole('button', { name: 'Salvar' }).click()
    await expect(page.getByRole('cell', { name, exact: true })).toBeVisible()
  }

  // ── Fornecedor ──
  await nav.getByRole('link', { name: /Fornecedores/ }).click()
  await page.getByRole('button', { name: 'Novo fornecedor' }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Razão social ou nome').fill('Têxtil São José')
  await dialog.getByLabel('CNPJ ou CPF').fill('11.222.333/0001-81')
  await dialog.getByLabel('Telefone').fill('(11) 98765-4321')
  await dialog.getByRole('button', { name: 'Salvar' }).click()
  await expect(page.getByRole('cell', { name: '11.222.333/0001-81' })).toBeVisible()
  await expect(page.getByText('(11) 98765-4321')).toBeVisible()

  // ── Produto completo com a calculadora (exemplo da camiseta) ──
  await nav.getByRole('link', { name: /Produtos/ }).click()
  await page.getByRole('button', { name: 'Novo produto' }).click()
  await page.getByLabel('Nome do produto').fill('Camiseta básica')
  await page.getByLabel('Código de barras').fill('7891234567895')
  await page.getByLabel('Categoria', { exact: true }).selectOption({ label: 'Vestuário' })
  await page.getByLabel('Subcategoria').selectOption({ label: 'Camisetas' })
  await page.getByLabel('Fornecedor').selectOption({ label: 'Têxtil São José' })
  await page.getByLabel('Custo de aquisição').fill('40')
  await page.getByLabel('Frete', { exact: true }).fill('5')
  await page.getByLabel('Embalagem').fill('2')
  await page.getByLabel('Margem desejada').fill('30')
  const calc = page.getByLabel('Calculadora de preço')
  await expect(calc.getByText('R$ 47,00', { exact: true })).toBeVisible()
  await expect(calc.getByText('R$ 67,14', { exact: true })).toBeVisible()
  await calc.getByRole('button', { name: 'Usar preço sugerido' }).click()
  await expect(page.getByLabel(/^Preço de venda \(varejo\)/)).toHaveValue('67,14')
  await expect(calc.getByText('30,0%', { exact: true })).toBeVisible() // margem bruta
  await page.getByLabel('Estoque inicial').fill('10')
  await page.getByLabel('Estoque mínimo').fill('3')
  await shot(page, '10-produto-calculadora')
  await page.getByRole('button', { name: 'Cadastrar produto' }).click()
  await expect(page.getByText('Código 000001', { exact: true })).toBeVisible()
  await expect(page.getByText('Estoque atual', { exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Preço de venda' })).toBeVisible() // histórico de preços

  // ── Imagem (protocolo interno + CSP) ──
  await mockOpenDialog(app, path.join(ROOT, 'build', 'icon.png'))
  await page.getByRole('button', { name: 'Escolher imagem' }).click()
  const img = page.getByAltText('Imagem do produto')
  await expect(img).toBeVisible()
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

  // ── Alteração de preço com motivo → histórico ──
  await page.getByLabel(/^Preço de venda \(varejo\)/).fill('69,90')
  await page.getByLabel('Motivo da alteração de preço').fill('Reajuste')
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByRole('cell', { name: 'Reajuste' })).toBeVisible()

  // ── Produto com variações ──
  await page.getByRole('button', { name: 'Produtos', exact: true }).click()
  await page.getByRole('button', { name: 'Novo produto' }).click()
  await page.getByLabel('Nome do produto').fill('Tênis Corrida')
  await page.getByLabel(/^Preço de venda \(varejo\)/).fill('299,90')
  await page.getByLabel('Este produto possui variações').check()
  await page.getByLabel('Valores (separados por vírgula)').fill('Preto, Branco')
  await page.getByRole('button', { name: 'Gerar combinações' }).click()
  await expect(page.getByRole('cell', { name: 'Preto', exact: true })).toBeVisible()
  await expect(page.getByRole('cell', { name: 'Branco', exact: true })).toBeVisible()
  await page.getByLabel('SKU Preto').fill('TN-PRETO')
  await page.getByLabel('Estoque inicial Preto').fill('2')
  await page.getByLabel('Estoque inicial Branco').fill('3')
  await page.getByRole('button', { name: 'Cadastrar produto' }).click()
  await expect(page.getByText('Código 000002', { exact: true })).toBeVisible()
  await expect(page.getByText('5 UN').first()).toBeVisible()

  // ── Cadastro rápido ──
  await page.getByRole('button', { name: 'Produtos', exact: true }).click()
  await page.getByRole('button', { name: 'Cadastro rápido' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nome do produto').fill('Caneca')
  await dialog.getByLabel('Custo').fill('10')
  await dialog.getByLabel(/^Preço de venda/).fill('25')
  await expect(dialog.getByText('Margem bruta: 60,0%')).toBeVisible()
  await dialog.getByLabel('Quantidade inicial em estoque').fill('5')
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Caneca', exact: true })).toBeVisible()

  // ── Importação CSV (ANSI, como o Excel salva) ──
  const csv = path.join(DATA_DIR, 'importar.csv')
  const content = 'nome;categoria;custo;preco_venda;estoque_inicial\r\nCaderno 10 matérias;Papelaria;12,50;24,90;15\r\nSem preço inválido;Papelaria;abc;1,00;\r\n'
  fs.writeFileSync(csv, Buffer.from(content, 'latin1'))
  await mockOpenDialog(app, csv)
  await page.getByRole('button', { name: 'Importar' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: /Selecionar planilha/ }).click()
  await expect(dialog.getByText('1 novos')).toBeVisible()
  await expect(dialog.getByText('1 com erro')).toBeVisible()
  await expect(dialog.getByText('Caderno 10 matérias')).toBeVisible() // acentuação ANSI preservada
  await shot(page, '11-importacao-previa')
  await dialog.getByRole('button', { name: 'Importar 1 produto(s)' }).click()
  await expect(dialog.getByText('1 criado(s) · 0 atualizado(s) · 1 ignorado(s)')).toBeVisible()
  await dialog.getByRole('button', { name: 'Concluir' }).click()

  // ── Lista, busca e filtros ──
  await expect(page.getByRole('button', { name: 'Caderno 10 matérias', exact: true })).toBeVisible()
  await page.getByLabel('Buscar produtos').fill('camiseta basica')
  await expect(page.getByRole('button', { name: 'Camiseta básica', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Caneca', exact: true })).toHaveCount(0)
  await expect(page.getByText('R$ 69,90')).toBeVisible()
  await page.getByLabel('Buscar produtos').fill('')
  await shot(page, '12-lista-produtos')

  // ── Exportação ──
  const exported = path.join(DATA_DIR, 'exportado.csv')
  await mockSaveDialog(app, exported)
  await page.getByRole('button', { name: 'Exportar' }).click()
  await expect(page.getByText(/4 produto\(s\) exportado\(s\)/)).toBeVisible()
  const text = fs.readFileSync(exported, 'utf8')
  expect(text).toContain('Camiseta básica')
  expect(text).toContain('69,90')

  // ── Precificação por categoria (prévia, nada muda sem confirmar) ──
  await page.getByRole('tab', { name: 'Precificação por categoria' }).click()
  await page.getByLabel('Categoria').selectOption({ label: 'Vestuário' })
  await expect(page.getByLabel('Margem desejada')).toHaveValue('35')
  await page.getByRole('button', { name: 'Calcular prévia' }).click()
  await expect(page.getByRole('cell', { name: 'R$ 72,31' })).toBeVisible() // 47,00 / 0,65
  await shot(page, '13-precificacao-categoria')
  await page.getByRole('button', { name: 'Aplicar preços sugeridos' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Aplicar' }).click()
  await expect(page.getByText(/1 preço\(s\) atualizado\(s\)/)).toBeVisible()

  await app.close()
})

test('operador consulta produtos sem custos e sem botões de edição', async () => {
  const { app, page } = await launch(DATA_DIR)
  await login(page, 'maria', 'SenhaSegura1')
  await expect(page.getByRole('heading', { name: 'Olá, Maria' })).toBeVisible()
  // cria operador via API (já coberto pela tela de Usuários na Fase 1)
  const created = await page.evaluate(async () => {
    const roles = await window.api.roles.list()
    if (!roles.ok) return roles
    const op = roles.data.find((r) => r.key === 'OPERATOR')!
    return window.api.users.create({ name: 'Ana Caixa', username: 'ana', roleId: op.id, password: 'Operador123', passwordConfirm: 'Operador123', mustChangePassword: false })
  })
  expect(created.ok).toBe(true)
  await page.getByRole('button', { name: /Maria Souza/ }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await login(page, 'ana', 'Operador123')

  await page.getByRole('navigation').getByRole('link', { name: /Produtos/ }).click()
  await expect(page.getByRole('button', { name: 'Camiseta básica', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Novo produto' })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: /Custo/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Camiseta básica', exact: true }).click()
  await expect(page.getByLabel('Custo de aquisição')).toHaveCount(0)
  await expect(page.getByLabel('Calculadora de preço')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Salvar alterações' })).toHaveCount(0)
  // e o backend recusa mesmo chamando a API diretamente
  const attempt = await page.evaluate(() => window.api.products.quickCreate({ name: 'Hack', salePriceCents: 1 }))
  expect(attempt).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  await shot(page, '14-operador-produto')
  await app.close()
})

test.afterAll(() => {
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {
    // diretório temporário
  }
})
