import { execFile, spawn } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { GAME_EXE_REL, GAME_PROCESS, STEAM_APP_ID } from '@shared/brand'
import { t } from '@shared/i18n'
import type { GameRunState, LaunchMode } from '@shared/types'

const run = promisify(execFile)

/** PID des laufenden Spiels oder null (tasklist gibt es auf jedem Windows). */
export async function gamePid(): Promise<number | null> {
  try {
    const { stdout } = await run('tasklist.exe', ['/FI', `IMAGENAME eq ${GAME_PROCESS}`, '/FO', 'CSV', '/NH'], { windowsHide: true })
    const line = stdout.split(/\r?\n/).find((l) => l.toLowerCase().startsWith(`"${GAME_PROCESS.toLowerCase()}"`))
    if (!line) return null
    const pid = Number(line.split('","')[1])
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

export interface LaunchOptions {
  gameRoot: string
  mode: LaunchMode
  args: string[]
  openUrl: (url: string) => Promise<void>
}

export async function launchGame(o: LaunchOptions): Promise<void> {
  if (o.mode === 'steam') {
    // Mit Argumenten fragt Steam jedes Mal nach; deshalb über Steam ohne Argumente
    await o.openUrl(`steam://rungameid/${STEAM_APP_ID}`)
    return
  }
  const exe = path.join(o.gameRoot, ...GAME_EXE_REL.split('/'))
  const fail = (err: Error) => new Error(t('main.game.launchFailed', err.message))
  let child: ReturnType<typeof spawn>
  try {
    child = spawn(exe, o.args, { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false })
  } catch (err) {
    // Kaputte oder blockierte exe (z. B. Virenscanner): Windows wirft sofort statt über 'error'
    throw fail(err as Error)
  }
  // Ohne 'error'-Listener wird eine fehlende exe zur unbehandelten Ausnahme im Main-Prozess
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve())
    child.once('error', (err) => reject(fail(err)))
  })
  child.unref()
}

/** Beobachtet den Spielprozess und meldet Wechsel (startet → läuft → beendet). */
export class GameWatcher {
  state: GameRunState = { phase: 'idle', since: Date.now() }
  private timer: NodeJS.Timeout | null = null
  private startedAt = 0

  constructor(private readonly onChange: (s: GameRunState) => void) {}

  private set(s: GameRunState): void {
    this.state = s
    this.onChange(s)
  }

  /** Nach dem Start: bis 3 min auf den Prozess warten, dann alle 3 s prüfen. */
  expect(): void {
    this.startedAt = Date.now()
    this.set({ phase: 'starting', since: Date.now() })
    this.poll(3000)
  }

  /** Beim App-Start einmal nachsehen, ob das Spiel schon läuft. */
  async check(): Promise<void> {
    const pid = await gamePid()
    if (pid) {
      this.set({ phase: 'running', since: Date.now(), pid })
      this.poll(3000)
    }
  }

  private poll(ms: number): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = setInterval(async () => {
      const pid = await gamePid()
      const phase = this.state.phase
      if (pid && phase !== 'running') this.set({ phase: 'running', since: Date.now(), pid })
      else if (!pid && phase === 'running') this.stop('exited')
      else if (!pid && phase === 'starting' && Date.now() - this.startedAt > 180_000) this.stop('idle')
    }, ms)
  }

  private stop(phase: 'exited' | 'idle'): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.set({ phase, since: Date.now() })
  }

  get running(): boolean {
    return this.state.phase === 'running'
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
  }
}
