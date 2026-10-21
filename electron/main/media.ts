import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { nativeImage, net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { MEDIA_SCHEME } from '../services/product.mappers'
import { validationError } from '../utils/errors'

/**
 * Imagens de produtos ficam em userData/media/products e são servidas pelo protocolo
 * interno sc-media://products/<arquivo>. Somente nomes gerados pelo sistema são aceitos.
 */

const FILE_PATTERN = /^[0-9a-f-]{36}\.jpg$/
const MAX_SOURCE_BYTES = 15 * 1024 * 1024
const MAX_SIDE = 1024

/** Deve ser chamado antes de app.ready. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true } }])
}

export function productMediaDir(userData: string): string {
  return path.join(userData, 'media', 'products')
}

export function handleMediaProtocol(userData: string): void {
  const dir = productMediaDir(userData)
  protocol.handle(MEDIA_SCHEME, (request) => {
    const url = new URL(request.url)
    const file = decodeURIComponent(url.pathname.replace(/^\//, ''))
    if (url.hostname !== 'products' || !FILE_PATTERN.test(file)) return new Response('Not found', { status: 404 })
    const full = path.join(dir, file)
    if (!fs.existsSync(full)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(full).href)
  })
}

/** Lê a imagem escolhida, reduz para no máximo 1024px e salva como JPEG. Devolve o nome do arquivo. */
export function importProductImage(userData: string, sourcePath: string): string {
  const stat = fs.statSync(sourcePath)
  if (stat.size > MAX_SOURCE_BYTES) throw validationError('A imagem deve ter no máximo 15 MB.')
  let image = nativeImage.createFromPath(sourcePath)
  if (image.isEmpty()) throw validationError('Arquivo de imagem inválido ou formato não suportado (use JPG ou PNG).')
  const { width, height } = image.getSize()
  if (Math.max(width, height) > MAX_SIDE) {
    image = width >= height ? image.resize({ width: MAX_SIDE, quality: 'best' }) : image.resize({ height: MAX_SIDE, quality: 'best' })
  }
  const dir = productMediaDir(userData)
  fs.mkdirSync(dir, { recursive: true })
  const fileName = `${randomUUID()}.jpg`
  fs.writeFileSync(path.join(dir, fileName), image.toJPEG(85))
  return fileName
}

export function deleteProductImage(userData: string, fileName: string | null): void {
  if (!fileName || !FILE_PATTERN.test(fileName)) return
  fs.rmSync(path.join(productMediaDir(userData), fileName), { force: true })
}
