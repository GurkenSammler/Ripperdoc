import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(import.meta.dirname, 'src/shared') } },
  test: { globals: true, include: ['tests/**/*.test.ts'], testTimeout: 20000 },
})
