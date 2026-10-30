import path from 'node:path'
import { Core } from '../src/main/core'
import { locateGame, type LocateSources } from '../src/main/game/locate'
import { launchGame } from '../src/main/launch'
import { AREAS, getLang, resolveLang, setLang, t } from '../src/shared/i18n'
import { tmpDir, writeTree } from './helpers'

// Vollständigkeit (jeder Text auf Deutsch und Englisch) prüft schon tsc über area(). Hier der Rest.

const PREFIX: Record<string, string> = {
  common: 'common.',
  main: 'main.',
  inventory: 'inv.',
  shell: 'shell.',
  net: 'net.',
  config: 'config.',
  shards: 'shards.',
}

afterEach(() => setLang('de'))

describe('Wörterbuch', () => {
  it('jeder Schlüssel gehört genau einem Bereich und trägt dessen Präfix', () => {
    const seen = new Map<string, string>()
    for (const [name, a] of Object.entries(AREAS)) {
      for (const key of Object.keys(a.de)) {
        expect(key.startsWith(PREFIX[name]), `${key} in ${name}`).toBe(true)
        expect(seen.get(key), `${key} doppelt`).toBeUndefined()
        seen.set(key, name)
      }
      expect(Object.keys(a.en).sort()).toEqual(Object.keys(a.de).sort())
    }
  })

  it('keine leeren Texte, kein Deutsch im Englischen', () => {
    for (const a of Object.values(AREAS)) {
      for (const [key, v] of Object.entries(a.en)) {
        if (typeof v !== 'string') continue
        expect(v.trim(), key).not.toBe('')
        expect(v, key).not.toMatch(/[äöüÄÖÜß„]/)
      }
      for (const [key, v] of Object.entries(a.de)) if (typeof v === 'string') expect(v.trim(), key).not.toBe('')
    }
  })
})

describe('Sprache', () => {
  it('auto folgt der ersten Windows-Sprache, alles außer Deutsch wird Englisch', () => {
    expect(resolveLang('auto', ['de-DE', 'en-US'])).toBe('de')
    expect(resolveLang('auto', ['de-AT'])).toBe('de')
    expect(resolveLang('auto', ['en-US', 'de-DE'])).toBe('en')
    expect(resolveLang('auto', ['fr-FR'])).toBe('en')
    expect(resolveLang('auto', [])).toBe('en')
    expect(resolveLang(undefined, ['de-DE'])).toBe('de') // alte settings.json ohne Feld
    expect(resolveLang('en', ['de-DE'])).toBe('en')
    expect(resolveLang('de', ['en-US'])).toBe('de')
  })

  it('t() wechselt mit der Sprache, auch mit Werten', () => {
    setLang('de')
    expect(t('common.error')).toBe('FEHLER')
    expect(t('common.lang.hint', 'DE')).toBe('AUTO = WINDOWS-SPRACHE (DE)')
    setLang('en')
    expect(getLang()).toBe('en')
    expect(t('common.error')).toBe('ERROR')
    expect(t('common.lang.hint', 'EN')).toBe('AUTO = WINDOWS LANGUAGE (EN)')
  })
})

const NOWHERE: LocateSources = { steamRoot: async () => null, gogPaths: async () => [], epicManifestDirs: async () => [] }

describe('Main-Prozess spricht die eingestellte Sprache', () => {
  const cores: Core[] = []
  afterEach(() => {
    for (const c of cores.splice(0)) {
      c.watcher.dispose()
      c.nexus?.dispose()
    }
  })

  async function make(locales: string[] | undefined, settings: Record<string, unknown> = {}) {
    const base = await tmpDir('lang')
    const user = path.join(base, 'user')
    await writeTree(user, { 'settings.json': JSON.stringify(settings) })
    const core = new Core({
      userData: user,
      openUrl: async () => undefined,
      emit: () => undefined,
      gameRunning: async () => false,
      locate: NOWHERE,
      dataRootFor: () => path.join(base, 'data'),
      systemLocales: locales && (() => locales),
    })
    cores.push(core)
    await core.init()
    return { core, base }
  }

  it('englisches Windows → englische Meldungen, auch aus der Spielsuche', async () => {
    const { core, base } = await make(['en-US'])
    expect(getLang()).toBe('en')
    expect(core.appInfo('0', '0').systemLang).toBe('en')
    expect(core.game.error).toMatch(/not found/i)
    expect(core.game.error).not.toMatch(/[äöüß]|nicht/)
    await expect(core.setGameRoot(path.join(base, 'nope'))).rejects.toThrow(/^(?!.*Keine).*Cyberpunk2077\.exe/)
  })

  it('Umschalten in SYS.CONFIG gilt sofort, auch für die Meldung „Spiel nicht gefunden“', async () => {
    const { core } = await make(['en-US'])
    await core.settings.patch({ language: 'de' })
    await core.applyLanguage()
    expect(getLang()).toBe('de')
    expect(core.game.error).toMatch(/nicht gefunden/)
    await core.settings.patch({ language: 'auto' })
    await core.applyLanguage()
    expect(core.game.error).toMatch(/not found/i)
  })

  it('fest eingestellte Sprache schlägt Windows', async () => {
    await make(['de-DE'], { language: 'en' })
    expect(getLang()).toBe('en')
  })

  it('ohne Windows-Sprachen (Tests) bleibt auto bei der aktuellen Sprache', async () => {
    setLang('de')
    await make(undefined)
    expect(getLang()).toBe('de')
  })

  it('Spielsuche und Spielstart auf Englisch', async () => {
    setLang('en')
    const g = await locateGame(null, null, NOWHERE)
    expect(g.error).toMatch(/Steam, GOG, Epic/)
    expect(g.error).toMatch(/SYS\.CONFIG/)
    const base = await tmpDir('lang-launch')
    await writeTree(base, { 'bin/x64/Cyberpunk2077.exe': 'not an exe' })
    await expect(launchGame({ gameRoot: base, mode: 'direct', args: [], openUrl: async () => undefined })).rejects.toThrow(/^(?!Spiel)/)
  })
})
