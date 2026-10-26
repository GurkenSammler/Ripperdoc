import { promises as fs } from 'node:fs'
import path from 'node:path'
import { t } from '@shared/i18n'

// Der Nexus-Key liegt nur verschlüsselt auf der Platte (Electron safeStorage = Windows DPAPI,
// gebunden an diesen Windows-Benutzer). Ohne Verschlüsselung wird nichts gespeichert, kein Klartext-Fallback.

export interface Crypto {
  available(): boolean
  encrypt(text: string): Buffer
  decrypt(data: Buffer): string
}

export class KeyStore {
  private cached: string | null = null

  constructor(
    private readonly file: string,
    private readonly crypto: Crypto,
  ) {}

  get key(): string | null {
    return this.cached
  }

  async load(): Promise<string | null> {
    try {
      const data = await fs.readFile(this.file)
      this.cached = this.crypto.decrypt(data)
    } catch {
      this.cached = null
    }
    return this.cached
  }

  async save(key: string): Promise<void> {
    if (!this.crypto.available()) throw new Error(t('main.nexus.noEncryption'))
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await fs.writeFile(this.file, this.crypto.encrypt(key))
    this.cached = key
  }

  async clear(): Promise<void> {
    this.cached = null
    await fs.rm(this.file, { force: true })
  }
}
