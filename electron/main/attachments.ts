import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { validationError } from '../utils/errors'

/**
 * Comprovantes anexados às contas a pagar: cópia do arquivo em userData/anexos/contas-a-pagar.
 * Só aceita PDF e imagens; o banco guarda apenas o nome gerado pelo sistema.
 */

const ALLOWED = ['pdf', 'jpg', 'jpeg', 'png']
const FILE_PATTERN = /^[0-9a-f-]{36}\.(pdf|jpg|jpeg|png)$/
const MAX_BYTES = 10 * 1024 * 1024

export const ATTACHMENT_EXTENSIONS = ALLOWED

export function attachmentsDir(userData: string): string {
  return path.join(userData, 'anexos', 'contas-a-pagar')
}

export function importAttachment(userData: string, sourcePath: string): { fileName: string; originalName: string } {
  const ext = path.extname(sourcePath).slice(1).toLowerCase()
  if (!ALLOWED.includes(ext)) throw validationError('Anexe um arquivo PDF, JPG ou PNG.')
  const stat = fs.statSync(sourcePath)
  if (stat.size > MAX_BYTES) throw validationError('O comprovante deve ter no máximo 10 MB.')
  const dir = attachmentsDir(userData)
  fs.mkdirSync(dir, { recursive: true })
  const fileName = `${randomUUID()}.${ext}`
  fs.copyFileSync(sourcePath, path.join(dir, fileName))
  return { fileName, originalName: path.basename(sourcePath).slice(0, 200) }
}

/** Caminho completo de um anexo existente (nomes fora do padrão são recusados). */
export function attachmentPath(userData: string, fileName: string): string {
  if (!FILE_PATTERN.test(fileName)) throw validationError('Anexo inválido.')
  const full = path.join(attachmentsDir(userData), fileName)
  if (!fs.existsSync(full)) throw validationError('O arquivo do comprovante não foi encontrado.')
  return full
}

export function deleteAttachment(userData: string, fileName: string | null): void {
  if (!fileName || !FILE_PATTERN.test(fileName)) return
  fs.rmSync(path.join(attachmentsDir(userData), fileName), { force: true })
}
