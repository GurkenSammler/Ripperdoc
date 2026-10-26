import { promises as fs } from 'node:fs'

// Liest ProductVersion und FileVersion aus einer Windows-exe, ohne PowerShell zu starten.
// Weg: DOS-Header -> PE-Header -> Abschnitt ".rsrc" laden -> darin die UTF-16-Schlüssel
// "ProductVersion"/"FileVersion" der StringFileInfo suchen und den Wert dahinter lesen.

export interface PeVersion {
  product: string
  file: string
}

export async function readPeVersion(exe: string): Promise<PeVersion> {
  const fh = await fs.open(exe, 'r')
  try {
    const head = Buffer.alloc(4096)
    await fh.read(head, 0, head.length, 0)
    if (head.toString('ascii', 0, 2) !== 'MZ') throw new Error('keine exe (MZ fehlt)')
    const pe = head.readUInt32LE(0x3c)
    if (head.toString('binary', pe, pe + 4) !== 'PE\0\0') throw new Error('keine exe (PE fehlt)')
    const sections = head.readUInt16LE(pe + 6)
    const optSize = head.readUInt16LE(pe + 20)
    let table = pe + 24 + optSize
    for (let s = 0; s < sections; s++, table += 40) {
      const name = head.toString('ascii', table, table + 8).replace(/\0+$/, '')
      if (name !== '.rsrc') continue
      const rawSize = head.readUInt32LE(table + 16)
      const rawPtr = head.readUInt32LE(table + 20)
      const rsrc = Buffer.alloc(rawSize)
      await fh.read(rsrc, 0, rawSize, rawPtr)
      return { product: findString(rsrc, 'ProductVersion'), file: findString(rsrc, 'FileVersion') }
    }
    throw new Error('kein .rsrc-Abschnitt')
  } finally {
    await fh.close()
  }
}

function findString(buf: Buffer, key: string): string {
  const needle = Buffer.from(`${key}\0`, 'utf16le')
  let at = buf.indexOf(needle)
  while (at >= 0) {
    // Der Wert beginnt am nächsten 4-Byte-Rand; dazwischen liegen nur Null-Wörter.
    let p = at + needle.length
    while (p % 4 !== 0) p++
    while (p + 1 < buf.length && buf.readUInt16LE(p) === 0) p += 2
    let end = p
    while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2
    const text = buf.toString('utf16le', p, end).trim()
    if (/^[\d.]+/.test(text)) return text
    at = buf.indexOf(needle, at + 2)
  }
  return ''
}
