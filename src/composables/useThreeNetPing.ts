import type { MaybeRefOrGetter } from 'vue'
import type { useNodePingStats } from '@/composables/useNodePingStats'
import type { NodeData } from '@/stores/nodes'
import { computed, toValue, watch } from 'vue'
import { loadPublicPingTasks, publicPingTaskCatalog } from '@/services/metrics.service'
import { subscribeVisibleRefresh } from '@/services/visibleRefresh.service'
import { useAppStore } from '@/stores/app'
import { getAvailablePingTaskIds, getConfiguredPingTaskIds, groupPingDisplayTasks } from '@/utils/threeNetSettings'

// Adapted from towersip: explicit IDs, per-node bindings, and separate history
// computations from status metadata so polling does not rebuild SVG paths.
export function useThreeNetPing(node: MaybeRefOrGetter<NodeData>, stats: ReturnType<typeof useNodePingStats>, enabled: MaybeRefOrGetter<boolean>) {
  const app = useAppStore()
  const configuredIds = computed(() => getConfiguredPingTaskIds(toValue(node).uuid, app.threeNetPingNodeTaskBindings, app.threeNetPingTaskIds))
  const hasConfiguredTasks = computed(() => configuredIds.value.length > 0)
  watch(() => hasConfiguredTasks.value && toValue(enabled), (enabled, _, onCleanup) => {
    if (!enabled)
      return
    const refresh = () => {
      void loadPublicPingTasks().catch(() => { /* Cached tasks and history remain usable. */ })
    }
    onCleanup(subscribeVisibleRefresh(refresh))
    refresh()
  }, { immediate: true })
  const groups = computed(() => {
    const current = toValue(node)
    const ids = getAvailablePingTaskIds(configuredIds.value, publicPingTaskCatalog.value, current.uuid)
    const tasks = ids.map(id => ({
      id,
      name: publicPingTaskCatalog.value?.get(id)?.name?.trim() || current.ping?.[String(id)]?.name?.trim() || `任务 ${id}`,
    }))
    return groupPingDisplayTasks(tasks, app.threeNetPingEnabled ? app.threeNetPingLabelMode : 'summary')
  })
  const items = computed(() => groups.value.map((group) => {
    const value = stats.statsForTasks(group.taskIds)
    // Use the same one-hour window as the sparkline. A recovered latest sample
    // must not hide packet loss recorded earlier in that window.
    const loss = value.avgLoss
    const failed = loss !== null && loss >= 100
    const latency = failed ? -1 : value.avgLatency
    return {
      ...group,
      stats: value,
      values: value.history.map(point => point.latency),
      latencyValue: latency,
      lossValue: loss,
      latency: latency === null ? '—' : latency < 0 ? '不可达' : `${Math.round(latency)} ms`,
      loss: loss === null ? '—' : `${loss.toFixed(1)}%`,
      failed,
    }
  }))
  return { items, hasConfiguredTasks }
}
