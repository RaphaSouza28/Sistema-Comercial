import path from 'node:path'
import { app } from 'electron'

export const APP_NAME = 'Sistema Comercial'

/**
 * Diretórios persistentes. Tudo fica em userData (%APPDATA%\Sistema Comercial),
 * nunca na pasta de instalação — os dados sobrevivem a atualizações e desinstalação.
 *
 * O caminho é fixado explicitamente para não depender de como o executável foi
 * iniciado. SISTEMA_COMERCIAL_DATA_DIR permite apontar outro diretório (testes E2E).
 */
export function configureDataDirectory(): void {
  app.setName(APP_NAME)
  const override = process.env.SISTEMA_COMERCIAL_DATA_DIR
  app.setPath('userData', override ? path.resolve(override) : path.join(app.getPath('appData'), APP_NAME))
}

/** Raiz do projeto em desenvolvimento (out/main -> raiz). */
const devRoot = () => path.resolve(__dirname, '../..')

export function appPaths() {
  const userData = app.getPath('userData')
  return {
    userData,
    databasePath: path.join(userData, 'data', 'sistema-comercial.db'),
    backupsDir: path.join(userData, 'backups'),
    logsDir: path.join(userData, 'logs'),
    migrationsDir: app.isPackaged
      ? path.join(process.resourcesPath, 'migrations')
      : path.join(devRoot(), 'prisma', 'migrations'),
    preload: path.join(__dirname, '../preload/index.js'),
    rendererHtml: path.join(__dirname, '../renderer/index.html'),
    icon: app.isPackaged ? path.join(process.resourcesPath, 'icon.png') : path.join(devRoot(), 'build', 'icon.png')
  }
}
