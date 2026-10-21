/// <reference lib="dom" />
/// <reference path="../../src/types/global.d.ts" />
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { completeSetup, launch, mockSaveDialog, shot, tempDataDir } from './helpers'

const DATA_DIR = tempDataDir('sc-e2e-integrations-')

test('Fase 8: dispositivos, leitor, etiquetas, gaveta, nota fiscal preparada sem provedor e conciliação de cartões', async () => {
  const { app, page } = await launch(DATA_DIR)
  await completeSetup(page)
  const seeded = await page.evaluate(async () => (await window.api.products.create({ name: 'Garrafa térmica', barcode: '7891234567895', costCents: 3000, salePriceCents: 7990, initialStockMilli: 10000 })).ok)
  expect(seeded).toBe(true)
  const nav = page.getByRole('navigation')

  // ── Configurações: impressoras, gaveta (porta inexistente) e teste do leitor ──
  await nav.getByRole('link', { name: /Configurações/ }).click()
  await expect(page.getByRole('heading', { name: /Impressoras e dispositivos/ })).toBeVisible()
  await page.getByLabel('Largura da bobina').selectOption('58')
  await page.getByLabel('Conexão').selectOption('ESCPOS_SERIAL')
  await page.getByLabel('Porta').fill('LPT9')
  await page.getByRole('button', { name: 'Salvar', exact: true }).nth(2).click()
  await expect(page.getByText('Informe a porta serial, ex.: COM3')).toBeVisible()
  await page.getByLabel('Porta').fill('COM99')
  await page.getByRole('button', { name: 'Salvar', exact: true }).nth(2).click()
  await expect(page.getByText('Configuração de dispositivos salva.')).toBeVisible()
  await page.getByRole('button', { name: 'Testar abertura da gaveta' }).click()
  await expect(page.getByText(/porta COM99/)).toBeVisible()

  const scanner = page.getByLabel('Teste do leitor')
  await scanner.pressSequentially('7891234567895', { delay: 5 })
  await scanner.press('Enter')
  await expect(page.getByText(/leitura rápida — leitor funcionando/)).toBeVisible()
  await shot(page, '70-dispositivos')

  // ── Etiquetas com código de barras em PDF ──
  await nav.getByRole('link', { name: /Produtos/ }).click()
  await page.getByRole('button', { name: 'Etiquetas' }).click()
  let dialog = page.getByRole('dialog', { name: 'Imprimir etiquetas' })
  await dialog.getByLabel('Adicionar produto às etiquetas').fill('garrafa')
  await dialog.getByRole('option', { name: /Garrafa térmica/ }).click()
  await dialog.getByLabel('Etiquetas de Garrafa térmica').fill('3')
  const labels = path.join(DATA_DIR, 'etiquetas.pdf')
  await mockSaveDialog(app, labels)
  await dialog.getByRole('button', { name: 'Salvar PDF' }).click()
  await expect(page.getByText(/Etiquetas salvas em/)).toBeVisible()
  expect(fs.readFileSync(labels).subarray(0, 4).toString()).toBe('%PDF')
  await dialog.getByRole('button', { name: 'Fechar' }).click()

  // ── PDV: cartão com NSU do comprovante; gaveta configurada mas inacessível não impede a venda ──
  await nav.getByRole('link', { name: /PDV/ }).click()
  await page.getByLabel('Valor inicial em dinheiro').fill('0')
  await page.getByRole('button', { name: 'Abrir caixa' }).click()
  await expect(page.getByRole('button', { name: 'Abrir gaveta' })).toBeVisible()
  const search = page.getByLabel('Buscar produto no PDV')
  await search.fill('7891234567895')
  await search.press('Enter')
  await page.keyboard.press('F8')
  dialog = page.getByRole('dialog', { name: 'Pagamento' })
  await dialog.getByRole('radio', { name: 'Cartão de crédito' }).click()
  await dialog.getByLabel('NSU (opcional)').fill('004512')
  await dialog.getByLabel('Autorização (opcional)').fill('a1b2c3')
  await dialog.getByLabel('Bandeira').selectOption('ELO')
  await dialog.getByRole('button', { name: 'Adicionar pagamento' }).click()
  await dialog.getByRole('button', { name: 'Finalizar venda (F9)' }).click()
  await expect(page.getByRole('dialog', { name: 'Venda #1 concluída' })).toBeVisible()
  await page.getByRole('button', { name: 'Nova venda' }).click()
  // Venda em dinheiro: a gaveta é acionada, falha (COM99 não existe) e a venda continua registrada
  await search.fill('7891234567895')
  await search.press('Enter')
  await page.keyboard.press('F8')
  dialog = page.getByRole('dialog', { name: 'Pagamento' })
  await dialog.getByRole('button', { name: 'Adicionar pagamento' }).click()
  await dialog.getByRole('button', { name: 'Finalizar venda (F9)' }).click()
  await expect(page.getByRole('dialog', { name: 'Venda #2 concluída' })).toBeVisible()
  await expect(page.getByText(/Venda registrada, mas a gaveta não abriu/)).toBeVisible()
  await page.getByRole('button', { name: 'Nova venda' }).click()

  // ── Notas fiscais: pendências de cadastro; nota preparada não é transmitida ──
  await nav.getByRole('link', { name: /Notas Fiscais/ }).click()
  await expect(page.getByText(/Emissão desativada/)).toBeVisible()
  await page.getByRole('tab', { name: 'Pendências de cadastro' }).click()
  await expect(page.getByText(/Garrafa térmica/)).toBeVisible()
  await expect(page.getByText('falta NCM, CFOP, origem, CST/CSOSN')).toBeVisible()
  await page.getByRole('tab', { name: 'Documentos' }).click()
  await page.getByLabel('Nº da venda').fill('1')
  await page.getByRole('button', { name: 'Preparar nota da venda' }).click()
  dialog = page.getByRole('dialog', { name: /NFC-e \(consumidor\) — venda #1/ })
  await expect(dialog.getByText('Pendências que impedem a emissão')).toBeVisible()
  await expect(dialog.getByText(/tPag 03/)).toBeVisible()
  await shot(page, '71-nota-preparada')
  await dialog.getByRole('button', { name: 'Transmitir' }).click()
  await expect(page.getByText(/Corrija as pendências antes de transmitir/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Descartar' }).click()
  await expect(dialog.getByText('Descartada', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Fechar' }).click()

  // ── TEF: conciliação com NSU e autorização ──
  await nav.getByRole('link', { name: /^TEF/ }).click()
  await expect(page.getByText('004512 / A1B2C3')).toBeVisible()
  await page.getByLabel('Selecionar pagamento da venda 1').check()
  await page.getByRole('button', { name: /Marcar como conferido/ }).click()
  await expect(page.getByText('1 pagamento(s) conferido(s).')).toBeVisible()
  await expect(page.getByText('Nenhum pagamento no filtro')).toBeVisible()
  await page.getByLabel('Conferência').selectOption('reconciled')
  await expect(page.getByText('Conferido', { exact: true })).toBeVisible()
  await shot(page, '72-conciliacao')
  await page.getByRole('tab', { name: 'Integração TEF' }).click()
  await expect(page.getByText(/nunca simula aprovações/)).toBeVisible()

  // Auditoria das tentativas de abrir a gaveta
  const audits = await page.evaluate(async () => {
    const r = await window.api.devices.settings()
    return r.ok ? r.data.cashDrawer.target : null
  })
  expect(audits).toBe('COM99')
  await app.close()
})
