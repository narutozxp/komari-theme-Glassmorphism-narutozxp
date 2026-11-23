<script setup lang="ts">
import type { NormalizedMetricSeries } from '@/utils/metricSeries'
import type { PingChartRow, PingChartSample } from '@/utils/pingLossHistory'
import type { PingMetricTaskStats, PingTaskInfo } from '@/utils/rpc'
import { Icon } from '@iconify/vue'
import dayjs from 'dayjs'
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch, watchEffect } from 'vue'
import VChart from 'vue-echarts'
import { Button } from '@/components/ui/button'
import { Empty } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useTouchTooltipTrigger } from '@/composables/useTouchTooltipTrigger'
import { PING_RECORD_MAX_COUNT } from '@/constants/load'
import { TIME_MS } from '@/constants/time'
import { loadPingRecordsWithTasks } from '@/services/history.service'
import { loadPingMetricStats, loadPublicPingTasks, queryMetrics } from '@/services/metrics.service'
import { useAppStore } from '@/stores/app'
import { ACCESSIBLE_LINE_TYPES, getChartSeriesPalette } from '@/utils/chartPalette'
import { normalizeMetricSeriesList, orderPingTasksByBackend, PING_LATENCY_METRIC, PING_LOSS_METRIC, pingTaskId, pingTaskName } from '@/utils/metricSeries'
import { resolvePingAxisScale } from '@/utils/pingChartAxisScale'
import { escapePingTooltip, pingChartTaskLabels } from '@/utils/pingChartPresentation'
import { smoothPingChartDisplayRows } from '@/utils/pingChartSmoothing'
import { buildLegacyPingLossHistory } from '@/utils/pingLossHistory'
import '@/utils/echarts' // 共享 ECharts 配置

const props = defineProps<{
  uuid: string
}>()

const appStore = useAppStore()
const isDark = computed(() => appStore.isDark)

interface CustomRange {
  start: dayjs.Dayjs
  end: dayjs.Dayjs
  hours: number
}

// 图表主题相关颜色
const chartThemeColors = computed(() => ({
  text: isDark.value ? 'rgba(255, 255, 255, 0.85)' : 'rgba(0, 0, 0, 0.85)',
  textSecondary: isDark.value ? 'rgba(255, 255, 255, 0.55)' : 'rgba(0, 0, 0, 0.55)',
  textTertiary: isDark.value ? 'rgba(255, 255, 255, 0.35)' : 'rgba(0, 0, 0, 0.35)',
  borderColor: isDark.value ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
  splitLineColor: isDark.value ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
  tooltipBg: isDark.value ? 'rgba(40, 40, 40, 0.95)' : 'rgba(255, 255, 255, 0.8)',
  tooltipShadow: isDark.value ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.06)',
  crosshairColor: isDark.value ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)',
}))

const chartColors = reactive(getChartSeriesPalette(appStore.colorVisionFriendly))

watchEffect(() => {
  chartColors.splice(0, chartColors.length, ...getChartSeriesPalette(appStore.colorVisionFriendly))
})

// 从 publicSettings 获取记录保留时间
const maxPingRecordPreserveTime = computed(() => appStore.publicSettings?.ping_record_preserve_time || 168)

// 视图选项
const presetViews = [
  { label: '1 小时', hours: 1 },
  { label: '6 小时', hours: 6 },
  { label: '12 小时', hours: 12 },
  { label: '1 天', hours: 24 },
  { label: '7 天', hours: 168 },
  { label: '15 天', hours: 360 },
  { label: '30 天', hours: 720 },
]
const CUSTOM_VIEW_LABEL = '自定义'
const DEFAULT_CUSTOM_RANGE_HOURS = 24

// 可用视图列表
const availableViews = computed(() => {
  const views: { label: string, hours?: number }[] = []
  const maxHours = maxPingRecordPreserveTime.value

  for (const v of presetViews) {
    if (maxHours >= v.hours) {
      views.push(v)
    }
  }

  const maxPreset = presetViews.at(-1)
  if (maxPreset && maxHours > maxPreset.hours) {
    const label = maxHours % 24 === 0
      ? `${Math.floor(maxHours / 24)} 天`
      : `${maxHours} 小时`
    views.push({ label, hours: maxHours })
  }
  else if (maxHours > 1 && !presetViews.some(v => v.hours === maxHours)) {
    const label = maxHours % 24 === 0
      ? `${Math.floor(maxHours / 24)} 天`
      : `${maxHours} 小时`
    views.push({ label, hours: maxHours })
  }

  views.push({ label: CUSTOM_VIEW_LABEL })
  return views
})

// 当前选中的视图
const selectedView = ref<string>('')
const customStartInput = ref('')
const customEndInput = ref('')
const appliedCustomRange = shallowRef<CustomRange | null>(null)
const isCustomRange = computed(() => selectedView.value === CUSTOM_VIEW_LABEL)
const customRange = computed<CustomRange | null>(() => {
  if (!customStartInput.value || !customEndInput.value)
    return null

  const start = dayjs(customStartInput.value)
  const end = dayjs(customEndInput.value)
  if (!start.isValid() || !end.isValid() || !end.isAfter(start))
    return null

  return {
    start,
    end,
    hours: Math.max(1, Math.ceil(end.diff(start, 'hour', true))),
  }
})
const customRangeError = computed(() => {
  if (!isCustomRange.value || (!customStartInput.value && !customEndInput.value))
    return ''
  if (!customStartInput.value || !customEndInput.value)
    return '请选择开始和结束时间'
  return customRange.value ? '' : '结束时间必须晚于开始时间'
})
const selectedHours = computed(() => {
  if (isCustomRange.value)
    return appliedCustomRange.value?.hours ?? customRange.value?.hours ?? DEFAULT_CUSTOM_RANGE_HOURS

  const view = availableViews.value.find(v => v.label === selectedView.value)
  return view?.hours || 1
})

function ensureDefaultCustomRange() {
  if (customStartInput.value && customEndInput.value)
    return

  const end = dayjs()
  const hours = Math.max(1, Math.min(DEFAULT_CUSTOM_RANGE_HOURS, maxPingRecordPreserveTime.value))
  customStartInput.value = end.subtract(hours, 'hour').format('YYYY-MM-DDTHH:mm')
  customEndInput.value = end.format('YYYY-MM-DDTHH:mm')
}

// 初始化默认视图
watch(availableViews, (views) => {
  const firstView = views[0]
  if (firstView && !selectedView.value) {
    selectedView.value = firstView.label
  }
}, { immediate: true })

// ==================== 数据状态 ====================
const remoteData = shallowRef<PingChartSample[]>([])
const metricLossSamples = shallowRef<PingChartSample[] | null>(null)
const tasks = shallowRef<PingTaskInfo[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const legacyCustomRangeFallback = ref(false)

// 任务选择
const selectedTaskIds = ref<number[]>([])
const hiddenLegendTaskIds = ref(new Set<number>())
const chartMetrics = [
  { value: 'latency', label: '延迟', icon: 'tabler:activity' },
  { value: 'loss', label: '丢包率', icon: 'tabler:cloud-exclamation' },
] as const
const chartMetric = ref<typeof chartMetrics[number]['value']>('latency')
const isLossChart = computed(() => chartMetric.value === 'loss')
const cutPeak = ref(false)
const isTouchTooltipMode = ref(false)
const activeTaskTooltipId = ref<number | null>(null)
const smoothInfoTooltipOpen = ref(false)
const touchTooltip = useTouchTooltipTrigger(isTouchTooltipMode, () => {
  activeTaskTooltipId.value = null
  smoothInfoTooltipOpen.value = false
})

const chartMargin = { top: 30, right: 24, bottom: 30, left: 56 }
let coarsePointerMediaQuery: MediaQueryList | null = null
let fetchRecordsSequence = 0

function syncTouchTooltipMode() {
  if (typeof window === 'undefined') {
    isTouchTooltipMode.value = false
    return
  }

  const hasCoarsePointer = window.matchMedia('(pointer: coarse)').matches
  const hasTouchPoints = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
  isTouchTooltipMode.value = hasCoarsePointer || hasTouchPoints
}

function setTaskTooltipOpen(taskId: number, open: boolean) {
  if (isTouchTooltipMode.value)
    return
  activeTaskTooltipId.value = open ? taskId : activeTaskTooltipId.value === taskId ? null : activeTaskTooltipId.value
}

function toggleTaskTooltip(taskId: number) {
  if (!isTouchTooltipMode.value)
    return

  activeTaskTooltipId.value = activeTaskTooltipId.value === taskId ? null : taskId
  smoothInfoTooltipOpen.value = false
}

function toggleSmoothInfoTooltip() {
  if (!isTouchTooltipMode.value)
    return

  smoothInfoTooltipOpen.value = !smoothInfoTooltipOpen.value
  if (smoothInfoTooltipOpen.value) {
    activeTaskTooltipId.value = null
  }
}

function normalizeMetricTaskId(taskId: string): number {
  if (!taskId.trim())
    return Number.NaN

  const numericTaskId = Number(taskId)
  if (Number.isFinite(numericTaskId))
    return numericTaskId

  let hash = 0
  for (let index = 0; index < taskId.length; index++)
    hash = (hash * 31 + taskId.charCodeAt(index)) | 0
  return Math.abs(hash)
}

function normalizeMetricTask(stat: PingMetricTaskStats): PingTaskInfo {
  return {
    id: normalizeMetricTaskId(stat.task_id),
    name: stat.name?.trim() || pingTaskName(stat) || `Task ${stat.task_id}`,
    interval: stat.interval ?? 0,
    loss: stat.loss,
    min: stat.min,
    max: stat.max,
    avg: stat.avg,
    latest: stat.latest,
    p50: stat.p50,
    p99: stat.p99,
    p99_p50_ratio: stat.p99_p50_ratio,
    stddev: stat.stddev,
    total: stat.total,
    valid: stat.valid,
    loss_approximate: stat.loss_approximate,
    type: stat.type,
  }
}

function buildMetricSamples(seriesList: NormalizedMetricSeries[], metric: string): PingChartSample[] {
  const samples: PingChartSample[] = []
  const isLoss = metric === PING_LOSS_METRIC

  for (const series of seriesList) {
    if (series.metric_key !== metric)
      continue
    const taskId = normalizeMetricTaskId(pingTaskId(series))
    if (!Number.isFinite(taskId))
      continue

    for (const point of series.points) {
      const value = point.value
      const valid = value !== null && Number.isFinite(value) && value >= 0 && (!isLoss || value <= 1)
      samples.push({
        task_id: taskId,
        time: point.time,
        value: valid ? value * (isLoss ? 100 : 1) : null,
      })
    }
  }

  return samples.sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
}

async function loadMetricPingPayload(nodeUuid: string) {
  const range = appliedCustomRange.value
  const metricRangeParams = isCustomRange.value && range
    ? { start: range.start.toDate().toISOString(), end: range.end.toDate().toISOString() }
    : { hours: selectedHours.value }

  const [statsResult, metricsResult, backendTasksResult] = await Promise.allSettled([
    loadPingMetricStats({ entity_id: nodeUuid, ...metricRangeParams, max_points: PING_RECORD_MAX_COUNT }),
    queryMetrics({
      metric_keys: [PING_LATENCY_METRIC, PING_LOSS_METRIC],
      entity_id: nodeUuid,
      ...metricRangeParams,
      downsample: true,
      fill_empty: true,
      max_points: PING_RECORD_MAX_COUNT,
      aggregation: 'avg',
    }),
    loadPublicPingTasks(),
  ])

  const metricStats = statsResult.status === 'fulfilled'
    ? (statsResult.value.stats ?? []).filter(stat => stat.entity_id === nodeUuid)
    : []
  const series = metricsResult.status === 'fulfilled'
    ? normalizeMetricSeriesList(metricsResult.value.series).filter(item => item.entity_id === nodeUuid)
    : []
  const records = buildMetricSamples(series, PING_LATENCY_METRIC)
  const lossSamples = buildMetricSamples(series, PING_LOSS_METRIC)
  const metricTaskIds = new Set<number>()
  for (const samples of [records, lossSamples]) {
    for (const sample of samples) {
      if (sample.value !== null)
        metricTaskIds.add(sample.task_id)
    }
  }
  const exactStatTaskIds = new Set(
    metricStats
      .filter(stat => stat.total > 0 && !stat.loss_approximate && Number.isFinite(stat.loss))
      .map(stat => normalizeMetricTaskId(stat.task_id)),
  )
  if (!metricTaskIds.size || [...metricTaskIds].some(taskId => !exactStatTaskIds.has(taskId)))
    return null

  return {
    records,
    lossSamples,
    tasks: orderPingTasksByBackend(
      metricStats.map(normalizeMetricTask),
      backendTasksResult.status === 'fulfilled' ? backendTasksResult.value : [],
    ),
  }
}

// ==================== 数据获取 ====================

async function fetchRecords() {
  const sequence = ++fetchRecordsSequence
  const requestedUuid = props.uuid
  if (!requestedUuid)
    return

  if (isCustomRange.value && !customRange.value) {
    remoteData.value = []
    metricLossSamples.value = null
    tasks.value = []
    error.value = customRangeError.value || '请选择有效的自定义时间范围'
    legacyCustomRangeFallback.value = false
    loading.value = false
    return
  }

  appliedCustomRange.value = isCustomRange.value ? customRange.value : null

  loading.value = true
  error.value = null

  try {
    const metricPayload = await loadMetricPingPayload(requestedUuid).catch(() => null)
    if (sequence !== fetchRecordsSequence || requestedUuid !== props.uuid)
      return

    legacyCustomRangeFallback.value = !metricPayload && isCustomRange.value
    const range = appliedCustomRange.value
    const legacyHours = range
      ? Math.min(
          maxPingRecordPreserveTime.value,
          Math.max(range.hours, Math.ceil(dayjs().diff(range.start, 'hour', true))),
        )
      : selectedHours.value
    const result = metricPayload ?? await loadPingRecordsWithTasks(legacyHours, PING_RECORD_MAX_COUNT, requestedUuid)
    if (sequence !== fetchRecordsSequence || requestedUuid !== props.uuid)
      return

    remoteData.value = metricPayload ? metricPayload.records : [...result.records].sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
    metricLossSamples.value = metricPayload?.lossSamples ?? null
    tasks.value = result.tasks

    if (tasks.value.length > 0 && selectedTaskIds.value.length === 0) {
      selectedTaskIds.value = tasks.value.map(t => t.id)
    }
  }
  catch (err) {
    if (sequence !== fetchRecordsSequence || requestedUuid !== props.uuid)
      return

    error.value = err instanceof Error ? err.message : '获取数据失败'
    legacyCustomRangeFallback.value = false
    remoteData.value = []
    metricLossSamples.value = null
    tasks.value = []
  }
  finally {
    if (sequence === fetchRecordsSequence)
      loading.value = false
  }
}

// ==================== 数据处理 ====================

function mergePingSamples(data: readonly PingChartSample[]): PingChartRow[] {
  if (!data.length)
    return []

  const taskList = tasks.value

  const taskIntervals = taskList
    .map(t => t.interval)
    .filter((v): v is number => typeof v === 'number' && v > 0)

  const fallbackIntervalSec = taskIntervals.length ? Math.min(...taskIntervals) : 60
  const toleranceMs = Math.min(
    6000,
    Math.max(800, Math.floor(fallbackIntervalSec * 1000 * 0.25)),
  )

  const grouped = new Map<number, PingChartRow>()
  const anchors: number[] = []

  for (const rec of data) {
    const ts = Date.parse(rec.time)
    if (!Number.isFinite(ts))
      continue
    let anchor: number | null = null

    for (let index = anchors.length - 1; index >= 0; index--) {
      const a = anchors[index]
      if (a === undefined || ts - a > toleranceMs)
        break
      if (Math.abs(a - ts) <= toleranceMs) {
        anchor = a
        break
      }
    }

    const useTs = anchor ?? ts
    if (!grouped.has(useTs)) {
      grouped.set(useTs, { time: dayjs(useTs).toISOString() })
      if (anchor === null) {
        anchors.push(useTs)
      }
    }

    const group = grouped.get(useTs)!
    const value = rec.value !== null && rec.value >= 0 ? rec.value : null
    // A padded bucket must not overwrite an observation grouped at the same time.
    group[rec.task_id] = value ?? group[rec.task_id] ?? null
  }

  const merged = [...grouped.values()]

  const range = appliedCustomRange.value
  if (isCustomRange.value && range) {
    const fromTs = range.start.valueOf()
    const toTs = range.end.valueOf()
    return merged.filter((item) => {
      const timestamp = Date.parse(item.time)
      return timestamp >= fromTs && timestamp <= toTs
    })
  }

  const hours = selectedHours.value
  const lastItem = merged.at(-1)
  const lastTs = lastItem ? Date.parse(lastItem.time) : Date.now()
  const fromTs = lastTs - hours * TIME_MS.hour

  let startIdx = 0
  for (let i = 0; i < merged.length; i++) {
    const item = merged[i]
    if (!item)
      continue
    const ts = Date.parse(item.time)
    if (ts >= fromTs) {
      startIdx = Math.max(0, i - 1)
      break
    }
  }

  return merged.slice(startIdx)
}

const latencyRows = computed(() => mergePingSamples(remoteData.value))
const legacyLossHistory = computed(() => {
  const range = appliedCustomRange.value
  const lastSample = remoteData.value.at(-1)
  const end = range?.end.valueOf() ?? (lastSample ? Date.parse(lastSample.time) : Date.now())
  const start = range?.start.valueOf() ?? end - selectedHours.value * TIME_MS.hour
  return buildLegacyPingLossHistory(remoteData.value, start, end)
})
const lossRows = computed(() => metricLossSamples.value === null
  ? legacyLossHistory.value.rows
  : mergePingSamples(metricLossSamples.value))

const chartData = computed(() => {
  if (!selectedTaskIds.value.length)
    return []
  if (isLossChart.value)
    return lossRows.value
  return cutPeak.value ? smoothPingChartDisplayRows(latencyRows.value, selectedTaskIds.value) : latencyRows.value
})

// ==================== 工具函数 ====================

function formatTime(time: string, showDate: boolean): string {
  const date = dayjs(time)
  if (showDate) {
    return date.format('M/D HH:mm')
  }
  return date.format('HH:mm')
}

function formatTimeForTooltip(time: string, hours: number): string {
  const date = dayjs(time)
  if (hours < 24) {
    return date.format('HH:mm:ss')
  }
  return date.format('MM/DD HH:mm')
}

const showDateInAxis = computed(() => selectedHours.value >= 24)

// ==================== 任务选择 ====================

// 获取任务颜色（根据任务在完整列表中的索引）
function getTaskColor(taskId: number): string {
  const taskIndex = tasks.value.findIndex(t => t.id === taskId)
  const safeIndex = Math.max(0, taskIndex % chartColors.length)
  return chartColors[safeIndex]!
}

// 最新值统计（从服务端 tasks 获取，保持颜色顺序）
const latestValues = computed(() => {
  if (!tasks.value.length)
    return []

  const latestMap = new Map<number, number | null>()
  for (const task of tasks.value) {
    for (let i = remoteData.value.length - 1; i >= 0; i--) {
      const rec = remoteData.value[i]
      if (rec?.task_id === task.id && rec.value !== null && rec.value >= 0) {
        latestMap.set(task.id, rec.value)
        break
      }
    }
  }

  return tasks.value.map((task, idx) => {
    const safeIdx = Math.max(0, idx % chartColors.length)
    return {
      ...task,
      latestValue: latestMap.get(task.id) ?? null,
      color: chartColors[safeIdx]!,
    }
  })
})

const selectedTasks = computed(() => {
  return tasks.value.filter(t => selectedTaskIds.value.includes(t.id))
})

const taskLabels = computed(() => pingChartTaskLabels(tasks.value))
const plottedTasks = computed(() => selectedTasks.value.map((task, index) => ({
  id: task.id,
  seriesName: String(task.id),
  label: taskLabels.value.get(task.id) ?? task.name,
  color: getTaskColor(task.id),
  lineType: appStore.colorVisionFriendly
    ? (ACCESSIBLE_LINE_TYPES[index % ACCESSIBLE_LINE_TYPES.length] ?? 'solid')
    : 'solid',
})))
const peakLoss = computed(() => {
  let peak: number | null = null
  for (const row of lossRows.value) {
    for (const task of selectedTasks.value) {
      const value = row[task.id]
      if (value != null && (peak === null || value > peak))
        peak = value
    }
  }
  return peak
})
const hasChart = computed(() => selectedTasks.value.length > 0 && (!isLossChart.value || peakLoss.value !== null))

function toggleLegendTask(taskId: number) {
  const hidden = hiddenLegendTaskIds.value
  if (hidden.has(taskId))
    hidden.delete(taskId)
  else
    hidden.add(taskId)
}

// 切换任务选中状态
function toggleTask(taskId: number) {
  if (selectedTaskIds.value.includes(taskId)) {
    selectedTaskIds.value = selectedTaskIds.value.filter(id => id !== taskId)
  }
  else {
    selectedTaskIds.value = [...selectedTaskIds.value, taskId]
  }
}

function showAllTasks() {
  selectedTaskIds.value = tasks.value.map(t => t.id)
}

function hideAllTasks() {
  selectedTaskIds.value = []
}

// ==================== 图表配置 ====================

// 通用 Tooltip 配置
const baseTooltipConfig = computed(() => ({
  trigger: 'axis' as const,
  confine: false,
  backgroundColor: chartThemeColors.value.tooltipBg,
  borderColor: 'transparent',
  borderWidth: 0,
  borderRadius: 6,
  textStyle: {
    color: chartThemeColors.value.text,
    fontSize: 12,
    lineHeight: 20,
  },
  extraCssText: `backdrop-filter: blur(5px);z-index:9;box-shadow:0 0 0 1px ${chartThemeColors.value.tooltipShadow}, 0 0 16px ${chartThemeColors.value.tooltipShadow}`,
  axisPointer: {
    type: 'cross' as const,
    crossStyle: {
      color: chartThemeColors.value.textTertiary,
    },
    lineStyle: {
      color: chartThemeColors.value.crosshairColor,
      width: 1,
      type: 'dashed' as const,
    },
    shadowStyle: {
      color: chartThemeColors.value.crosshairColor,
    },
  },
}))

const pingPlotOption = computed(() => {
  const taskList = plottedTasks.value
  const data = chartData.value
  const hours = selectedHours.value
  const loss = isLossChart.value

  // 按数据自身量级固定 Y 轴，避免自动缩放把小波动也拉满整幅图。
  const axisScale = loss ? undefined : resolvePingAxisScale(data, taskList.map(task => task.id))
  const lossMax = loss ? ([10, 25, 50, 100].find(max => max >= (peakLoss.value ?? 0)) ?? 100) : undefined

  // 构建 series，确保颜色与卡片一致
  const series = taskList.map(({ id, seriesName, color, lineType }) => {
    const values = data.map(d => d[id] as number | null ?? null)
    return {
      name: seriesName,
      type: 'line' as const,
      data: values,
      // 平滑曲线可能过冲出尖刺，钳制到 x 单调以保证圆润且不越过相邻采样点。
      smooth: loss ? false : cutPeak.value ? 0.5 : 0.35,
      smoothMonotone: 'x' as const,
      step: loss ? 'middle' as const : false,
      showSymbol: loss,
      showAllSymbol: loss,
      symbol: (_: unknown, { dataIndex }: { dataIndex: number }) =>
        values[dataIndex - 1] == null && values[dataIndex + 1] == null ? 'circle' : 'none',
      symbolSize: 5,
      connectNulls: false,
      lineStyle: { width: loss ? 1.75 : 1.5, color, cap: 'round' as const, type: lineType },
      itemStyle: { color }, // 确保 symbol 颜色一致
    }
  })

  const tasksBySeries = new Map(taskList.map(task => [task.seriesName, task]))

  return {
    animation: false,
    // 全局颜色设置（用于图例等）
    color: tasks.value.map((_, idx) => {
      const safeIdx = Math.max(0, idx % chartColors.length)
      return chartColors[safeIdx]!
    }),
    tooltip: {
      ...baseTooltipConfig.value,
      formatter: (params: unknown) => {
        const p = params as Array<{ seriesName: string, value: number | null, dataIndex: number }>
        if (!p.length)
          return ''
        const firstParam = p[0]
        if (!firstParam)
          return ''
        const rowData = data[firstParam.dataIndex]
        if (!rowData)
          return ''

        const time = rowData.time as string
        const timeStr = formatTimeForTooltip(time, hours)
        let html = `<div style="font-weight:600;margin-bottom:6px;color:${chartThemeColors.value.textSecondary}">${timeStr}</div>`
        html += '<div style="display:flex;flex-direction:column;gap:4px">'

        // 按探测值排序显示
        const sortedParams = [...p].sort((a, b) => (a.value ?? 0) - (b.value ?? 0))

        for (const item of sortedParams) {
          const task = tasksBySeries.get(item.seriesName)
          if (!task || typeof item.value !== 'number' || !Number.isFinite(item.value))
            continue

          const colorDot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${task.color};margin-right:8px;flex-shrink:0"></span>`
          const displayValue = loss ? `${Number(item.value.toFixed(2))}%` : `${Math.round(item.value)} ms`
          html += `<div style="display:flex;align-items:center">${colorDot}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapePingTooltip(task.label)}</span><span style="margin-left:auto;font-weight:600;margin-left:16px;font-variant-numeric:tabular-nums">${displayValue}</span></div>`
        }
        html += '</div>'
        return html
      },
    },
    grid: chartMargin,
    xAxis: {
      type: 'category',
      data: data.map(d => formatTime(d.time as string, showDateInAxis.value)),
      axisLabel: {
        hideOverlap: true,
        fontSize: 11,
        color: chartThemeColors.value.textSecondary,
        margin: 12,
      },
      axisLine: {
        show: true,
        lineStyle: { color: chartThemeColors.value.borderColor, width: 1 },
      },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      name: loss ? '丢包率' : '延迟 (ms)',
      min: loss ? 0 : axisScale?.min,
      max: loss ? lossMax : axisScale?.max,
      interval: lossMax === undefined ? undefined : lossMax / 5,
      nameTextStyle: { color: chartThemeColors.value.textSecondary },
      axisLabel: { fontSize: 11, color: chartThemeColors.value.textSecondary, formatter: loss ? '{value}%' : '{value}' },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: {
        lineStyle: {
          color: chartThemeColors.value.splitLineColor,
          type: 'dashed' as const,
        },
      },
    },
    series,
  }
})

const pingChartOption = computed(() => ({
  ...pingPlotOption.value,
  legend: {
    show: false,
    data: plottedTasks.value.map(task => task.seriesName),
    selected: Object.fromEntries(plottedTasks.value.map(task => [task.seriesName, !hiddenLegendTaskIds.value.has(task.id)])),
  },
}))

// ==================== 生命周期 ====================

watch(chartMetric, () => touchTooltip.reset())

watch(selectedView, () => {
  touchTooltip.reset()
  selectedTaskIds.value = []
  if (isCustomRange.value)
    ensureDefaultCustomRange()
  fetchRecords()
})

watch(() => props.uuid, () => {
  remoteData.value = []
  metricLossSamples.value = null
  tasks.value = []
  selectedTaskIds.value = []
  hiddenLegendTaskIds.value.clear()
  activeTaskTooltipId.value = null
  smoothInfoTooltipOpen.value = false
  fetchRecords()
})

onMounted(() => {
  syncTouchTooltipMode()
  coarsePointerMediaQuery = window.matchMedia('(pointer: coarse)')
  coarsePointerMediaQuery.addEventListener('change', syncTouchTooltipMode)

  const firstView = availableViews.value[0]
  if (firstView && !selectedView.value) {
    selectedView.value = firstView.label
  }
  fetchRecords()
})

onBeforeUnmount(() => {
  coarsePointerMediaQuery?.removeEventListener('change', syncTouchTooltipMode)
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- 时间选择器 -->
    <div class="flex flex-col gap-2">
      <Tabs v-model="selectedView" class="w-full items-center">
        <div class="min-w-0 flex-1 overflow-x-auto rounded-sm pointer-events-auto">
          <TabsList class="glass-control-surface h-8 w-max rounded-md">
            <TabsTrigger
              v-for="view in availableViews" :key="view.label" :value="view.label"
              class="glass-control-button h-6.5 flex-none shrink-0 rounded-sm border-none text-xs shadow-none"
            >
              {{ view.label }}
            </TabsTrigger>
          </TabsList>
        </div>
        <div class="md:flex-1" />
        <div class="flex gap-2 items-center">
          <Button
            variant="outline" size="xs" class="glass-control-surface glass-control-button h-7 rounded-sm shadow-none"
            :aria-pressed="tasks.length > 0 && selectedTaskIds.length === tasks.length"
            @click="showAllTasks"
          >
            全选
          </Button>
          <Button
            variant="outline" size="xs" class="glass-control-surface glass-control-button h-7 rounded-sm shadow-none"
            :aria-pressed="!selectedTaskIds.length"
            @click="hideAllTasks"
          >
            全不选
          </Button>
        </div>
      </Tabs>

      <div v-if="isCustomRange" class="flex w-full flex-col items-center gap-2 sm:flex-row sm:justify-center">
        <div class="grid w-full gap-2 sm:w-auto sm:grid-cols-[minmax(0,13rem)_minmax(0,13rem)_auto]">
          <Input
            v-model="customStartInput"
            type="datetime-local"
            aria-label="Ping 图开始时间"
            class="h-8 bg-background/50 text-xs"
          />
          <Input
            v-model="customEndInput"
            type="datetime-local"
            aria-label="Ping 图结束时间"
            class="h-8 bg-background/50 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            :disabled="!customRange"
            class="h-8 text-xs"
            @click="fetchRecords"
          >
            应用
          </Button>
        </div>
        <div v-if="customRangeError" class="text-[11px] text-orange-500">
          {{ customRangeError }}
        </div>
        <div v-else-if="legacyCustomRangeFallback" class="text-[11px] text-muted-foreground">
          旧接口按可用保留时长回溯，再裁剪到所选区间
        </div>
      </div>
    </div>

    <!-- 内容区域 -->
    <Spinner :show="loading" content-class="flex flex-col gap-4">
      <div v-if="error" class="text-red-500 py-8 text-center">
        {{ error }}
      </div>
      <div v-else-if="tasks.length === 0 && !loading" class="py-8">
        <Empty description="暂无探测数据" />
      </div>

      <template v-else>
        <!-- 最新值统计卡片（可点击切换选中状态） -->
        <div
          v-if="latestValues.length > 0" class="gap-3 grid"
          style="grid-template-columns: repeat(auto-fit, minmax(180px, 1fr))"
        >
          <div
            v-for="task in latestValues" :key="task.id"
            :data-ping-task-id="task.id"
            class="p-2 rounded-md bg-background/50 hover:bg-background hover:shadow-[0_0_0_2px] hover:shadow-primary/10 flex gap-3 cursor-pointer select-none transition-all items-center"
            :class="[!selectedTaskIds.includes(task.id) && 'ring-1 ring-inset ring-border/80']"
            :onmouseover="(e: MouseEvent) => ((e.currentTarget as HTMLElement).style.borderColor = task.color)"
            :onmouseout="(e: MouseEvent) => ((e.currentTarget as HTMLElement).style.borderColor = '')"
            @click="toggleTask(task.id)"
          >
            <div class="flex-1 min-w-0">
              <TooltipProvider>
                <div class="flex gap-2 items-center">
                  <div class="rounded h-4 w-1" :style="{ backgroundColor: task.color }" />
                  <span class="text-sm font-semibold truncate">{{ task.name }}</span>
                  <span v-if="!selectedTaskIds.includes(task.id)" class="shrink-0 text-[10px] text-muted-foreground">未显示</span>
                  <div class="flex-1" />
                  <Tooltip
                    :open="isTouchTooltipMode ? activeTaskTooltipId === task.id : undefined"
                    @update:open="(open) => setTaskTooltipOpen(task.id, open)"
                  >
                    <TooltipTrigger as-child>
                      <Button
                        data-ping-tooltip-trigger variant="ghost" size="icon-xs" class="text-muted-foreground"
                        @pointerdown="touchTooltip.pointerDown" @pointermove="touchTooltip.pointerMove" @pointercancel="touchTooltip.cancel"
                        @pointerup="touchTooltip.pointerUp($event, () => toggleTaskTooltip(task.id))"
                        @click="touchTooltip.click($event, () => toggleTaskTooltip(task.id))"
                      >
                        <Icon icon="carbon:information" :width="14" :height="14" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent class="!rounded p-3">
                      <div class="text-xs gap-x-4 gap-y-1.5 grid grid-cols-4">
                        <template v-if="task.min !== undefined">
                          <span class="text-primary-foreground/80">最小</span>
                          <span class="font-medium">{{ Math.round(task.min) }} ms</span>
                        </template>
                        <template v-if="task.max !== undefined">
                          <span class="text-primary-foreground/80">最大</span>
                          <span class="font-medium">{{ Math.round(task.max) }} ms</span>
                        </template>
                        <template v-if="task.avg !== undefined">
                          <span class="text-primary-foreground/80">平均</span>
                          <span class="font-medium">{{ Math.round(task.avg) }} ms</span>
                        </template>
                        <template v-if="task.latest !== undefined">
                          <span class="text-primary-foreground/80">最新</span>
                          <span class="font-medium">{{ Math.round(task.latest) }} ms</span>
                        </template>
                        <template v-if="task.p50 !== undefined">
                          <span class="text-primary-foreground/80">P50</span>
                          <span class="font-medium">{{ Math.round(task.p50) }} ms</span>
                        </template>
                        <template v-if="task.p99 !== undefined">
                          <span class="text-primary-foreground/80">P99</span>
                          <span class="font-medium">{{ Math.round(task.p99) }} ms</span>
                        </template>
                        <template v-if="task.p99_p50_ratio !== undefined">
                          <span class="text-primary-foreground/80">波动率</span>
                          <span class="font-medium">{{ task.p99_p50_ratio.toFixed(2) }}</span>
                        </template>
                        <template v-if="task.interval !== undefined">
                          <span class="text-primary-foreground/80">间隔</span>
                          <span class="font-medium">{{ task.interval }}s</span>
                        </template>
                        <template v-if="task.type">
                          <span class="text-primary-foreground/80">类型</span>
                          <span class="font-medium">{{ task.type.toUpperCase() }}</span>
                        </template>
                        <template v-if="task.stddev !== undefined">
                          <span class="text-primary-foreground/80">标准差</span>
                          <span class="font-medium">{{ task.stddev.toFixed(1) }}</span>
                        </template>
                        <template v-if="task.total !== undefined">
                          <span class="text-primary-foreground/80">总数</span>
                          <span class="font-medium">{{ task.total }}</span>
                        </template>
                        <template v-if="task.valid !== undefined">
                          <span class="text-primary-foreground/80">有效</span>
                          <span class="font-medium">{{ task.valid }}</span>
                        </template>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
              <div class="text-xs mt-1 flex gap-1.5 items-center text-muted-foreground">
                <span class="font-medium" title="平均延迟">
                  {{ task.avg !== undefined ? `${Math.round(task.avg)}ms` : '-' }}
                </span>
                <span class="opacity-60">·</span>
                <span title="丢包率">{{ task.loss.toFixed(2) }}%{{ task.loss_approximate ? '≈' : '' }}</span>
                <template v-if="task.p99_p50_ratio !== undefined">
                  <span class="opacity-60">·</span>
                  <span title="波动率">{{ task.p99_p50_ratio.toFixed(2) }}</span>
                </template>
              </div>
            </div>
          </div>
        </div>

        <section aria-label="Ping 趋势" class="glass-control-surface min-w-0 rounded-lg">
          <div class="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2.5 sm:px-4">
            <h3 class="flex items-center gap-2 text-sm font-semibold">
              <Icon icon="tabler:chart-line" class="size-4 text-muted-foreground" aria-hidden="true" />
              Ping 趋势
            </h3>
            <div role="group" aria-label="趋势指标" class="glass-control-surface inline-flex shrink-0 rounded-md p-0.5">
              <Button
                v-for="metric in chartMetrics" :key="metric.value" type="button" variant="ghost" size="xs"
                class="glass-control-button h-8 gap-1.5 rounded-sm px-2.5 text-xs sm:h-7"
                :aria-pressed="chartMetric === metric.value" @click="chartMetric = metric.value"
              >
                <Icon :icon="metric.icon" class="size-3.5" aria-hidden="true" />
                {{ metric.label }}
              </Button>
            </div>
          </div>
          <div
            :data-ping-history-chart="chartMetric"
            class="relative h-80 px-1.5 pb-3 pt-4 sm:px-4"
          >
            <div v-if="!hasChart" class="flex h-full items-center justify-center">
              <Empty :description="!selectedTasks.length ? '请选择要显示的探测任务' : '所选时段暂无丢包率数据'" />
            </div>
            <VChart v-else :option="pingChartOption" autoresize />
            <TooltipProvider>
              <div v-if="!isLossChart && selectedTasks.length" class="absolute right-4 top-2 flex items-center gap-1">
                <Button
                  type="button" variant="ghost" size="xs" class="glass-control-button h-7 rounded-sm"
                  :aria-pressed="cutPeak" @click="cutPeak = !cutPeak"
                >
                  平滑峰值
                </Button>
                <Tooltip
                  :open="isTouchTooltipMode ? smoothInfoTooltipOpen : undefined"
                  @update:open="(open) => { if (!isTouchTooltipMode) smoothInfoTooltipOpen = open }"
                >
                  <TooltipTrigger as-child>
                    <Button
                      data-ping-tooltip-trigger variant="ghost" size="icon-xs" class="text-muted-foreground" aria-label="平滑峰值说明"
                      @pointerdown="touchTooltip.pointerDown" @pointermove="touchTooltip.pointerMove" @pointercancel="touchTooltip.cancel"
                      @pointerup="touchTooltip.pointerUp($event, toggleSmoothInfoTooltip)"
                      @click="touchTooltip.click($event, toggleSmoothInfoTooltip)"
                    >
                      <Icon icon="carbon:information" :width="14" :height="14" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span>使用 EWMA 算法平滑显示，保留缺失时段；统计和历史原值不变</span>
                  </TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
            <p
              v-if="isLossChart && peakLoss !== null && metricLossSamples === null"
              class="pointer-events-none absolute right-4 top-3 text-[11px] text-muted-foreground"
            >
              每 {{ legacyLossHistory.bucketMinutes }} 分钟统计
            </p>
          </div>
          <div
            v-if="hasChart" role="group" aria-label="探测线路图例"
            class="flex flex-wrap justify-center gap-x-1.5 gap-y-1.5 border-t border-border/50 px-3 py-2.5 sm:gap-x-2 sm:px-4"
          >
            <Button
              v-for="task in plottedTasks" :key="task.id" type="button" variant="ghost" size="xs"
              class="h-auto min-h-7 max-w-full min-w-0 gap-2 px-2 py-1 text-left text-xs/4 font-normal whitespace-normal text-foreground/85 aria-pressed:border-border/50 aria-pressed:bg-muted/35 aria-[pressed=false]:border-dashed aria-[pressed=false]:border-border/40 aria-[pressed=false]:text-muted-foreground"
              :aria-pressed="!hiddenLegendTaskIds.has(task.id)" @click="toggleLegendTask(task.id)"
            >
              <span
                aria-hidden="true" class="w-4 shrink-0 border-t-2"
                :class="{ 'opacity-45': hiddenLegendTaskIds.has(task.id) }"
                :style="{ borderTopColor: task.color, borderTopStyle: task.lineType }"
              />
              <span class="min-w-0 [overflow-wrap:anywhere]">
                {{ task.label }}
              </span>
            </Button>
          </div>
        </section>
      </template>
    </Spinner>
  </div>
</template>
