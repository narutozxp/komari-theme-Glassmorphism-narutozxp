import type { PingRecord } from '@/utils/rpc'
import { TIME_MS } from '@/constants/time'

export interface PingChartSample extends Pick<PingRecord, 'task_id' | 'time'> {
  value: number | null
}

export interface PingChartRow extends Record<string, unknown> {
  time: string
  [taskId: number]: number | null | undefined
}

const MIN_BUCKET_MINUTES = 5
const MAX_BUCKETS = 180

export function buildLegacyPingLossHistory(records: readonly PingChartSample[], start: number, end: number) {
  const minBucketSize = MIN_BUCKET_MINUTES * TIME_MS.minute
  const bucketSize = Math.max(1, Math.ceil((end - start) / (MAX_BUCKETS * minBucketSize))) * minBucketSize
  const lastBucket = Math.max(0, Math.ceil((end - start) / bucketSize) - 1)
  const buckets = new Map<number, Map<number, { total: number, lost: number }>>()

  for (const record of records) {
    const timestamp = new Date(record.time).getTime()
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp > end || record.value === null || !Number.isFinite(record.value))
      continue

    const bucketIndex = Math.min(lastBucket, Math.floor((timestamp - start) / bucketSize))
    const bucketTime = start + bucketIndex * bucketSize
    const bucket = buckets.get(bucketTime) ?? new Map<number, { total: number, lost: number }>()
    const task = bucket.get(record.task_id) ?? { total: 0, lost: 0 }
    task.total++
    if (record.value < 0)
      task.lost++
    bucket.set(record.task_id, task)
    buckets.set(bucketTime, bucket)
  }

  const timestamps = [...buckets.keys()].sort((a, b) => a - b)
  const rows: PingChartRow[] = []
  const first = timestamps[0]
  const last = timestamps.at(-1)
  if (first !== undefined && last !== undefined) {
    for (let timestamp = first; timestamp <= last; timestamp += bucketSize) {
      const row: PingChartRow = { time: new Date(timestamp).toISOString() }
      for (const [taskId, task] of buckets.get(timestamp) ?? [])
        row[taskId] = task.lost / task.total * 100
      rows.push(row)
    }
  }

  return { rows, bucketMinutes: bucketSize / TIME_MS.minute }
}
