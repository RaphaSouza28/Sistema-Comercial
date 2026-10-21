import { app, BrowserWindow, dialog, Menu } from 'electron'
import type { Db } from '../database/connection'
import { initializeDatabase } from '../database'
import { createServices } from '../services'
import { createFiscalFileStore } from './fiscalFiles'
import { createSecretStore } from './secrets'
import { startBackupScheduler } from './backupScheduler'
import path from 'node:path'
import { initLogger, logger } from '../utils/logger'
import { registerIpcHandlers } from './ipc/handlers'
import { handleMediaProtocol, registerMediaScheme } from './media'
import { appPaths, configureDataDirectory } from './paths'
import { applyGlobalSecurity, createSenderValidator, createUrlGuard, rendererOrigin } from './security'

configureDataDirectory()
registerMediaScheme()

// Uma única instância: evita duas janelas operando o mesmo caixa/banco.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  start()
}

function start(): void {
  const paths = appPaths()
  initLogger(paths.logsDir)
  const isAppUrl = createUrlGuard(paths.rendererHtml)
  applyGlobalSecurity(isAppUrl)

  let mainWindow: BrowserWindow | null = null
  let db: Db | null = null

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  function createWindow(): void {
    mainWindow = new BrowserWindow({
      width: 1366,
      height: 800,
      minWidth: 1024,
      minHeight: 640,
      show: false,
      title: 'Sistema Comercial',
      icon: paths.icon,
      backgroundColor: '#0f172a',
      autoHideMenuBar: true,
      webPreferences: {
        preload: paths.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        devTools: !app.isPackaged
      }
    })

    mainWindow.once('ready-to-show', () => {
      mainWindow?.maximize()
      mainWindow?.show()
    })
    mainWindow.webContents.on('did-finish-load', () => logger.info('Interface carregada'))
    mainWindow.webContents.on('did-fail-load', (_e, code, description, url) => logger.error('Falha ao carregar a interface', { code, description, url }))
    mainWindow.webContents.on('render-process-gone', (_e, details) => logger.error('Processo da interface encerrado', details))
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    const { devUrl } = rendererOrigin(paths.rendererHtml)
    if (devUrl) void mainWindow.loadURL(devUrl)
    else void mainWindow.loadFile(paths.rendererHtml)
  }

  app.whenReady().then(async () => {
    if (app.isPackaged) Menu.setApplicationMenu(null)
    logger.info(`Iniciando ${app.getName()} ${app.getVersion()}`, { userData: paths.userData })

    try {
      db = await initializeDatabase({
        databasePath: paths.databasePath,
        migrationsDir: paths.migrationsDir,
        backupsDir: paths.backupsDir
      })
    } catch (error) {
      logger.error('Falha ao inicializar o banco de dados', error)
      dialog.showErrorBox(
        'Não foi possível abrir o banco de dados',
        `${(error as Error).message}\n\nNenhum dado foi apagado. Detalhes em:\n${paths.logsDir}`
      )
      app.exit(1)
      return
    }

    handleMediaProtocol(paths.userData)
    const services = createServices(db, {
      fiscalFiles: createFiscalFileStore(paths.userData),
      backup: {
        paths: { databasePath: paths.databasePath, defaultDir: paths.backupsDir, tempDir: path.join(paths.userData, 'tmp'), migrationsDir: paths.migrationsDir },
        secrets: createSecretStore(paths.userData)
      }
    })
    registerIpcHandlers({
      services,
      isTrustedSender: createSenderValidator(isAppUrl),
      paths: { userData: paths.userData, databasePath: paths.databasePath }
    })
    createWindow()
    startBackupScheduler(services.backup!)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  let shuttingDown = false
  app.on('before-quit', (event) => {
    if (!db || shuttingDown) return
    shuttingDown = true
    event.preventDefault()
    db.$disconnect()
      .catch((error) => logger.error('Erro ao fechar o banco', error))
      .finally(() => {
        db = null
        logger.info('Aplicativo encerrado')
        app.quit()
      })
  })

  process.on('uncaughtException', (error) => logger.error('Exceção não tratada', error))
  process.on('unhandledRejection', (reason) => logger.error('Promise rejeitada sem tratamento', reason))
}
