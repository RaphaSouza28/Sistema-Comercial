import fs from 'node:fs'
import path from 'node:path'

/** Logger simples em arquivo (userData/logs/main.log), com rotação por tamanho. */

type Level = 'info' | 'warn' | 'error'

const MAX_BYTES = 5 * 1024 * 1024
let logFile: string | null = null

export function initLogger(logsDir: string): void {
  fs.mkdirSync(logsDir, { recursive: true })
  logFile = path.join(logsDir, 'main.log')
  try {
    if (fs.existsSync(logFile) && fs.statSync(logFile).size > MAX_BYTES) {
      fs.renameSync(logFile, path.join(logsDir, 'main.old.log'))
    }
  } catch {
    // rotação é melhor-esforço
  }
}

function write(level: Level, message: string, extra?: unknown): void {
  const detail =
    extra instanceof Error ? ` ${extra.stack ?? extra.message}` : extra !== undefined ? ` ${safeJson(extra)}` : ''
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}${detail}`
  if (level === 'error') console.error(line)
  else console.log(line)
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line + '\n')
    } catch {
      // não interrompe a aplicação por falha de log
    }
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

export const logger = {
  info: (message: string, extra?: unknown) => write('info', message, extra),
  warn: (message: string, extra?: unknown) => write('warn', message, extra),
  error: (message: string, extra?: unknown) => write('error', message, extra)
}
