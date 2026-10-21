/// <reference lib="dom" />
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'

export const ROOT = path.resolve(__dirname, '../..')
export const SCREENSHOTS = path.join(ROOT, 'test-results', 'screens')
/** "Senha" com ou sem o asterisco de campo obrigatório. */
export const PASSWORD_LABEL = /^Senha\s*\*?$/

export function tempDataDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

export async function launch(dataDir: string, extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = process.env.E2E_EXECUTABLE
  const env = { ...process.env, SISTEMA_COMERCIAL_DATA_DIR: dataDir, ...extraEnv } as Record<string, string>
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch(
    executablePath ? { executablePath, args: [], env } : { args: [path.join(ROOT, 'out/main/index.js')], env, cwd: ROOT }
  )
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

export async function shot(page: Page, name: string) {
  await page.waitForTimeout(400) // aguarda animações de entrada
  fs.mkdirSync(SCREENSHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`) })
}

export async function login(page: Page, username: string, password: string) {
  await page.getByLabel('Usuário').fill(username)
  await page.getByLabel(PASSWORD_LABEL).fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

/** Conclui o assistente de primeiro acesso com dados válidos. */
export async function completeSetup(page: Page, name = 'Maria Souza', username = 'maria', password = 'SenhaSegura1') {
  await expect(page.getByRole('heading', { name: 'Vamos configurar o sistema' })).toBeVisible()
  await page.getByLabel('Razão social ou nome').fill('Loja Exemplo LTDA')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByLabel('Nome completo').fill(name)
  await page.getByLabel('Usuário para login').fill(username)
  await page.getByLabel(PASSWORD_LABEL).fill(password)
  await page.getByLabel('Confirmar senha').fill(password)
  await page.getByRole('button', { name: 'Continuar' }).click()
  await page.getByRole('button', { name: 'Concluir e acessar' }).click()
  await expect(page.getByRole('heading', { name: `Olá, ${name.split(' ')[0]}` })).toBeVisible()
}

/** Substitui os diálogos nativos de arquivo no processo principal (testes automatizados). */
export async function mockOpenDialog(app: ElectronApplication, filePath: string) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
  }, filePath)
}

export async function mockSaveDialog(app: ElectronApplication, filePath: string) {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog
  }, filePath)
}
