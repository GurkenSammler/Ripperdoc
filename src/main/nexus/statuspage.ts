import { NEXUS_STATUS_PAGE } from '@shared/brand'
import { t } from '@shared/i18n'
import type { NexusHealth } from '@shared/types'

// Öffentliche Statusseite von Nexus (Atlassian Statuspage). Ohne Key, ohne Nutzerdaten; nur damit RIPPERDOC
// bei Problemen sagen kann, ob es an Nexus liegt ("Slow website / API responses") oder am eigenen Netz.

interface Summary {
  status?: { indicator?: string; description?: string }
  components?: { name?: string; status?: string; group?: boolean }[]
  incidents?: { name?: string; status?: string; incident_updates?: { body?: string }[] }[]
  scheduled_maintenances?: { name?: string; status?: string }[]
}

const INDICATORS = new Set(['none', 'minor', 'major', 'critical', 'maintenance'])

export function parseSummary(s: Summary, now = Date.now()): NexusHealth {
  const indicator = s.status?.indicator ?? ''
  const incident = s.incidents?.find((i) => i.status !== 'resolved' && i.status !== 'postmortem')
  const maintenance = s.scheduled_maintenances?.find((m) => m.status === 'in_progress')
  return {
    indicator: (INDICATORS.has(indicator) ? indicator : 'unknown') as NexusHealth['indicator'],
    description: s.status?.description ?? t('main.nexus.statusUnknown'),
    incident: incident?.name ?? maintenance?.name ?? null,
    incidentNote: incident?.incident_updates?.[0]?.body ?? null,
    degraded: (s.components ?? []).filter((c) => !c.group && c.name && c.status && c.status !== 'operational').map((c) => c.name!),
    checkedAt: now,
  }
}

export async function fetchHealth(fetchImpl: typeof fetch = fetch, timeoutMs = 8000): Promise<NexusHealth> {
  const res = await fetchImpl(`${NEXUS_STATUS_PAGE}/api/v2/summary.json`, { signal: AbortSignal.timeout(timeoutMs) })
  if (!res.ok) throw new Error(t('main.nexus.statusPageHttp', res.status))
  return parseSummary((await res.json()) as Summary)
}
