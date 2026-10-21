/// <reference lib="dom" />
/// <reference path="../../src/types/global.d.ts" />
import { expect, test } from '@playwright/test'
import { completeSetup, launch, tempDataDir } from './helpers'

const DATA_DIR = tempDataDir('sc-e2e-security-')

test('bloqueio por inatividade: sem uso pelo tempo configurado, a tela volta ao login', async () => {
  const { app, page } = await launch(DATA_DIR)
  await completeSetup(page)
  expect(await page.evaluate(async () => (await window.api.security.update({ idleMinutes: 15 })).ok)).toBe(true)

  // Relógio simulado: os temporizadores da interface passam a usar o tempo controlado pelo teste
  await page.clock.install()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Olá, Maria' })).toBeVisible()

  // 14 minutos parado: continua logado
  await page.clock.runFor(14 * 60_000)
  await expect(page.getByRole('heading', { name: 'Olá, Maria' })).toBeVisible()
  // Uso do teclado renova o prazo
  await page.keyboard.press('Shift')
  await page.clock.runFor(10 * 60_000)
  await expect(page.getByRole('heading', { name: 'Olá, Maria' })).toBeVisible()
  // Avança de 15 em 15 segundos até passar dos 15 minutos sem uso (o aviso some sozinho depois de alguns segundos)
  await page.clock.runFor(4 * 60_000)
  const entrar = page.getByRole('button', { name: 'Entrar' })
  for (let i = 0; i < 12 && !(await entrar.isVisible()); i++) await page.clock.runFor(15_000)
  await expect(entrar).toBeVisible()
  await expect(page.getByText('Sessão encerrada por inatividade. Entre novamente.')).toBeVisible()
  // O servidor também encerrou a sessão (não basta esconder a tela)
  expect(await page.evaluate(async () => {
    const r = await window.api.auth.session()
    return r.ok ? r.data : 'erro'
  })).toBeNull()
  await app.close()
})
