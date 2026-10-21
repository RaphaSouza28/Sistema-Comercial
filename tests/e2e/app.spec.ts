/// <reference lib="dom" />
/// <reference path="../../src/types/global.d.ts" />
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'

const ROOT = path.resolve(__dirname, '../..')
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-e2e-'))
const SCREENSHOTS = path.join(ROOT, 'test-results', 'screens')
/** "Senha" com ou sem o asterisco de campo obrigatório (não confunde com "Senha atual" etc.). */
const PASSWORD_LABEL = /^Senha\s*\*?$/

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const executablePath = process.env.E2E_EXECUTABLE
  const env = { ...process.env, SISTEMA_COMERCIAL_DATA_DIR: DATA_DIR } as Record<string, string>
  delete env.ELECTRON_RENDERER_URL
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch(
    executablePath ? { executablePath, args: [], env } : { args: [path.join(ROOT, 'out/main/index.js')], env, cwd: ROOT }
  )
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(400) // aguarda animações de entrada
  fs.mkdirSync(SCREENSHOTS, { recursive: true })
  await page.screenshot({ path: path.join(SCREENSHOTS, `${name}.png`) })
}

async function login(page: Page, username: string, password: string) {
  await page.getByLabel('Usuário').fill(username)
  await page.getByLabel(PASSWORD_LABEL).fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

test.describe.configure({ mode: 'serial' })

test('primeiro acesso: assistente cria empresa e administrador e abre o dashboard', async () => {
  const { app, page } = await launch()

  // Isolamento do renderer: sem Node.js, apenas a API do preload.
  const isolation = await page.evaluate(() => ({
    api: typeof (window as unknown as { api?: unknown }).api,
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process
  }))
  expect(isolation).toEqual({ api: 'object', require: 'undefined', process: 'undefined' })

  await expect(page.getByRole('heading', { name: 'Vamos configurar o sistema' })).toBeVisible()
  await shot(page, '01-assistente-empresa')

  // Validação no cliente: avançar sem razão social
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText('Informe a razão social ou nome da empresa')).toBeVisible()

  await page.getByLabel('Razão social ou nome').fill('Loja Exemplo LTDA')
  await page.getByLabel('Nome fantasia').fill('Loja Exemplo')
  await page.getByLabel('CNPJ ou CPF').fill('11.222.333/0001-81')
  await page.getByLabel('UF').fill('sp')
  await page.getByRole('button', { name: 'Continuar' }).click()

  await page.getByLabel('Nome completo').fill('Maria Souza')
  await page.getByLabel('Usuário para login').fill('maria')
  await page.getByLabel(PASSWORD_LABEL).fill('fraca')
  await page.getByLabel('Confirmar senha').fill('fraca')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText('A senha deve ter ao menos 8 caracteres')).toBeVisible()

  await page.getByLabel(PASSWORD_LABEL).fill('SenhaSegura1')
  await page.getByLabel('Confirmar senha').fill('SenhaSegura1')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await shot(page, '02-assistente-preferencias')
  await page.getByRole('button', { name: 'Concluir e acessar' }).click()

  await expect(page.getByRole('heading', { name: 'Olá, Maria' })).toBeVisible()
  await expect(page.getByText('Faturamento hoje')).toBeVisible()
  await expect(page.getByText('R$ 0,00').first()).toBeVisible()
  await expect(page.getByText('Nada para exibir ainda').first()).toBeVisible()
  await shot(page, '03-dashboard-claro')

  // Menu lateral com os 17 módulos para o administrador
  const nav = page.getByRole('navigation')
  await expect(nav.getByRole('link')).toHaveCount(17)

  // Todos os módulos estão implementados: nenhum aparece como "em desenvolvimento"
  await expect(nav.getByText(/^Fase \d$/)).toHaveCount(0)
  await nav.getByRole('link', { name: /Notas Fiscais/ }).click()
  await expect(page.getByRole('heading', { name: 'Notas Fiscais' })).toBeVisible()
  await expect(page.getByText(/Emissão desativada/)).toBeVisible()

  // Tema escuro
  await page.getByRole('button', { name: 'Usar tema escuro' }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await nav.getByRole('link', { name: /Dashboard/ }).click()
  await expect(page.getByRole('heading', { name: 'Olá, Maria' })).toBeVisible()
  await shot(page, '04-dashboard-escuro')
  await page.getByRole('button', { name: 'Usar tema claro' }).click()

  // Busca rápida (Ctrl+K)
  await page.keyboard.press('Control+k')
  await page.getByLabel('Buscar módulo').fill('configur')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'Configurações' })).toBeVisible()
  await expect(page.getByLabel('Razão social ou nome')).toHaveValue('Loja Exemplo LTDA')
  await expect(page.getByLabel('UF')).toHaveValue('SP')

  await app.close()
})

test('login, cadastro de operador e permissões aplicadas', async () => {
  const { app, page } = await launch()
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()

  await login(page, 'maria', 'senhaErrada1')
  await expect(page.getByText('Usuário ou senha inválidos.')).toBeVisible()
  await shot(page, '05-login-erro')

  await login(page, 'MARIA', 'SenhaSegura1')
  await expect(page.getByRole('heading', { name: 'Olá, Maria' })).toBeVisible()

  // Cadastra um operador de caixa
  await page.getByRole('navigation').getByRole('link', { name: /Usuários/ }).click()
  await page.getByRole('button', { name: 'Novo usuário' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Nome completo').fill('João Caixa')
  await dialog.getByLabel('Usuário para login').fill('joao')
  await dialog.getByLabel('Perfil').selectOption({ label: 'Operador de caixa' })
  await dialog.getByLabel('Senha inicial').fill('Operador123')
  await dialog.getByLabel('Confirmar senha').fill('Operador123')
  await dialog.getByRole('button', { name: 'Cadastrar' }).click()
  await expect(page.getByRole('cell', { name: 'João Caixa' })).toBeVisible()
  await shot(page, '06-usuarios')

  // Sai e entra como operador
  await page.getByRole('button', { name: /Maria Souza/ }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await login(page, 'joao', 'Operador123')

  // Troca de senha obrigatória no primeiro acesso
  const pwd = page.getByRole('dialog', { name: 'Defina uma nova senha' })
  await expect(pwd).toBeVisible()
  await pwd.getByLabel('Senha atual').fill('Operador123')
  await pwd.getByLabel(/^Nova senha\s*\*?$/).fill('MinhaSenha9')
  await pwd.getByLabel('Confirmar nova senha').fill('MinhaSenha9')
  await pwd.getByRole('button', { name: 'Salvar nova senha' }).click()
  await expect(pwd).toBeHidden()

  // Operador não vê Dashboard, Usuários nem Configurações e cai no PDV
  const nav = page.getByRole('navigation')
  await expect(nav.getByRole('link', { name: /PDV/ })).toBeVisible()
  await expect(nav.getByRole('link', { name: /Dashboard/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /Usuários/ })).toHaveCount(0)
  await expect(nav.getByRole('link', { name: /Configurações/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'PDV' })).toBeVisible()

  // Acesso direto por URL também é bloqueado
  await page.evaluate(() => (window.location.hash = '#/usuarios'))
  await expect(page.getByRole('heading', { name: 'Acesso não permitido' })).toBeVisible()

  // E a API recusa no processo principal, mesmo chamada diretamente
  const result = await page.evaluate(() => window.api.users.list())
  expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })
  await shot(page, '07-operador')

  await app.close()
})

test('dados persistem após fechar e reabrir o aplicativo', async () => {
  const { app, page } = await launch()
  await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
  await login(page, 'joao', 'MinhaSenha9')
  await expect(page.getByRole('heading', { name: 'PDV' })).toBeVisible()

  const info = await page.evaluate(() => window.api.app.info())
  expect(info.ok).toBe(true)
  if (info.ok) {
    expect(info.data.databasePath.startsWith(DATA_DIR)).toBe(true)
    expect(fs.existsSync(info.data.databasePath)).toBe(true)
  }
  await app.close()
})

test.afterAll(() => {
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true })
  } catch {
    // diretório temporário
  }
})
