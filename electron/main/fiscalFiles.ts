import fs from 'node:fs'
import path from 'node:path'
import type { FiscalFileStore } from '../services/fiscal/fiscal.service'

/** XML autorizado e DANFE devolvidos pelo provedor fiscal: userData/fiscal (o contribuinte deve guardá-los por 5 anos). */
export function fiscalDir(userData: string): string {
  return path.join(userData, 'fiscal')
}

export function createFiscalFileStore(userData: string): FiscalFileStore {
  return {
    write(name, data) {
      const dir = fiscalDir(userData)
      fs.mkdirSync(dir, { recursive: true })
      const safe = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_')
      fs.writeFileSync(path.join(dir, safe), data)
      return safe
    }
  }
}
