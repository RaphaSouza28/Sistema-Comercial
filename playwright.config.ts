import { defineConfig } from '@playwright/test'

/**
 * Testes de ponta a ponta no aplicativo Electron real.
 *  - npm run test:e2e                -> usa o build em out/ (rode `npm run build` antes)
 *  - E2E_EXECUTABLE="release\win-unpacked\Sistema Comercial.exe" npm run test:e2e
 *                                    -> testa a versão empacotada
 */
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  workers: 1,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
})
