import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { systemTar } from '../src/main/install/extract'

const run = promisify(execFile)

export async function tmpDir(tag: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `rdoc-${tag}-`))
}

/** Legt Dateien an: { "a/b.txt": "inhalt" }. */
export async function writeTree(root: string, files: Record<string, string>): Promise<void> {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, ...rel.split('/'))
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content)
  }
}

/** Baut ein zip mit Windows-tar aus einem Dateibaum. */
export async function makeZip(dir: string, name: string, files: Record<string, string>): Promise<string> {
  const src = path.join(dir, `src-${name}`)
  await writeTree(src, files)
  const tops = [...new Set(Object.keys(files).map((f) => f.split('/')[0]))]
  const zip = path.join(dir, name)
  await run(systemTar(), ['-a', '-cf', zip, '-C', src, ...tops], { windowsHide: true })
  return zip
}

export const peekFrom =
  (contents: Record<string, string>) =>
  async (rel: string): Promise<string | null> =>
    contents[rel] ?? null

export async function ino(p: string): Promise<string> {
  return (await fs.stat(p, { bigint: true })).ino.toString()
}

export async function exists(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}
