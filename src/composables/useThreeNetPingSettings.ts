import type { ThreeNetDisplaySettings } from '@/services/theme-settings.service'
import type { PingTaskInfo } from '@/utils/rpc'
import { computed, onMounted, onScopeDispose, ref, watch } from 'vue'
import { loadPublicPingTasks } from '@/services/metrics.service'
import { loadThreeNetThemeSettings, saveThreeNetPingBindings } from '@/services/theme-settings.service'
import { useAppStore } from '@/stores/app'
import { useNodesStore } from '@/stores/nodes'
import { getAvailablePingTaskIds, getConfiguredPingTaskIds, groupPingDisplayTasks, isPingTaskAssigned, isPingTaskLabelMode } from '@/utils/threeNetSettings'

function sameTasks(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function useThreeNetPingSettings() {
  const app = useAppStore()
  const nodes = useNodesStore()
  const tasks = ref<PingTaskInfo[] | null>(null)
  const loading = ref(true)
  const saving = ref(false)
  const error = ref('')
  const catalogError = ref('')
  const nodeSearch = ref('')
  const taskSearch = ref('')
  const activeNodeId = ref('global')
  const lastNodeId = ref('')
  const bindings = ref({ ...app.threeNetPingNodeTaskBindings })
  const savedBindings = ref({ ...app.threeNetPingNodeTaskBindings })
  const globalIds = ref([...app.threeNetPingTaskIds])
  const savedGlobalIds = ref([...app.threeNetPingTaskIds])
  const globalChanged = computed(() => !sameTasks(globalIds.value, savedGlobalIds.value))
  const changes = computed(() => Object.fromEntries(
    Object.entries(bindings.value).filter(([uuid, ids]) => !sameTasks(ids, savedBindings.value[uuid] ?? [])),
  ))
  const pingEnabled = ref(app.threeNetPingEnabled)
  const sparklineEnabled = ref(app.threeNetPingSparkline)
  const labelMode = ref(app.threeNetPingLabelMode)
  const pingDisplayMode = computed({
    get: () => pingEnabled.value ? labelMode.value : 'summary',
    set(value: string) {
      pingEnabled.value = isPingTaskLabelMode(value)
      if (isPingTaskLabelMode(value))
        labelMode.value = value
    },
  })
  const originalDisplay = ref({
    threeNetPingEnabled: pingEnabled.value,
    threeNetPingSparkline: sparklineEnabled.value,
    threeNetPingLabelMode: labelMode.value,
  })
  const displayChanges = computed<ThreeNetDisplaySettings>(() => ({
    ...(pingEnabled.value !== originalDisplay.value.threeNetPingEnabled ? { threeNetPingEnabled: pingEnabled.value } : {}),
    ...(sparklineEnabled.value !== originalDisplay.value.threeNetPingSparkline ? { threeNetPingSparkline: sparklineEnabled.value } : {}),
    ...(labelMode.value !== originalDisplay.value.threeNetPingLabelMode ? { threeNetPingLabelMode: labelMode.value } : {}),
  }))
  const dirty = computed(() => globalChanged.value || Object.keys(changes.value).length > 0 || Object.keys(displayChanges.value).length > 0)
  const visibleNodes = computed(() => nodes.visibleNodes)
  const filteredNodes = computed(() => visibleNodes.value.filter(node => `${node.name} ${node.uuid}`.toLowerCase().includes(nodeSearch.value.trim().toLowerCase())))
  const isGlobal = computed(() => activeNodeId.value === 'global')
  const activeNode = computed(() => visibleNodes.value.find(node => node.uuid === activeNodeId.value))
  const activeTaskIds = computed(() => isGlobal.value ? globalIds.value : bindings.value[activeNodeId.value] ?? [])
  const usesGlobal = computed(() => !isGlobal.value && activeTaskIds.value.length === 0)
  const activeNodeName = computed(() => isGlobal.value ? '默认任务' : activeNode.value?.name)
  const tasksById = computed(() => tasks.value ? new Map(tasks.value.map(task => [task.id, task])) : null)
  const availableTasks = computed(() => {
    const node = activeNode.value
    return (tasks.value ?? []).filter(task => !node || isPingTaskAssigned(task, node.uuid))
  })
  const filteredTasks = computed(() => availableTasks.value.filter(task => `${task.id} ${task.name}`.toLowerCase().includes(taskSearch.value.trim().toLowerCase())))
  const unavailableTaskIds = computed(() => {
    const availableIds = new Set(availableTasks.value.map(task => task.id))
    return activeTaskIds.value.filter(id => !availableIds.has(id))
  })
  const selectedTaskOrder = computed(() => new Map(activeTaskIds.value.map((id, index) => [id, index + 1])))
  const canSelectAll = computed(() => availableTasks.value.some(task => !selectedTaskOrder.value.has(task.id)))
  const configuredNodeCount = computed(() => visibleNodes.value.filter(node => bindings.value[node.uuid]?.length).length)
  const previewSelection = computed(() => {
    const uuid = activeNode.value?.uuid
    return uuid ? getConfiguredPingTaskIds(uuid, bindings.value, globalIds.value) : globalIds.value
  })
  const hasPreviewSelection = computed(() => previewSelection.value.length > 0)
  const previewTasks = computed(() => {
    const ids = getAvailablePingTaskIds(previewSelection.value, tasksById.value, activeNode.value?.uuid)
    return groupPingDisplayTasks(ids.map(id => ({ id, name: taskName(id) })), pingDisplayMode.value)
  })

  function taskName(id: number) {
    return tasksById.value?.get(id)?.name ?? `任务 ${id}`
  }

  function setActiveTaskIds(next: number[]) {
    if (loading.value || saving.value || (!activeNode.value && !isGlobal.value))
      return
    error.value = ''
    if (isGlobal.value) {
      globalIds.value = next
      return
    }
    bindings.value = { ...bindings.value, [activeNodeId.value]: next }
  }

  function toggleTask(id: number) {
    const current = activeTaskIds.value
    setActiveTaskIds(current.includes(id) ? current.filter(taskId => taskId !== id) : [...current, id])
  }

  function selectAllTasks() {
    setActiveTaskIds([...new Set([...activeTaskIds.value, ...availableTasks.value.map(task => task.id)])])
  }

  function clearTasks() {
    if (activeTaskIds.value.length)
      setActiveTaskIds([])
  }

  function restoreDefaultTasks() {
    if (isGlobal.value)
      setActiveTaskIds([...savedGlobalIds.value])
    else
      clearTasks()
  }

  function showNodeSettings() {
    const node = visibleNodes.value.find(node => node.uuid === lastNodeId.value) ?? visibleNodes.value[0]
    if (node)
      activeNodeId.value = node.uuid
  }

  watch(activeNodeId, (id) => {
    if (id !== 'global')
      lastNodeId.value = id
    taskSearch.value = ''
  })

  function resetDraft() {
    bindings.value = { ...app.threeNetPingNodeTaskBindings }
    savedBindings.value = { ...bindings.value }
    globalIds.value = [...app.threeNetPingTaskIds]
    savedGlobalIds.value = [...globalIds.value]
    pingEnabled.value = app.threeNetPingEnabled
    sparklineEnabled.value = app.threeNetPingSparkline
    labelMode.value = app.threeNetPingLabelMode
    originalDisplay.value = {
      threeNetPingEnabled: pingEnabled.value,
      threeNetPingSparkline: sparklineEnabled.value,
      threeNetPingLabelMode: labelMode.value,
    }
  }

  async function save() {
    if (saving.value || !dirty.value)
      return
    saving.value = true
    error.value = ''
    try {
      // Sync store auth state as well as checking in the service before mutation.
      if (!await app.verifyLoginState({ force: true }))
        throw new Error('登录状态已过期，请先登录管理员账号。')
      app.publicSettings = await saveThreeNetPingBindings(changes.value, globalChanged.value ? globalIds.value : undefined, displayChanges.value)
      resetDraft()
    }
    catch (cause) {
      error.value = cause instanceof Error ? cause.message : '保存失败，请稍后重试。'
    }
    finally { saving.value = false }
  }
  let closed = false
  onScopeDispose(() => {
    closed = true
  })
  onMounted(async () => {
    const [settings, catalog] = await Promise.allSettled([loadThreeNetThemeSettings(), loadPublicPingTasks(true)])
    if (closed)
      return
    if (settings.status === 'fulfilled') {
      app.publicSettings = settings.value
      resetDraft()
    }
    else {
      error.value = '无法同步后台主题设置，当前显示上次读取的配置。'
    }
    if (catalog.status === 'fulfilled')
      tasks.value = catalog.value
    else
      catalogError.value = catalog.reason instanceof Error ? catalog.reason.message : 'Ping 任务加载失败。'
    loading.value = false
  })
  return {
    loading,
    saving,
    error,
    catalogError,
    nodeSearch,
    taskSearch,
    activeNodeId,
    bindings,
    dirty,
    pingDisplayMode,
    sparklineEnabled,
    visibleNodes,
    filteredNodes,
    isGlobal,
    usesGlobal,
    activeNodeName,
    activeTaskIds,
    availableTasks,
    unavailableTaskIds,
    filteredTasks,
    configuredNodeCount,
    hasPreviewSelection,
    previewTasks,
    selectedTaskOrder,
    canSelectAll,
    globalChanged,
    taskName,
    toggleTask,
    selectAllTasks,
    clearTasks,
    restoreDefaultTasks,
    showNodeSettings,
    save,
  }
}
