/** Normaliza texto para busca: minúsculas, sem acentos, espaços simples. */
export function normalizeSearch(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Junta várias partes em um único texto de busca. */
export function searchTextOf(...parts: (string | null | undefined)[]): string {
  return normalizeSearch(parts.filter(Boolean).join(' '))
}
