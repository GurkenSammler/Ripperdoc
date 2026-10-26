// UI-Sounds über WebAudio. Die WAV-Dateien liefert der Main-Prozess (sounds/default, ersetzt durch sounds/game,
// sounds/custom und %APPDATA%\RIPPERDOC\sounds).
export type Sfx = 'hover' | 'move' | 'tab' | 'press' | 'enter' | 'menu_open' | 'menu_close' | 'open' | 'boot' | 'error'

let ctx: AudioContext | null = null
let gain: GainNode | null = null
const buffers = new Map<string, AudioBuffer>()
let enabled = true
let lastHover = 0

export async function loadSfx(files: Record<string, Uint8Array>): Promise<void> {
  ctx = new AudioContext()
  gain = ctx.createGain()
  gain.connect(ctx.destination)
  for (const [name, data] of Object.entries(files)) {
    try {
      const copy = data.slice().buffer
      buffers.set(name, await ctx.decodeAudioData(copy))
    } catch {
      // kaputte Datei: einfach stumm
    }
  }
}

export function configureSfx(on: boolean, volume: number): void {
  enabled = on
  if (gain) gain.gain.value = Math.max(0, Math.min(1, volume))
}

export function play(name: Sfx): void {
  if (!enabled || !ctx || !gain) return
  if (name === 'hover') {
    const now = performance.now()
    if (now - lastHover < 45) return
    lastHover = now
  }
  // Fehlt "error" (die Original-Sounds haben keinen), klingt "menu_close"
  const buf = buffers.get(name) ?? (name === 'error' ? buffers.get('menu_close') : undefined)
  if (!buf) return
  if (ctx.state === 'suspended') void ctx.resume()
  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(gain)
  src.start()
}
