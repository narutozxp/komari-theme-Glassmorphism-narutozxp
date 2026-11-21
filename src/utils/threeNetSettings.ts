const ID_SEPARATOR = /[\s,，;；]+/u
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
const CARRIERS = [
  { test: /电信|telecom|\bct\b/i, label: '电信' },
  { test: /联通|unicom|\bcu\b/i, label: '联通' },
  { test: /移动|mobile|cmcc|\bcm\b/i, label: '移动' },
  { test: /教育|cernet/i, label: '教育' },
]
export type PingTaskLabelMode = 'carrier' | 'full'

export function isPingTaskLabelMode(value: unknown): value is PingTaskLabelMode {
  return value === 'carrier' || value === 'full'
}

export function getPingTaskDisplayName(name: string, mode: PingTaskLabelMode): string {
  return mode === 'carrier' ? (CARRIERS.find(carrier => carrier.test.test(name))?.label ?? name) : name
}

export function parsePingTaskIds(value: unknown): number[] {
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      return parsePingTaskIds(JSON.parse(value))
    }
    catch { return [] }
  }
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(ID_SEPARATOR) : []
  return [...new Set(values.filter(item => typeof item === 'number' || (typeof item === 'string' && item.trim())).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))].slice(0, 3)
}

export function parseNodePingBindings(value: unknown): Record<string, number[]> {
  const result: Record<string, number[]> = Object.create(null)
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return result
    for (const [uuid, ids] of Object.entries(parsed)) {
      if (UUID_PATTERN.test(uuid))
        result[uuid] = parsePingTaskIds(ids)
    }
  }
  catch { /* Malformed optional configuration falls back to global bindings. */ }
  return result
}
