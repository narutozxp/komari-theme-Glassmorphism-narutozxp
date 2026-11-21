import type { PingTaskInfo } from '@/utils/rpc'

const ID_SEPARATOR = /[\s,，;；]+/u
const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
const CARRIERS = [
  { id: 'telecom', test: /电信|telecom|\b(?:ct|ctcc)\b/i, label: '电信' },
  { id: 'unicom', test: /联通|unicom|\b(?:cu|cucc)\b/i, label: '联通' },
  { id: 'mobile', test: /移动|china[\s_-]*mobile|\b(?:cmcc|cm)\b/i, label: '移动' },
]
export type PingTaskLabelMode = 'carrier' | 'full'
export type PingDisplayMode = PingTaskLabelMode | 'summary'

export interface PingDisplayGroup {
  id: number | string
  name: string
  label: string
  taskIds: number[]
}

export function isPingTaskLabelMode(value: unknown): value is PingTaskLabelMode {
  return value === 'carrier' || value === 'full'
}

export function groupPingDisplayTasks(tasks: ReadonlyArray<Pick<PingTaskInfo, 'id' | 'name'>>, mode: PingDisplayMode): PingDisplayGroup[] {
  if (!tasks.length)
    return []
  if (mode === 'full')
    return tasks.map(task => ({ id: task.id, name: task.name, label: task.name, taskIds: [task.id] }))
  if (mode === 'summary')
    return [{ id: 'selected', name: '所选任务平均', label: '所选任务平均', taskIds: tasks.map(task => task.id) }]

  const byCarrier = new Map<string, number[]>()
  for (const task of tasks) {
    const carrier = CARRIERS.find(item => item.test.test(task.name))
    if (!carrier)
      continue
    const ids = byCarrier.get(carrier.id) ?? []
    ids.push(task.id)
    byCarrier.set(carrier.id, ids)
  }

  return CARRIERS.flatMap(({ id, label }) => {
    const taskIds = byCarrier.get(id)
    return taskIds ? [{ id, label, name: `${label}平均`, taskIds }] : []
  })
}

export function parsePingTaskIds(value: unknown): number[] {
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      return parsePingTaskIds(JSON.parse(value))
    }
    catch { return [] }
  }
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(ID_SEPARATOR) : []
  return [...new Set(values.filter(item => typeof item === 'number' || (typeof item === 'string' && item.trim())).map(Number).filter(id => Number.isSafeInteger(id) && id > 0))]
}

export function getConfiguredPingTaskIds(uuid: string, bindings: Record<string, number[]>, defaultIds: number[]): number[] {
  const ids = bindings[uuid]
  return ids?.length ? ids : defaultIds
}

export function isPingTaskAssigned(task: Pick<PingTaskInfo, 'clients'>, uuid: string): boolean {
  // Older Komari task catalogs omitted clients.
  return task.clients === undefined || task.clients?.includes(uuid) === true
}

export function getAvailablePingTaskIds(ids: number[], tasks: ReadonlyMap<number, PingTaskInfo> | null, uuid?: string): number[] {
  if (!tasks)
    return ids

  return ids.filter((id) => {
    const task = tasks.get(id)
    return task && (!uuid || isPingTaskAssigned(task, uuid))
  })
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
