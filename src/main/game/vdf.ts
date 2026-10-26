// Kleiner Leser für Valves Textformat (libraryfolders.vdf, appmanifest_*.acf):
//   "key" "value"   oder   "key" { ... }
export type VdfNode = { [key: string]: string | VdfNode }

export function parseVdf(text: string): VdfNode {
  let i = 0
  const n = text.length

  const skip = (): void => {
    while (i < n) {
      const c = text[i]
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') i++
      else if (c === '/' && text[i + 1] === '/') {
        while (i < n && text[i] !== '\n') i++
      } else break
    }
  }

  const str = (): string => {
    if (text[i] !== '"') {
      // Schlüssel ohne Anführungszeichen (selten)
      const start = i
      while (i < n && !/[\s{}"]/.test(text[i])) i++
      return text.slice(start, i)
    }
    i++
    let out = ''
    while (i < n && text[i] !== '"') {
      if (text[i] === '\\' && i + 1 < n) {
        const next = text[i + 1]
        out += next === 'n' ? '\n' : next === 't' ? '\t' : next
        i += 2
      } else out += text[i++]
    }
    i++
    return out
  }

  const obj = (): VdfNode => {
    const node: VdfNode = {}
    for (;;) {
      skip()
      if (i >= n) return node
      if (text[i] === '}') {
        i++
        return node
      }
      const key = str()
      skip()
      if (text[i] === '{') {
        i++
        node[key] = obj()
      } else node[key] = str()
    }
  }

  return obj()
}

export const child = (node: VdfNode | string | undefined, key: string): VdfNode | undefined => {
  if (!node || typeof node === 'string') return undefined
  const hit = Object.keys(node).find((k) => k.toLowerCase() === key.toLowerCase())
  const v = hit === undefined ? undefined : node[hit]
  return typeof v === 'object' ? v : undefined
}

export const value = (node: VdfNode | undefined, key: string): string | undefined => {
  if (!node) return undefined
  const hit = Object.keys(node).find((k) => k.toLowerCase() === key.toLowerCase())
  const v = hit === undefined ? undefined : node[hit]
  return typeof v === 'string' ? v : undefined
}
