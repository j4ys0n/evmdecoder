export function removeEmptyValues<R extends { [k: string]: any }, I extends { [P in keyof R]: any | null | undefined }>(
  obj: I
): R {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null)) as R
}

export function prefixKeys<T extends { [k: string]: any }>(obj: T, prefix?: string | null, removeEmpty?: boolean): T {
  if (prefix == null || prefix === '') {
    return removeEmpty ? removeEmptyValues(obj) : obj
  }
  const entries = Object.entries(obj)
  return Object.fromEntries(
    (removeEmpty ? entries.filter(([, v]) => v != null) : entries).map(([k, v]) => [prefix + k, v])
  ) as T
}

/**
 * Recursively (deeply) merges 2 object of the same type. It only merges plain object, not arrays.
 * It does not mutate the original object but may return references to (parts of the) original object.
 */
export function deepMerge<T extends { [k: string]: any }>(a: T, b: T): T {
  return Object.fromEntries([
    ...Object.entries(a).map(([k, v]) => {
      if (typeof v === 'object' && !Array.isArray(v)) {
        return [k, b[k] == null ? v : deepMerge(v, b[k] ?? {})]
      }
      return [k, b[k] ?? v]
    }),
    ...Object.entries(b).filter(([k]) => !(k in a))
  ])
}

export function isEmpty(obj: object): boolean {
  return obj == null || Object.values(obj).filter(v => v != null).length === 0
}

export function chunkArray<T>(data: T[], chunkSize: number): T[][] {
  const chunkCount = Math.ceil(data.length / chunkSize)
  const chunks: any[][] = []
  for (let i = 0; i < chunkCount; i++) {
    const chunk = data.splice(0, chunkSize)
    chunks.push(chunk)
  }
  return chunks
}
