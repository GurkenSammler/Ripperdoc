import { analyze, parseArchiveName } from '../src/main/install/analyze'
import { peekFrom } from './helpers'

const run = (files: string[], contents: Record<string, string> = {}, archiveName = 'Test Mod.zip', variant?: string) =>
  analyze(files, { archiveName, peek: peekFrom(contents), variant })

const dsts = (a: { mapped: { dst: string }[] }) => a.mapped.map((m) => m.dst).sort()

describe('parseArchiveName', () => {
  it('liest Nexus-Dateinamen', () => {
    expect(parseArchiveName('Virtual Atelier-2987-1-5-3-1716000000.zip')).toEqual({ name: 'Virtual Atelier', nexusModId: 2987, version: '1.5.3' })
  })
  it('lässt normale Namen in Ruhe', () => {
    expect(parseArchiveName('cool_mod.7z')).toEqual({ name: 'cool mod', version: '?' })
  })
})

describe('analyze', () => {
  it('Spiel-Wurzel 1:1, Liesmich bleibt Doku', async () => {
    const a = await run(['archive/pc/mod/a.archive', 'readme.txt'])
    expect(a.rule).toBe('game-root')
    expect(dsts(a)).toEqual(['archive/pc/mod/a.archive'])
    expect(a.docs).toEqual(['readme.txt'])
    expect(a.types).toEqual(['archive'])
  })

  it('schält eine Hülle ab und erkennt redscript', async () => {
    const a = await run(['MyMod v1/archive/pc/mod/a.archive', 'MyMod v1/r6/scripts/x/y.reds'])
    expect(a.rule).toContain('Hülle')
    expect(dsts(a)).toEqual(['archive/pc/mod/a.archive', 'r6/scripts/x/y.reds'])
    expect(a.requires).toEqual(['redscript'])
  })

  it('lose .archive + .xl → archive/pc/mod, braucht ArchiveXL', async () => {
    const a = await run(['stuff/cool.archive', 'stuff/cool.archive.xl'])
    expect(dsts(a)).toEqual(['archive/pc/mod/cool.archive', 'archive/pc/mod/cool.archive.xl'])
    expect(a.requires).toEqual(['archivexl'])
  })

  it('CET-Mod im eigenen Ordner', async () => {
    const a = await run(['MyCet/init.lua', 'MyCet/modules/a.lua'])
    expect(dsts(a)).toEqual([
      'bin/x64/plugins/cyber_engine_tweaks/mods/MyCet/init.lua',
      'bin/x64/plugins/cyber_engine_tweaks/mods/MyCet/modules/a.lua',
    ])
    expect(a.requires).toEqual(['cet'])
  })

  it('CET-Mod ohne Ordner bekommt den Mod-Namen', async () => {
    const a = await run(['init.lua', 'data/x.json', 'README.md'], {}, 'Cool Mod-123-1-0-1700000000.zip')
    expect(dsts(a)).toEqual([
      'bin/x64/plugins/cyber_engine_tweaks/mods/Cool Mod/data/x.json',
      'bin/x64/plugins/cyber_engine_tweaks/mods/Cool Mod/init.lua',
    ])
    expect(a.docs).toEqual(['README.md'])
  })

  it('Native Settings UI und Mod Settings sind nur Empfehlungen', async () => {
    const a = await run(['M/init.lua'], { 'M/init.lua': 'local ns = GetMod("nativeSettings")' })
    expect(a.requires).toEqual(['cet'])
    expect(a.recommends).toEqual(['nativesettings'])
    const b = await run(['S/opt.reds'], { 'S/opt.reds': '@runtimeProperty("ModSettings.mod", "Cool")' })
    expect(b.requires).toEqual(['redscript'])
    expect(b.recommends).toEqual(['modsettings'])
  })

  it('lose .reds mit Codeware', async () => {
    const a = await run(['MyScript/a.reds', 'MyScript/sub/b.reds'], { 'MyScript/a.reds': 'import Codeware.*\n' })
    expect(dsts(a)).toEqual(['r6/scripts/MyScript/a.reds', 'r6/scripts/MyScript/sub/b.reds'])
    expect(a.requires).toEqual(['codeware', 'redscript'])
  })

  it('TweakXL-Dateien', async () => {
    const a = await run(['tweaks/better.yaml'])
    expect(dsts(a)).toEqual(['r6/tweaks/tweaks/better.yaml'])
    expect(a.requires).toEqual(['tweakxl'])
  })

  it('REDmod-Ordner nach info.json', async () => {
    const a = await run(['MyRedmod/info.json', 'MyRedmod/archives/x.archive'], {
      'MyRedmod/info.json': JSON.stringify({ name: 'cool_redmod', version: '1.0' }),
    })
    expect(dsts(a)).toEqual(['mods/cool_redmod/archives/x.archive', 'mods/cool_redmod/info.json'])
    expect(a.requires).toEqual(['redmod'])
  })

  it('RED4ext-Plugin lose', async () => {
    const a = await run(['MyPlugin/MyPlugin.dll', 'MyPlugin/config.toml'])
    expect(dsts(a)).toEqual(['red4ext/plugins/MyPlugin/MyPlugin.dll', 'red4ext/plugins/MyPlugin/config.toml'])
    expect(a.requires).toEqual(['red4ext'])
  })

  it('Varianten-Ordner mit Spiel-Wurzel: erst wählen, dann zuordnen', async () => {
    const files = ['A/archive/pc/mod/x.archive', 'B/archive/pc/mod/x.archive', 'readme.txt']
    const first = await run(files)
    expect(first.variants).toEqual(['A', 'B'])
    expect(first.mapped).toEqual([])
    const b = await run(files, {}, 'Test Mod.zip', 'B')
    expect(b.mapped).toEqual([{ src: 'B/archive/pc/mod/x.archive', dst: 'archive/pc/mod/x.archive' }])
    expect(b.docs).toEqual(['readme.txt'])
  })

  it('Varianten durch doppelte lose Dateien', async () => {
    const a = await run(['Normal/x.archive', 'Hard/x.archive'])
    expect(a.variants).toEqual(['Hard', 'Normal'])
  })

  it('CET selbst: bringt cet mit, braucht nichts', async () => {
    const a = await run([
      'bin/x64/version.dll',
      'bin/x64/global.ini',
      'bin/x64/plugins/cyber_engine_tweaks.asi',
      'bin/x64/plugins/cyber_engine_tweaks/scripts/json.lua',
    ])
    expect(a.provides).toEqual(['cet'])
    expect(a.requires).toEqual([])
    expect(a.types).toContain('framework')
  })

  it('ArchiveXL bringt sich mit und braucht RED4ext', async () => {
    const a = await run(['red4ext/plugins/ArchiveXL/ArchiveXL.dll'])
    expect(a.provides).toEqual(['archivexl'])
    expect(a.requires).toEqual(['red4ext'])
  })

  it('Guard sperrt Basisspiel-Archive', async () => {
    const a = await run(['archive/pc/content/basegame_1.archive', 'archive/pc/mod/a.archive'])
    expect(a.blocked).toEqual(['archive/pc/content/basegame_1.archive'])
    expect(dsts(a)).toEqual(['archive/pc/mod/a.archive'])
  })

  it('Unbekanntes wird gemeldet', async () => {
    const a = await run(['weird.bin'])
    expect(a.unknown).toEqual(['weird.bin'])
    expect(a.rule).toBe('unknown')
  })

  it('Müll wie __MACOSX fliegt raus', async () => {
    const a = await run(['__MACOSX/._a.archive', 'a.archive', 'Thumbs.db'])
    expect(dsts(a)).toEqual(['archive/pc/mod/a.archive'])
    expect(a.unknown).toEqual([])
  })
})
