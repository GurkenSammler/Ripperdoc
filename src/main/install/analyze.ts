import path from 'node:path'
import { FRAMEWORKS } from '@shared/frameworks'
import { t } from '@shared/i18n'
import type { FrameworkId, ModType } from '@shared/types'
import { guardReason } from '../deploy/guard'
import { keyOf, safeName, toRel } from '../util/paths'

// Erkennt, wie ein entpacktes Mod-Archiv aufgebaut ist, und ordnet jede Datei einem Ziel im Spielordner zu.
// Rein rechnerisch auf der Dateiliste; Inhalte (info.json, .reds, .lua) liest nur `peek`.

export type Peek = (rel: string) => Promise<string | null>

export interface Mapping {
  src: string // relativ zum Entpack-Ordner
  dst: string // relativ zur Spielwurzel
}

export interface Analysis {
  rule: string
  mapped: Mapping[]
  unknown: string[]
  docs: string[]
  blocked: string[]
  variants: string[] // mehrere gleichwertige Ordner: David wählt einen
  anchor: string | null // Ordner, der der Spielwurzel entspricht (relativ zum Entpack-Ordner), sonst null
  types: ModType[]
  provides: FrameworkId[]
  requires: FrameworkId[]
  recommends: FrameworkId[] // optional: Mod läuft auch ohne (z. B. Mod Settings für ein Menü)
}

const JUNK = /(^|\/)(__macosx|\.ds_store|thumbs\.db|desktop\.ini|\.git)(\/|$)/i
const DOC_EXT = /\.(txt|md|pdf|png|jpe?g|gif|webp|bmp|url|html?|rtf|docx?|odt)$/i
const ROOT_DIRS = ['archive', 'bin', 'engine', 'mods', 'r6', 'red4ext']

const CET_MODS = 'bin/x64/plugins/cyber_engine_tweaks/mods'

const dirOf = (rel: string): string => {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '' : rel.slice(0, i)
}
const baseOf = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1)
const under = (rel: string, dir: string): boolean => dir === '' || keyOf(rel).startsWith(keyOf(dir) + '/')
const strip = (rel: string, dir: string): string => (dir === '' ? rel : rel.slice(dir.length + 1))
const join = (...parts: string[]): string => parts.filter((p) => p !== '').join('/')
const depth = (dir: string): number => (dir === '' ? 0 : dir.split('/').length)

/** Erkennt "Name-12345-1-2-1700000000.zip" (Nexus-Dateiname) → Name, Mod-ID, Version. */
export function parseArchiveName(file: string): { name: string; nexusModId?: number; version: string } {
  const stem = path.basename(file).replace(/\.(zip|7z|rar|tar|gz)$/i, '')
  // Neues Schema (seit 2026): "Name 107 1.38.0 2026-10-22T12-57Z Q6xF6lly7"
  const n = stem.match(/^(.*?) (\d{1,7}) (\S+) \d{4}-\d{2}-\d{2}T\d{2}-\d{2}Z(?: \S+)?$/)
  if (n) return { name: n[1].trim() || stem, nexusModId: Number(n[2]), version: n[3] }
  // Altes Schema: "Name-107-1-37-1-1758996889"
  const m = stem.match(/^(.*?)-(\d{2,7})-([\dA-Za-z-]*?)-?(\d{9,11})$/)
  if (m) {
    const name = m[1].replace(/[_]+/g, ' ').trim()
    return { name: name || stem, nexusModId: Number(m[2]), version: m[3].replace(/-/g, '.') || '?' }
  }
  return { name: stem.replace(/[_]+/g, ' ').trim(), version: '?' }
}

/** Typ einer Datei anhand ihres Ziels. */
export function classifyDst(dst: string): ModType {
  const k = keyOf(dst)
  if (FRAMEWORKS.some((f) => f.markers.includes(k))) return 'framework'
  if (k.startsWith('archive/pc/mod/')) return k.endsWith('.xl') ? 'xl' : 'archive'
  if (k.startsWith(CET_MODS + '/')) return 'cet'
  if (k.startsWith('r6/scripts/')) return 'reds'
  if (k.startsWith('r6/tweaks/')) return 'tweak'
  if (k.startsWith('red4ext/plugins/')) return 'red4ext'
  if (k.startsWith('mods/')) return 'redmod'
  if (k.startsWith('r6/input/')) return 'input'
  if (k.startsWith('bin/x64/plugins/') && k.endsWith('.asi')) return 'asi'
  return 'other'
}

/** Prüft, ob dir/<name> wirklich wie ein Spiel-Wurzelordner aussieht (nicht nur gleich heißt). */
function looksLikeRoot(files: string[], dir: string, name: string): boolean {
  const p = keyOf(join(dir, name)) + '/'
  const inside = files.filter((f) => keyOf(f).startsWith(p)).map((f) => keyOf(f).slice(p.length))
  if (inside.length === 0) return false
  switch (name) {
    case 'archive':
      return inside.some((f) => f.startsWith('pc/'))
    case 'bin':
      return inside.some((f) => f.startsWith('x64/'))
    case 'engine':
      return inside.some((f) => f.startsWith('config/') || f.startsWith('tools/'))
    case 'r6':
      return inside.some((f) => /^(scripts|tweaks|input|config)\//.test(f))
    case 'red4ext':
      return true
    case 'mods':
      return inside.some((f) => /^[^/]+\/info\.json$/.test(f))
    default:
      return false
  }
}

/** Alle Ordner, in denen Spiel-Wurzelordner liegen (z. B. "" oder "MeinMod v1.2"). */
function findAnchors(files: string[]): string[] {
  const dirs = new Set<string>([''])
  for (const f of files) {
    let d = dirOf(f)
    while (d !== '') {
      dirs.add(d)
      d = dirOf(d)
    }
  }
  const anchors: string[] = []
  for (const d of dirs) {
    const prefix = d === '' ? '' : keyOf(d) + '/'
    const childNames = new Set<string>()
    for (const f of files) {
      const k = keyOf(f)
      if (!k.startsWith(prefix)) continue
      const rest = k.slice(prefix.length)
      const slash = rest.indexOf('/')
      if (slash > 0) childNames.add(rest.slice(0, slash))
    }
    if (ROOT_DIRS.some((r) => childNames.has(r) && looksLikeRoot(files, d, r))) anchors.push(d)
  }
  // Nur die flachsten Anker zählen; tiefere liegen meist innerhalb (z. B. mods/x/archives)
  const kept = anchors.filter((a) => !anchors.some((b) => b !== a && under(a, b)))
  const min = Math.min(...kept.map(depth))
  return kept.filter((a) => depth(a) === min)
}

interface Ctx {
  files: string[]
  modName: string
  peek: Peek
}

async function isRedmodInfo(peek: Peek, rel: string): Promise<boolean> {
  const text = await peek(rel)
  if (!text) return false
  try {
    const json = JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown>
    return typeof json.name === 'string' && ('version' in json || 'customSounds' in json || 'description' in json)
  } catch {
    return false
  }
}

/** Zuordnung ohne Spiel-Wurzelordner: nach Dateityp. */
async function mapByType(ctx: Ctx, out: Mapping[], unknown: string[], docs: string[]): Promise<string> {
  const rules = new Set<string>()
  const taken = new Set<string>()
  const take = (src: string, dst: string): void => {
    taken.add(src)
    out.push({ src, dst })
  }
  const folderName = (dir: string): string => safeName(dir === '' ? ctx.modName : baseOf(dir))

  // 1. REDmod-Ordner (info.json mit Namen), sonst würden ihre archives/ und scripts/ falsch einsortiert
  const infos = ctx.files.filter((f) => baseOf(f).toLowerCase() === 'info.json')
  for (const info of infos) {
    if (!(await isRedmodInfo(ctx.peek, info))) continue
    const dir = dirOf(info)
    let name = folderName(dir)
    try {
      name = safeName(String((JSON.parse(((await ctx.peek(info)) ?? '{}').replace(/^﻿/, '')) as { name?: string }).name ?? name))
    } catch {
      // Ordnername bleibt
    }
    for (const f of ctx.files) if (!taken.has(f) && under(f, dir)) take(f, join('mods', name, strip(f, dir)))
    rules.add('redmod')
  }

  // 2. CET-Mods: Ordner mit init.lua (der flachste gewinnt)
  const inits = ctx.files.filter((f) => !taken.has(f) && baseOf(f).toLowerCase() === 'init.lua').map(dirOf)
  const cetDirs = inits.filter((d) => !inits.some((o) => o !== d && under(d, o) && depth(o) < depth(d)))
  for (const dir of cetDirs) {
    const name = folderName(dir)
    for (const f of ctx.files) if (!taken.has(f) && under(f, dir) && !(dir === '' && DOC_EXT.test(f) && !f.includes('/'))) take(f, join(CET_MODS, name, strip(f, dir)))
    rules.add('cet')
  }

  // 3. RED4ext-Plugins: Ordner mit einer dll
  const dllDirs = [...new Set(ctx.files.filter((f) => !taken.has(f) && /\.dll$/i.test(f)).map(dirOf))]
  for (const dir of dllDirs) {
    const name = folderName(dir)
    for (const f of ctx.files) {
      if (taken.has(f) || dirOf(f) !== dir) continue
      if (DOC_EXT.test(f)) continue
      take(f, join('red4ext', 'plugins', name, baseOf(f)))
    }
    rules.add('red4ext')
  }

  // 4. Lose Dateien nach Endung
  const rest = ctx.files.filter((f) => !taken.has(f))
  const groupRoot = (list: string[]): string => {
    if (list.length === 0) return ''
    let common = dirOf(list[0])
    for (const f of list) while (common !== '' && !under(f, common)) common = dirOf(common)
    return common
  }
  const reds = rest.filter((f) => /\.reds$/i.test(f))
  const tweaks = rest.filter((f) => /\.(ya?ml|tweak)$/i.test(f))
  for (const [list, target, rule] of [
    [reds, 'r6/scripts', 'reds'],
    [tweaks, 'r6/tweaks', 'tweak'],
  ] as const) {
    if (list.length === 0) continue
    const root = groupRoot(list)
    const name = folderName(root)
    for (const f of list) take(f, join(target, name, strip(f, root)))
    rules.add(rule)
  }
  for (const f of rest) {
    if (taken.has(f)) continue
    if (/\.(archive|xl)$/i.test(f)) {
      take(f, join('archive/pc/mod', baseOf(f)))
      rules.add('archive')
    } else if (/\.asi$/i.test(f)) {
      take(f, join('bin/x64/plugins', baseOf(f)))
      const ini = rest.find((o) => !taken.has(o) && keyOf(o) === keyOf(f.replace(/\.asi$/i, '.ini')))
      if (ini) take(ini, join('bin/x64/plugins', baseOf(ini)))
      rules.add('asi')
    } else if (/\.xml$/i.test(f)) {
      take(f, join('r6/input', baseOf(f)))
      rules.add('input')
    }
  }
  for (const f of ctx.files) {
    if (taken.has(f)) continue
    if (DOC_EXT.test(f)) docs.push(f)
    else unknown.push(f)
  }
  return rules.size ? `by-type:${[...rules].join('+')}` : 'unknown'
}

/**
 * Ziele, die mehrfach vorkommen, aus verschiedenen Top-Ordnern → das sind Varianten. Liegt eine Fassung
 * direkt in der Wurzel ("Foo.archive" + "Optional/Foo.archive"), ist die Wurzel selbst eine Variante ('').
 */
function variantsFromDuplicates(mapped: Mapping[]): string[] {
  const byDst = new Map<string, Set<string>>()
  for (const m of mapped) {
    const top = m.src.includes('/') ? m.src.slice(0, m.src.indexOf('/')) : ''
    const set = byDst.get(keyOf(m.dst)) ?? new Set<string>()
    set.add(top)
    byDst.set(keyOf(m.dst), set)
  }
  const tops = new Set<string>()
  for (const set of byDst.values()) if (set.size > 1) for (const t of set) tops.add(t)
  return [...tops].sort()
}

export interface AnalyzeOptions {
  archiveName: string
  peek: Peek
  variant?: string // gewählter Varianten-Ordner
}

export async function analyze(allFiles: string[], opts: AnalyzeOptions): Promise<Analysis> {
  let files = allFiles.map(toRel).filter((f) => f !== '' && !JUNK.test(f))
  const modName = parseArchiveName(opts.archiveName).name
  let docs: string[] = []
  const outerDocs: string[] = []
  const unknown: string[] = []
  let mapped: Mapping[] = []
  let rule: string
  let variants: string[] = []
  let anchorDir: string | null = null

  if (opts.variant !== undefined) {
    const v = opts.variant
    // Hauptordner ('') = alles, was in keinem der anderen Varianten-Ordner liegt
    const others = v === '' ? (await analyze(allFiles, { ...opts, variant: undefined })).variants.filter((o) => o !== '') : []
    const inVariant = (f: string) => (v === '' ? !others.some((o) => under(f, o)) : under(f, v))
    // Dateien außerhalb der Variante, die keine Doku sind, gehören zu anderen Varianten und fallen weg
    for (const f of files) if (!inVariant(f) && DOC_EXT.test(f)) outerDocs.push(f)
    files = files.filter(inVariant).map((f) => strip(f, v))
  }

  const anchors = findAnchors(files)
  if (anchors.length > 1 && opts.variant === undefined) {
    variants = anchors.sort()
    rule = 'variants'
  } else if (anchors.length >= 1) {
    const anchor = anchors[0]
    anchorDir = opts.variant !== undefined ? join(opts.variant, anchor) : anchor
    rule = anchor === '' ? 'game-root' : t('main.import.ruleShellRemoved')
    for (const f of files) {
      if (!under(f, anchor)) {
        ;(DOC_EXT.test(f) ? docs : unknown).push(f)
        continue
      }
      const rel = strip(f, anchor)
      const top = rel.includes('/') ? rel.slice(0, rel.indexOf('/')).toLowerCase() : ''
      if (ROOT_DIRS.includes(top)) mapped.push({ src: f, dst: rel })
      else (DOC_EXT.test(f) ? docs : unknown).push(f)
    }
  } else {
    const v = opts.variant
    const peek: Peek = v === undefined ? opts.peek : (rel) => opts.peek(join(v, rel))
    rule = await mapByType({ files, modName, peek }, mapped, unknown, docs)
    if (opts.variant === undefined) {
      variants = variantsFromDuplicates(mapped)
      if (variants.length) rule = 'variants'
    }
  }

  if (variants.length) {
    return { rule, mapped: [], unknown: [], docs, blocked: [], variants, anchor: null, types: [], provides: [], requires: [], recommends: [] }
  }

  // Varianten-Präfix wieder vor die Quellpfade setzen (die Dateien liegen ja dort)
  if (opts.variant !== undefined) {
    const v = opts.variant
    mapped = mapped.map((m) => ({ ...m, src: join(v, m.src) }))
    for (let i = 0; i < unknown.length; i++) unknown[i] = join(v, unknown[i])
    docs = [...outerDocs, ...docs.map((d) => join(v, d))]
  }

  const blocked = mapped.filter((m) => guardReason(m.dst) !== null).map((m) => m.dst)
  mapped = mapped.filter((m) => guardReason(m.dst) === null)
  return { rule, mapped, unknown, docs, blocked, variants: [], anchor: anchorDir, ...(await summarize(mapped, opts.peek)) }
}

/** Typen, mitgebrachte Frameworks und Abhängigkeiten einer fertigen Zuordnung. */
export async function summarize(
  mapped: Mapping[],
  peek: Peek,
): Promise<{ types: ModType[]; provides: FrameworkId[]; requires: FrameworkId[]; recommends: FrameworkId[] }> {
  const types = [...new Set(mapped.map((m) => classifyDst(m.dst)))].sort()
  const dsts = new Set(mapped.map((m) => keyOf(m.dst)))
  const provides = FRAMEWORKS.filter((f) => f.markers.some((mk) => dsts.has(mk))).map((f) => f.id)
  const { requires, recommends } = await detectDeps(mapped, types, provides, peek)
  return { types, provides, requires, recommends }
}

/**
 * Abhängigkeiten aus Typen und Inhalten ableiten; was der Mod selbst mitbringt, zählt nicht.
 * Mod Settings und Native Settings UI sind nur Empfehlungen: Mods markieren damit Einstellungen fürs
 * Menü und laufen auch ohne (geprüft an Virtual Atelier).
 */
export async function detectDeps(
  mapped: Mapping[],
  types: ModType[],
  provides: FrameworkId[],
  peek: Peek,
): Promise<{ requires: FrameworkId[]; recommends: FrameworkId[] }> {
  const req = new Set<FrameworkId>()
  const rec = new Set<FrameworkId>()
  const has = (t: ModType): boolean => types.includes(t)
  if (has('reds')) req.add('redscript')
  if (has('xl')) req.add('archivexl')
  if (has('tweak')) req.add('tweakxl')
  if (has('cet')) req.add('cet')
  if (has('red4ext')) req.add('red4ext')
  if (has('input')) req.add('inputloader')
  if (has('redmod')) req.add('redmod')

  for (const m of mapped) {
    if (/\.reds$/i.test(m.dst)) {
      const text = (await peek(m.src)) ?? ''
      if (/\bimport\s+Codeware\b|\bCodeware\.\w/.test(text)) req.add('codeware')
      if (/\bModSettings\b|runtimeProperty\("ModSettings/.test(text)) rec.add('modsettings')
    } else if (/\.lua$/i.test(m.dst)) {
      const text = (await peek(m.src)) ?? ''
      if (/GetMod\(\s*["']nativeSettings["']\s*\)/.test(text)) rec.add('nativesettings')
    }
  }

  // Frameworks, die der Mod mitbringt, und deren eigene Grundlagen
  for (const id of provides) {
    req.delete(id)
    for (const need of FRAMEWORKS.find((f) => f.id === id)?.needs ?? []) req.add(need)
  }
  for (const id of provides) {
    req.delete(id)
    rec.delete(id)
  }
  for (const id of req) rec.delete(id)
  return { requires: [...req].sort(), recommends: [...rec].sort() }
}
