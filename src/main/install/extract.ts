import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { t } from '@shared/i18n'

const run = promisify(execFile)

export const ARCHIVE_EXT = /\.(zip|7z|rar|tar|tgz|tar\.gz)$/i

/** Windows-eigenes bsdtar (libarchive): kann zip, 7z und rar. Nie das tar aus Git/MSYS nehmen. */
export const systemTar = (): string => path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')

/**
 * Legt den Inhalt von `input` in `dest` ab: Archive werden entpackt, Ordner und einzelne Dateien
 * (z. B. ein loses .archive) kopiert.
 */
export async function unpackInput(input: string, dest: string): Promise<void> {
  await fs.mkdir(dest, { recursive: true })
  const stat = await fs.stat(input)
  if (stat.isDirectory()) {
    await fs.cp(input, path.join(dest, path.basename(input)), { recursive: true })
    return
  }
  if (!ARCHIVE_EXT.test(input)) {
    await fs.copyFile(input, path.join(dest, path.basename(input)))
    return
  }
  try {
    // bsdtar verweigert ../ und absolute Pfade von selbst
    await run(systemTar(), ['-xf', input, '-C', dest], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 })
  } catch (err) {
    const msg = (err as { stderr?: string }).stderr?.trim() || (err as Error).message
    throw new Error(t('main.import.unpackFailed', msg))
  }
}
