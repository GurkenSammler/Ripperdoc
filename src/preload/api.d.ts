import type { RipperdocApi } from '../shared/api'

declare global {
  interface Window {
    rd: RipperdocApi
  }
}

export {}
