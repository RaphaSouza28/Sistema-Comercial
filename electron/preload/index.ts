import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type AppApi } from '@shared/api'

/**
 * Expõe ao renderer apenas a API do sistema (window.api), sem acesso ao Node,
 * ao ipcRenderer ou a canais arbitrários. Cada função encaminha para um canal fixo.
 */
function buildApi(): AppApi {
  const api: Record<string, Record<string, (input?: unknown) => Promise<unknown>>> = {}
  for (const [namespace, methods] of Object.entries(IPC_CHANNELS)) {
    api[namespace] = {}
    for (const [method, channel] of Object.entries(methods as Record<string, string>)) {
      api[namespace][method] = (input?: unknown) => ipcRenderer.invoke(channel, input)
    }
  }
  return api as unknown as AppApi
}

contextBridge.exposeInMainWorld('api', buildApi())
