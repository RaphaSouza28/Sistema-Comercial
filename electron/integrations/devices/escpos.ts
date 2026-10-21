import fs from 'node:fs'
import { SERIAL_PATTERN, SHARE_PATTERN } from '@shared/deviceSchemas'
import { validationError } from '../../utils/errors'

/**
 * Adaptadores de dispositivos ESC/POS (impressoras térmicas e gavetas ligadas a elas).
 * Os bytes são enviados "crus" ao Windows: para impressoras compartilhadas, o spooler repassa
 * sem conversão (driver "Generic / Text Only" ou o do fabricante em modo RAW); para portas seriais,
 * a velocidade é a configurada no Gerenciador de Dispositivos.
 */

/** ESC p m t1 t2 — pulso no conector da gaveta (pino 2 → m=0, pino 5 → m=1). */
export function drawerPulse(pin: 2 | 5): Buffer {
  return Buffer.from([0x1b, 0x70, pin === 2 ? 0 : 1, 0x19, 0xfa])
}

export interface RawDevice {
  readonly description: string
  write(bytes: Buffer): Promise<void>
}

/** Escrita direta no caminho do dispositivo (compartilhamento \\pc\nome ou \\.\COMn). */
class PathDevice implements RawDevice {
  constructor(
    private readonly path: string,
    readonly description: string
  ) {}

  write(bytes: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
      // Timeout: uma porta/impressora inexistente pode deixar a escrita pendente
      const timer = setTimeout(() => reject(new Error('O dispositivo não respondeu em 8 segundos.')), 8000)
      fs.writeFile(this.path, bytes, (error) => {
        clearTimeout(timer)
        if (error) reject(error)
        else resolve()
      })
    })
  }
}

export function openRawDevice(mode: 'ESCPOS_SHARE' | 'ESCPOS_SERIAL', target: string): RawDevice {
  if (mode === 'ESCPOS_SHARE') {
    if (!SHARE_PATTERN.test(target)) throw validationError('Caminho de impressora compartilhada inválido (ex.: \\\\localhost\\Termica).')
    return new PathDevice(target, `impressora compartilhada ${target}`)
  }
  const m = SERIAL_PATTERN.exec(target)
  if (!m) throw validationError('Porta serial inválida (ex.: COM3).')
  return new PathDevice(`\\\\.\\COM${m[1]}`, `porta ${target.toUpperCase()}`)
}

/** Mensagem compreensível para falhas comuns de dispositivo. */
export function deviceErrorMessage(error: unknown, description: string): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT' || code === 'EINVAL') return `Dispositivo não encontrado (${description}). Confira o nome do compartilhamento ou a porta.`
  if (code === 'EBUSY' || code === 'EACCES' || code === 'EPERM') return `Acesso negado ou dispositivo em uso (${description}).`
  return `Falha ao comunicar com ${description}: ${error instanceof Error ? error.message : String(error)}`
}
