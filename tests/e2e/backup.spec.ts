/// <reference lib="dom" />
/// <reference path="../../src/types/global.d.ts" />
import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { completeSetup, launch, login, shot, tempDataDir } from './helpers'

const DATA_DIR = tempDataDir('sc-e2e-backup-')
// Em teste, a restauração encerra o aplicativo em vez de reiniciá-lo (o Playwright reabre)
const ENV = { SISTEMA_COMERCIAL_NO_RELAUNCH: '1' }

test('Fase 9: backup manual e criptografado, operação offline, restauração confirmada e dados restaurados após reiniciar', async () => {
  let { app, page } = await launch(DATA_DIR, ENV)
  await completeSetup(page)
  expect(await page.evaluate(async () => (await window.api.products.create({ name: 'Mouse sem fio', costCents: 3000, salePriceCents: 8990, initialStockMilli: 10000 })).ok)).toBe(true)
  const nav = page.getByRole('navigation')

  // ── Backup manual (sem criptografia) ──
  await nav.getByRole('link', { name: /Configurações/ }).click()
  await page.getByRole('button', { name: 'Fazer backup agora' }).click()
  await expect(page.getByText('Backup concluído e verificado.')).toBeVisible()
  const history = page.getByRole('table', { name: 'Histórico de backups' })
  await expect(history.getByRole('row')).toHaveCount(2)
  await expect(history.getByText('OK', { exact: true })).toBeVisible()
  const plainBackup = fs.readdirSync(path.join(DATA_DIR, 'backups')).find((f) => /^backup-manual-.*\.db$/.test(f))!
  expect(fs.readFileSync(path.join(DATA_DIR, 'backups', plainBackup)).subarray(0, 15).toString()).toBe('SQLite format 3')

  // ── Senha e criptografia ──
  await page.getByRole('button', { name: 'Definir senha do backup' }).click()
  let dialog = page.getByRole('dialog', { name: 'Senha do backup' })
  await dialog.getByLabel('Nova senha do backup').fill('Backup@2026')
  await dialog.getByLabel('Confirmar senha do backup').fill('Backup@2026')
  await dialog.getByRole('button', { name: 'Salvar senha' }).click()
  await expect(page.getByText('Senha do backup definida.')).toBeVisible()
  await page.getByLabel('Criptografar os backups').check()
  await page.getByRole('button', { name: 'Salvar configuração' }).click()
  await expect(page.getByText('Configuração de backup salva.')).toBeVisible()
  await page.getByRole('button', { name: 'Fazer backup agora' }).click()
  await expect(history.getByRole('row')).toHaveCount(3)
  await expect(history.getByLabel('Criptografado')).toBeVisible()
  const encrypted = fs.readdirSync(path.join(DATA_DIR, 'backups')).find((f) => f.endsWith('.scbak'))!
  const raw = fs.readFileSync(path.join(DATA_DIR, 'backups', encrypted))
  expect(raw.subarray(0, 6).toString()).toBe('SCBAK1')
  expect(raw.includes(Buffer.from('Mouse sem fio'))).toBe(false)
  await history.getByRole('button', { name: `Verificar backup ${encrypted}` }).click()
  await expect(page.getByText(/Backup íntegro/)).toBeVisible()
  await shot(page, '80-backup')

  // ── Operação sem internet: venda normalmente ──
  await app.evaluate(({ session }) => session.defaultSession.enableNetworkEmulation({ offline: true }))
  const sold = await page.evaluate(async () => {
    await window.api.cash.open({ requestId: crypto.randomUUID(), openingCents: 0 })
    const items = await window.api.products.list({ page: 1, pageSize: 10 })
    const id = items.ok ? items.data.items[0].id : 0
    const r = await window.api.sales.finalize({ requestId: crypto.randomUUID(), items: [{ productId: id, quantityMilli: 1000 }], payments: [{ method: 'PIX', amountCents: 8990 }] })
    return r.ok
  })
  expect(sold).toBe(true)

  // ── Restauração do primeiro backup (antes da venda) ──
  const plainRow = history.getByRole('row').filter({ hasText: plainBackup })
  await plainRow.getByRole('button', { name: `Restaurar ${plainBackup}` }).click()
  dialog = page.getByRole('dialog', { name: 'Restaurar backup' })
  await expect(dialog.getByText(/1 produtos · 0 clientes · 0 vendas · 1 usuários/)).toBeVisible()
  await dialog.getByLabel('Sua senha').fill('errada')
  await dialog.getByLabel('Digite RESTAURAR para confirmar').fill('restaurar')
  await dialog.getByRole('button', { name: 'Restaurar e reiniciar' }).click()
  await expect(dialog.getByText('Senha incorreta. A restauração não foi feita.')).toBeVisible()
  await shot(page, '81-restauracao')
  await dialog.getByLabel('Sua senha').fill('SenhaSegura1')
  const closed = app.waitForEvent('close')
  await dialog.getByRole('button', { name: 'Restaurar e reiniciar' }).click()
  await closed

  // ── Reabre: banco trocado antes de abrir; venda feita depois do backup não existe mais ──
  ;({ app, page } = await launch(DATA_DIR, ENV))
  await login(page, 'maria', 'SenhaSegura1')
  await expect(page.getByRole('heading', { name: 'Olá, Maria' })).toBeVisible()
  const state = await page.evaluate(async () => {
    const sales = await window.api.sales.list({ page: 1, pageSize: 10 })
    const backups = await window.api.backup.history()
    return { sales: sales.ok ? sales.data.total : -1, kinds: backups.ok ? backups.data.map((b) => b.kind) : [] }
  })
  expect(state.sales).toBe(0)
  expect(state.kinds).toContain('PRE_RESTORE')
  expect(fs.readdirSync(path.join(DATA_DIR, 'backups')).some((f) => /^substituido-.*\.db$/.test(f))).toBe(true)
  await app.close()
})
