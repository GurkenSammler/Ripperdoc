// Erzeugt die eigenen Standard-UI-Sounds (sounds/default/sfx_*.wav) rein rechnerisch:
// kurze Sinus-/Rechteck-Töne, Sweeps und etwas Rauschen. Keine fremden Aufnahmen, frei verwendbar.
// Port des Synths aus NC-OS (scripts/make-sounds.ps1). Eigene Sounds gehören nach sounds/custom/
// und ersetzen beim Start der App einzelne Dateien.
//   node scripts/make-sounds.mjs        (überschreibt sounds/default)
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'sounds', 'default')
const RATE = 44100

// Fester Zufall (mulberry32), damit jeder Lauf dieselben Dateien erzeugt
let seed = 2077
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const env = (t, len, attack, decay) =>
  t < attack ? t / attack : Math.exp(-(t - attack) / decay) * Math.max(0, 1 - (t / len) ** 3)

// Weiche Rechteckwelle (wenige Obertöne), klingt "digital" ohne zu kratzen
const sq = (p) => Math.sin(p) + Math.sin(3 * p) / 3 + Math.sin(5 * p) / 5

const buf = (seconds) => new Float64Array(Math.floor(seconds * RATE))

function tone(b, start, len, f0, f1, amp, square, decay) {
  let phase = 0
  const s0 = Math.floor(start * RATE)
  const n = Math.floor(len * RATE)
  for (let i = 0; i < n && s0 + i < b.length; i++) {
    const t = i / RATE
    const f = f0 * Math.pow(f1 / f0, t / len)
    phase += (2 * Math.PI * f) / RATE
    const v = square ? sq(phase) * 0.6 : Math.sin(phase)
    b[s0 + i] += v * amp * env(t, len, 0.002, decay)
  }
}

function noise(b, start, len, amp, decay, smooth) {
  const s0 = Math.floor(start * RATE)
  const n = Math.floor(len * RATE)
  let lp = 0
  for (let i = 0; i < n && s0 + i < b.length; i++) {
    const t = i / RATE
    lp += (rnd() * 2 - 1 - lp) * smooth
    b[s0 + i] += lp * amp * env(t, len, 0.003, decay)
  }
}

function echo(b, delay, gain) {
  const d = Math.floor(delay * RATE)
  for (let i = b.length - 1; i >= d; i--) b[i] += b[i - d] * gain
}

// Bitcrush: grobe Stufen, typischer "Terminal"-Klang
function crush(b, steps) {
  for (let i = 0; i < b.length; i++) b[i] = Math.round(b[i] * steps) / steps
}

const SOUNDS = {
  hover: () => {
    const b = buf(0.06)
    tone(b, 0, 0.05, 2600, 2400, 0.35, false, 0.012)
    return b
  },
  move: () => {
    const b = buf(0.08)
    tone(b, 0, 0.07, 1900, 1500, 0.4, true, 0.018)
    return b
  },
  tab: () => {
    const b = buf(0.14)
    tone(b, 0, 0.05, 1500, 1500, 0.35, true, 0.015)
    tone(b, 0.055, 0.06, 2250, 2250, 0.35, true, 0.018)
    return b
  },
  press: () => {
    const b = buf(0.16)
    noise(b, 0, 0.012, 0.5, 0.004, 0.6)
    tone(b, 0.004, 0.12, 900, 1500, 0.45, true, 0.04)
    return b
  },
  enter: () => {
    const b = buf(0.42)
    tone(b, 0, 0.26, 600, 1900, 0.4, true, 0.12)
    tone(b, 0.2, 0.12, 2400, 2400, 0.25, false, 0.04)
    echo(b, 0.07, 0.3)
    return b
  },
  menu_open: () => {
    const b = buf(0.3)
    tone(b, 0, 0.1, 880, 880, 0.4, true, 0.05)
    tone(b, 0.09, 0.16, 1320, 1320, 0.4, true, 0.07)
    crush(b, 24)
    echo(b, 0.06, 0.25)
    return b
  },
  menu_close: () => {
    const b = buf(0.3)
    tone(b, 0, 0.1, 1320, 1320, 0.4, true, 0.05)
    tone(b, 0.09, 0.16, 660, 620, 0.4, true, 0.07)
    crush(b, 24)
    echo(b, 0.06, 0.25)
    return b
  },
  open: () => {
    const b = buf(0.75)
    noise(b, 0, 0.5, 0.25, 0.25, 0.08)
    tone(b, 0, 0.5, 180, 1200, 0.35, true, 0.3)
    tone(b, 0.48, 0.18, 1800, 1800, 0.3, false, 0.06)
    echo(b, 0.09, 0.3)
    return b
  },
  boot: () => {
    const b = buf(1.8)
    tone(b, 0, 1.6, 70, 140, 0.25, true, 1.2)
    for (let k = 0; k < 26; k++) {
      const t = 0.05 + k * 0.045
      const f = 400 + Math.floor(rnd() * 16) * 110
      tone(b, t, 0.035, f, f, 0.22, true, 0.012)
    }
    noise(b, 0, 1.2, 0.12, 0.5, 0.3)
    tone(b, 1.22, 0.5, 660, 660, 0.25, false, 0.25)
    tone(b, 1.22, 0.5, 990, 990, 0.2, false, 0.25)
    tone(b, 1.22, 0.5, 1320, 1320, 0.15, false, 0.25)
    crush(b, 40)
    echo(b, 0.11, 0.3)
    return b
  },
  // Neu für RIPPERDOC: Fehler / Warnung (zwei fallende Rechtecktöne)
  error: () => {
    const b = buf(0.36)
    tone(b, 0, 0.12, 520, 480, 0.45, true, 0.06)
    tone(b, 0.14, 0.18, 380, 300, 0.45, true, 0.08)
    crush(b, 20)
    return b
  },
}

function normalize(b) {
  let peak = 0
  for (const v of b) peak = Math.max(peak, Math.abs(v))
  const g = peak > 0 ? 0.7 / peak : 1
  const fade = Math.min(b.length, Math.floor(RATE / 200))
  for (let i = 0; i < b.length; i++) {
    b[i] *= g
    if (i >= b.length - fade) b[i] *= (b.length - i) / fade
  }
  return b
}

function wav(b) {
  const bytes = b.length * 2
  const out = Buffer.alloc(44 + bytes)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(36 + bytes, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(RATE, 24)
  out.writeUInt32LE(RATE * 2, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(bytes, 40)
  for (let i = 0; i < b.length; i++) out.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(b[i] * 32767))), 44 + i * 2)
  return out
}

mkdirSync(OUT, { recursive: true })
for (const [name, make] of Object.entries(SOUNDS)) {
  const file = path.join(OUT, `sfx_${name}.wav`)
  const data = wav(normalize(make()))
  writeFileSync(file, data)
  console.log(`sfx_${name}.wav`.padEnd(20), `${data.length.toLocaleString('de-DE').padStart(8)} Bytes`)
}
