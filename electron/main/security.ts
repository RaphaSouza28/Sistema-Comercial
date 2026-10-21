import { pathToFileURL } from 'node:url'
import { app, session, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { logger } from '../utils/logger'

/** URL de origem do renderer: servidor do Vite em desenvolvimento, arquivo local em produção. */
export function rendererOrigin(rendererHtml: string): { devUrl: string | null; fileUrl: string } {
  const devUrl = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? process.env.ELECTRON_RENDERER_URL : null
  return { devUrl, fileUrl: pathToFileURL(rendererHtml).href }
}

function normalizeFileUrl(url: string): string {
  const base = url.split('#')[0].split('?')[0]
  try {
    return decodeURIComponent(base).replace(/\\/g, '/').toLowerCase()
  } catch {
    return base.toLowerCase()
  }
}

export function createUrlGuard(rendererHtml: string) {
  const { devUrl, fileUrl } = rendererOrigin(rendererHtml)
  const devOrigin = devUrl ? new URL(devUrl).origin : null
  const expectedFile = normalizeFileUrl(fileUrl)

  return function isAppUrl(url: string): boolean {
    if (!url) return false
    if (devOrigin) {
      try {
        return new URL(url).origin === devOrigin
      } catch {
        return false
      }
    }
    return url.startsWith('file:') && normalizeFileUrl(url) === expectedFile
  }
}

/** Aceita IPC somente do frame principal da janela do aplicativo. */
export function createSenderValidator(isAppUrl: (url: string) => boolean) {
  return (event: IpcMainInvokeEvent): boolean => {
    const frame = event.senderFrame
    if (!frame || frame !== event.sender.mainFrame) return false
    return isAppUrl(frame.url)
  }
}

/** Endurecimento global: navegação, novas janelas, webviews e permissões do navegador. */
export function applyGlobalSecurity(isAppUrl: (url: string) => boolean): void {
  app.on('web-contents-created', (_event, contents: WebContents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isAppUrl(url)) {
        event.preventDefault()
        logger.warn('Navegação bloqueada', { url })
      }
    })
    contents.on('will-redirect', (event, url) => {
      if (!isAppUrl(url)) event.preventDefault()
    })
    contents.on('will-attach-webview', (event) => event.preventDefault())
    contents.setWindowOpenHandler(({ url }) => {
      logger.warn('Abertura de janela bloqueada', { url })
      return { action: 'deny' }
    })
  })

  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
  })
}
