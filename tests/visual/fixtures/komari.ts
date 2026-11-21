import type { Page } from '@playwright/test'

export const FIXED_NOW = '2026-07-25T12:00:00.000Z'
export const fixtureVisitor = { success: true, ip: '2001:db8::25', city: 'Tokyo', region: 'Tokyo', country: 'Japan', connection: { org: 'Example Networks' } }
const GIB = 1024 ** 3
const TIB = 1024 ** 4

const REGION_FIXTURES = [
  { code: 'US', name: '主控-洛杉矶', cpu: 'Intel Xeon Gold 6152 CPU @ 2.10GHz' },
  { code: 'HK', name: '香港边缘节点-超长名称布局测试', cpu: 'AMD EPYC 7551 32-Core Processor' },
  { code: 'JP', name: '东京-高负载', cpu: 'AMD EPYC 7B13 64-Core Processor' },
  { code: 'SG', name: '新加坡-A100', cpu: 'AMD EPYC 9654 96-Core Processor' },
  { code: 'DE', name: '法兰克福-2680', cpu: 'Intel Xeon CPU E5-2680 v4 @ 2.40GHz' },
  { code: 'GB', name: '伦敦-离线归档', cpu: 'Intel N100' },
  { code: 'TW', name: '台北-流量预警', cpu: 'Ampere Altra Max M128-30' },
  { code: 'AU', name: '悉尼-IPv6', cpu: 'AMD Ryzen 9 9950X 16-Core Processor' },
] as const

export interface FixtureRegion {
  code: string
  name: string
  cpu: string
}

export interface FixturePingTask {
  id: number
  name: string
  interval: number
  weight: number
  loss: number
  type?: string
  clients?: string[]
  demoLatency?: number
  dropEvery?: number
}

export interface VisualFixtureOptions {
  dark?: boolean
  earthRenderer?: 'starMap' | 'cobe' | 'realistic' | 'tiled'
  colorVisionFriendly?: boolean
  viewMode?: 'card' | 'list'
  nodeCardSize?: 'mini' | 'compact' | 'comfortable' | 'large'
  freePriceNode?: boolean
  hideEarth?: boolean
  expiryThresholds?: boolean
  missingCpuMetricHistory?: boolean
  pingTaskOrdering?: boolean
  generalCardKeys?: string[]
  fullChartDashboard?: boolean
  threeNetPing?: boolean
  threeNetSparkline?: boolean
  themeSettingsOverrides?: Record<string, unknown>
  threeNetTaskIds?: string
  threeNetNodeBindings?: string
  livePingOffset?: number
  livePingLoss?: number
  pingGaps?: boolean
  duplicateTaskNames?: boolean
  groupNodeCount?: boolean
  hiddenFirstNode?: boolean
  loggedIn?: boolean
  publicNodeIps?: boolean
  nodeIpOverrides?: Record<string, { ipv4: string, ipv6: string, region: string }>
  pingRetentionHours?: number
  extraRegions?: readonly FixtureRegion[]
  pingTasks?: readonly FixturePingTask[]
}

function uuidFor(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
}

function buildClients(options: VisualFixtureOptions) {
  const { freePriceNode, expiryThresholds, groupNodeCount: multipleGroups, extraRegions = [] } = options
  return Object.fromEntries(Array.from({ length: 12 + extraRegions.length }, (_, index) => {
    const fixture = extraRegions[index - 12] ?? REGION_FIXTURES[index % REGION_FIXTURES.length]!
    const uuid = uuidFor(index)
    return [uuid, {
      uuid,
      name: index < REGION_FIXTURES.length || index >= 12 ? fixture.name : `${fixture.name}-${index + 1}`,
      cpu_name: fixture.cpu,
      virtualization: index % 3 === 0 ? 'docker' : 'kvm',
      arch: index % 4 === 0 ? 'aarch64' : 'x86_64',
      cpu_cores: index % 4 + 1,
      cpu_physical_cores: Math.max(1, index % 3 + 1),
      os: index % 2 === 0 ? 'Ubuntu 24.04.4 LTS' : 'Debian GNU/Linux 12',
      kernel_version: '6.8.0-visual-test',
      gpu_name: index === 3 ? 'NVIDIA A100 80GB PCIe' : '',
      ipv4: `192.0.2.${index + 10}`,
      ipv6: `2001:db8:abcd:${index + 1}::${index + 10}`,
      region: fixture.code,
      public_remark: index === 1 ? '长备注用于验证文本换行与裁切' : '',
      mem_total: (index % 4 + 1) * GIB,
      swap_total: index % 3 === 0 ? 2 * GIB : 0,
      disk_total: (index % 3 + 1) * 40 * GIB,
      version: '1.2.6-visual',
      weight: index,
      price: freePriceNode && index === 0 ? -1 : index === 5 ? 0 : 9.9 + index,
      billing_cycle: 365,
      auto_renewal: index % 2 === 0,
      currency: 'USD',
      expired_at: expiryThresholds && index === 0
        ? '2026-07-30T12:00:00.000Z'
        : expiryThresholds && index === 1
          ? '2026-08-04T12:00:00.000Z'
          : index === 6 ? '2026-08-02T00:00:00.000Z' : '2027-07-25T00:00:00.000Z',
      group: index < 6 ? '生产' : multipleGroups ? '测试;边缘' : '测试,边缘',
      tags: index % 2 === 0 ? 'core<jade>,visual<blue>' : 'edge<orange>',
      hidden: false,
      traffic_limit: index === 6 ? 2 * TIB : 20 * TIB,
      traffic_limit_type: 'sum',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: FIXED_NOW,
    }]
  }))
}

function buildStatuses(count: number) {
  return Object.fromEntries(Array.from({ length: count }, (_, index) => {
    const uuid = uuidFor(index)
    const offline = index === 5
    const highLoad = index === 2
    const trafficWarning = index === 6
    const memTotal = (index % 4 + 1) * GIB
    const diskTotal = (index % 3 + 1) * 40 * GIB
    return [uuid, {
      client: uuid,
      time: FIXED_NOW,
      cpu: offline ? 0 : highLoad ? 96.4 : 8 + index * 2.7,
      gpu: index === 3 ? 72.5 : 0,
      gpu_count: index === 3 ? 1 : 0,
      gpu_average_usage: index === 3 ? 72.5 : 0,
      gpu_detailed_info: index === 3 ? [{ name: 'NVIDIA A100', utilization: 72.5, memory_total: 80 * GIB, memory_used: 52 * GIB, temperature: 61 }] : [],
      ram: offline ? 0 : Math.round(memTotal * (0.28 + index * 0.025)),
      ram_total: memTotal,
      swap: index % 3 === 0 ? (index + 1) * 64 * 1024 ** 2 : 0,
      swap_total: index % 3 === 0 ? 2 * GIB : 0,
      load: offline ? 0 : 0.18 + index * 0.11,
      load5: offline ? 0 : 0.14 + index * 0.09,
      load15: offline ? 0 : 0.1 + index * 0.07,
      temp: offline ? 0 : 36 + index,
      disk: Math.round(diskTotal * (0.18 + index * 0.035)),
      disk_total: diskTotal,
      net_in: offline ? 0 : 32_000 + index * 91_000,
      net_out: offline ? 0 : 18_000 + index * 63_000,
      net_total_up: (index + 1) * 45 * GIB,
      net_total_down: trafficWarning ? 1.78 * TIB : (index + 1) * 62 * GIB,
      traffic_up: (index + 1) * 3 * GIB,
      traffic_down: (index + 1) * 5 * GIB,
      process: offline ? 0 : 72 + index * 4,
      connections: offline ? 0 : 140 + index * 17,
      connections_udp: offline ? 0 : 8 + index,
      online: !offline,
      uptime: offline ? 0 : (index + 3) * 86_400,
      message: '',
      updated_at: FIXED_NOW,
      ping: {
        1: { name: 'Tokyo', latest: offline ? -1 : 42 + index * 13, avg: 50 + index * 11, tail: 88 + index * 14, loss: offline ? 100 : index * 2.3, min: 32, max: 260 },
      },
    }]
  }))
}

function buildRecords(uuid: string, statuses: ReturnType<typeof buildStatuses>) {
  const status = statuses[uuid] ?? statuses[uuidFor(0)]
  return Array.from({ length: 48 }, (_, index) => ({
    ...status,
    client: uuid,
    time: new Date(Date.parse(FIXED_NOW) - (47 - index) * 75_000).toISOString(),
    cpu: Math.max(1, Number(status.cpu) + Math.sin(index / 5) * 8),
    ram: Math.max(0, Number(status.ram) + index * 2 * 1024 ** 2),
    disk: Math.max(0, Number(status.disk) + index * 4 * 1024 ** 2),
    net_in: 80_000 + index * 12_000,
    net_out: 50_000 + index * 9_000,
  }))
}

const METRIC_KEYS = [
  'cpu.usage',
  'load.average',
  'memory.used',
  'memory.total',
  'swap.used',
  'swap.total',
  'temperature',
  'disk.used',
  'disk.total',
  'net.in.rate',
  'net.out.rate',
  'net.total.down',
  'net.total.up',
  'traffic.down',
  'traffic.up',
  'process.count',
  'connections.tcp',
  'connections.udp',
  'gpu.usage',
  'gpu.device.usage',
  'gpu.memory.used',
  'gpu.memory.total',
  'gpu.temperature',
  'ping.latency_ms',
  'ping.loss',
] as const

function metricValue(key: string, index: number): number {
  const values: Record<string, number> = {
    'cpu.usage': 22 + Math.sin(index / 4) * 12,
    'load.average': 0.45 + Math.sin(index / 6) * 0.2,
    'memory.used': 1.2 * GIB + index * 3 * 1024 ** 2,
    'memory.total': 4 * GIB,
    'swap.used': 260 * 1024 ** 2 + index * 1024 ** 2,
    'swap.total': 2 * GIB,
    'temperature': 44 + Math.sin(index / 5) * 5,
    'disk.used': 18 * GIB + index * 4 * 1024 ** 2,
    'disk.total': 80 * GIB,
    'net.in.rate': 420_000 + index * 13_000,
    'net.out.rate': 280_000 + index * 9_000,
    'net.total.down': 860 * GIB + index * 11 * GIB,
    'net.total.up': 540 * GIB + index * 8 * GIB,
    'traffic.down': 8 * GIB + index * 2 * GIB,
    'traffic.up': 5 * GIB + index * GIB,
    'process.count': 86 + index % 9,
    'connections.tcp': 220 + index * 2,
    'connections.udp': 12 + index % 4,
    'gpu.usage': 0,
    'gpu.device.usage': 0,
    'gpu.memory.used': 0,
    'gpu.memory.total': 0,
    'gpu.temperature': 0,
    'ping.latency_ms': 88 + Math.sin(index / 3) * 15,
    'ping.loss': index % 13 === 0 ? 8 : 1.5,
  }
  return values[key] ?? 0
}

function demoPingSample(task: FixturePingTask, uuid: string, index: number): number {
  const node = Number(uuid.slice(-12)) || 0
  if (task.dropEvery && (index + task.id + node) % task.dropEvery === 0)
    return -1
  const wave = Math.sin((index + task.id) / 4) * 8 + Math.cos(index / 7) * 4
  return Math.max(1, Math.round((task.demoLatency ?? 80) + node % 8 * 7 + wave))
}

function summarizeDemoPing(task: FixturePingTask, uuid: string) {
  const values = Array.from({ length: 48 }, (_, index) => demoPingSample(task, uuid, index))
  const valid = values.filter(value => value >= 0)
  return {
    total: values.length,
    valid: valid.length,
    avg: valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : undefined,
    min: valid.length ? Math.min(...valid) : undefined,
    max: valid.length ? Math.max(...valid) : undefined,
    latest: values.at(-1),
    loss: (values.length - valid.length) / values.length * 100,
  }
}

function pingTasksForNode(tasks: FixturePingTask[], uuid: string): FixturePingTask[] {
  return tasks.filter(task => !task.clients || task.clients.includes(uuid))
}

function getMetricPingTasks(options: VisualFixtureOptions, tasks: FixturePingTask[], uuid: string): FixturePingTask[] {
  if (options.pingTasks)
    return pingTasksForNode(tasks, uuid)
  return options.pingTaskOrdering ? [tasks[2]!, tasks[0]!, tasks[1]!] : tasks
}

function buildMetricResponse(
  payload: Record<string, unknown>,
  options: VisualFixtureOptions,
  pingTasks: FixturePingTask[],
) {
  const requested = Array.isArray(payload.metric_keys) ? payload.metric_keys.map(String) : METRIC_KEYS
  const uuid = typeof payload.entity_id === 'string' ? payload.entity_id : uuidFor(0)
  const points = Array.from({ length: 48 }, (_, index) => ({
    time: new Date(Date.parse(FIXED_NOW) - (47 - index) * 75_000).toISOString(),
    index,
  }))
  const metricPingTasks = getMetricPingTasks(options, pingTasks, uuid)
  const series = requested
    .filter(key => !options.missingCpuMetricHistory || key !== 'cpu.usage')
    .flatMap((key) => {
      const taskList = key.startsWith('ping.') ? metricPingTasks : [null]
      return taskList.map(task => ({
        metric_key: key,
        entity_id: uuid,
        type: 'gauge',
        tags: task ? { task_id: String(task.id), task_name: task.name } : {},
        points: points.map((point) => {
          if (task && options.pingTasks) {
            const sample = demoPingSample(task, uuid, point.index)
            return { time: point.time, value: key === 'ping.loss' ? Number(sample < 0) : sample >= 0 ? sample : null, count: 1 }
          }
          return {
            time: point.time,
            value: options.pingGaps && key === 'ping.latency_ms' && point.index >= 18 && point.index <= 30
              ? null
              : key === 'ping.loss' && options.threeNetPing ? 0.015 : metricValue(key, point.index) + (task?.id ?? 0),
          }
        }),
      }))
    })
  return { start: points[0].time, end: points.at(-1)?.time, series, count: series.length }
}

function jsonRpcResult(id: unknown, result: unknown) {
  return { jsonrpc: '2.0', id, result }
}

interface FixtureRpcRequest {
  id: unknown
  method: string
  params?: Record<string, unknown>
}

function handleRpc(payload: FixtureRpcRequest, clientFixtures: ReturnType<typeof buildClients>, statuses: ReturnType<typeof buildStatuses>, options: VisualFixtureOptions) {
  const { uuid: clientId, entity_id: entityId } = payload.params ?? {}
  const uuid = typeof clientId === 'string' ? clientId : options.pingTasks && typeof entityId === 'string' ? entityId : uuidFor(0)
  const pingTasks: FixturePingTask[] = options.pingTasks
    ? options.pingTasks.map(task => ({ ...task }))
    : options.pingTaskOrdering
      ? [
          { id: 30, name: '浙江移动', interval: 60, loss: 0, weight: 0 },
          { id: 10, name: '浙江联通', interval: 60, loss: 0, weight: 1 },
          { id: 20, name: '浙江电信', interval: 60, loss: 0, weight: 2 },
        ]
      : [{ id: 1, name: 'Tokyo', interval: 60, loss: 3.2, weight: 1 }]
  if (options.duplicateTaskNames) {
    pingTasks[0]!.name = '<img src=x onerror="window.__pingInjected=1">同名'
    pingTasks[1]!.name = pingTasks[0]!.name
  }
  const metricPingTasks = getMetricPingTasks(options, pingTasks, uuid)
  function buildPingResponse() {
    const requestedTask = Number(payload.params?.task_id)
    const tasks = options.pingTasks
      ? metricPingTasks.filter(task => !requestedTask || task.id === requestedTask)
      : pingTasks
    const records = tasks.flatMap(task => Array.from({ length: 48 }, (_, index) => ({
      task_id: task.id,
      client: uuid,
      time: new Date(Date.parse(FIXED_NOW) - (47 - index) * 75_000).toISOString(),
      value: options.pingTasks ? demoPingSample(task, uuid, index) : index % 17 === 0 ? -1 : 76 + index + task.id,
    })))
    return { count: options.pingTasks ? records.length : 48, records, tasks: options.pingTasks ? tasks : pingTasks }
  }
  let result: unknown

  switch (payload.method) {
    case 'rpc.ping':
      result = 'pong'
      break
    case 'common:getNodes':
      result = clientFixtures
      break
    case 'common:getNodesLatestStatus':
      result = options.threeNetPing
        ? Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id, {
            ...status,
            ping: Object.fromEntries(pingTasksForNode(pingTasks, id).map(task => [task.id, {
              name: task.name,
              latest: status.online ? 40 + task.id + (options.livePingOffset ?? 0) : -1,
              avg: 80 + task.id,
              min: 10,
              max: 200,
              tail: 100,
              loss: options.livePingLoss ?? (status.online ? 1.5 : 100),
              ...(options.pingTasks
                ? { ...summarizeDemoPing(task, id), ...(!status.online ? { latest: -1, loss: 100 } : {}) }
                : {}),
            }])),
          }]))
        : statuses
      break
    case 'common:getNodeRecentStatus':
      result = { count: 48, records: buildRecords(uuid, statuses) }
      break
    case 'common:getRecords':
      result = payload.params?.type === 'ping'
        ? buildPingResponse()
        : { count: 48, records: buildRecords(uuid, statuses) }
      break
    case 'public:getClientRecentRecords':
      result = buildRecords(uuid, statuses)
      break
    case 'public:getRecordsByUUID':
      result = { count: 48, records: buildRecords(uuid, statuses), load_type: 'all', has_gpu_data: false }
      break
    case 'public:getPingRecords':
      result = buildPingResponse()
      break
    case 'public:getPublicPingTasks':
      result = pingTasks
      break
    case 'public:listMetricDefinitions':
      result = METRIC_KEYS.map(name => ({ name, description: name, type: 'gauge', retention_days: 30 }))
      break
    case 'public:queryMetrics':
      result = buildMetricResponse(payload.params ?? {}, options, pingTasks)
      break
    case 'public:getPingMetricStats':
      result = options.pingTaskOrdering || options.pingTasks
        ? {
            start: FIXED_NOW,
            end: FIXED_NOW,
            interval_seconds: 60,
            stats: metricPingTasks.map(task => ({
              entity_id: uuid,
              task_id: String(task.id),
              name: task.name,
              interval: task.interval,
              tags: { task_id: String(task.id), task_name: task.name },
              total: options.threeNetPing ? 200 : 48,
              valid: options.threeNetPing ? 197 : 48,
              loss: options.threeNetPing ? 1.5 : 0,
              loss_approximate: false,
              min: 40 + task.id,
              max: 120 + task.id,
              avg: 80 + task.id,
              latest: 90 + task.id,
              ...(options.pingTasks ? summarizeDemoPing(task, uuid) : {}),
            })),
            count: metricPingTasks.length,
          }
        : { start: FIXED_NOW, end: FIXED_NOW, interval_seconds: 60, stats: [], count: 0 }
      break
    case 'public:getNodesInformation':
      result = Object.values(clientFixtures)
      break
    case 'public:getMe':
      result = { logged_in: options.loggedIn ?? false }
      break
    case 'public:getVersion':
    case 'common:getBackendVersion':
    case 'rpc.getVersion':
      result = { version: '1.2.6-visual', hash: 'visual' }
      break
    default:
      result = null
  }

  return jsonRpcResult(payload.id, result)
}

export function createKomariFixture(options: VisualFixtureOptions = {}) {
  const clientFixtures = buildClients(options)
  const statuses = buildStatuses(Object.keys(clientFixtures).length)
  if (options.hiddenFirstNode)
    clientFixtures[uuidFor(0)]!.hidden = true
  if (options.publicNodeIps) {
    clientFixtures[uuidFor(0)]!.ipv4 = '8.8.8.8'
    clientFixtures[uuidFor(0)]!.ipv6 = '2606:4700::1111'
  }
  for (const [uuid, values] of Object.entries(options.nodeIpOverrides ?? {})) {
    if (clientFixtures[uuid])
      Object.assign(clientFixtures[uuid], values)
  }
  const settings = {
    themeMode: options.dark ? 'dark' : 'light',
    dataUpdateInterval: options.threeNetPing ? 3 : 60,
    rpcTransportMode: 'http',
    defaultViewMode: options.viewMode ?? 'card',
    nodeCardSize: options.nodeCardSize ?? 'compact',
    ...(options.earthRenderer ? { earthRenderer: options.earthRenderer } : {}),
    hideEarth: options.hideEarth ?? false,
    stopEarth: true,
    visitorInfoEnabled: true,
    colorVisionMode: options.colorVisionFriendly ? '色觉友好' : '标准',
    hideAdminEntryWhenLoggedOut: false,
    hidePriceWhenLoggedOut: false,
    disablePageAnimation: true,
    homeQuickControlsEnabled: true,
    homeQuickControlPreset: '完整',
    homeToolsEnabled: true,
    groupNodeCountEnabled: options.groupNodeCount ?? false,
    ...(options.fullChartDashboard ? { chartDashboardPreset: '完整', gpuChartEnabled: true } : {}),
    ...(options.threeNetPing
      ? {
          threeNetPingEnabled: true,
          threeNetPingSparkline: options.threeNetSparkline ?? true,
          threeNetPingTaskIds: options.threeNetTaskIds ?? '[20,10,30]',
          threeNetPingNodeTaskBindings: options.threeNetNodeBindings ?? '{}',
        }
      : {}),
    generalCardPreset: '自定义',
    generalCardKeys: (options.generalCardKeys ?? (
      options.earthRenderer === 'tiled'
        ? ['onlineNodes', 'remainingValue', 'monthlyCost', 'totalTraffic', 'uploadSpeed', 'downloadSpeed']
        : ['memory', 'disk', 'remainingValue', 'totalTraffic', 'uploadSpeed', 'downloadSpeed']
    )).join('\n'),
  }

  return {
    publicSettings: () => ({
      status: 'success',
      message: 'ok',
      data: {
        allow_cors: true,
        custom_body: '',
        custom_head: '',
        description: '固定虚构节点视觉回归环境',
        disable_password_login: false,
        oauth_enable: false,
        oauth_provider: null,
        private_site: false,
        record_enabled: true,
        record_preserve_time: 720,
        ping_record_preserve_time: options.pingRetentionHours ?? 720,
        sitename: 'Komari Visual Lab',
        theme: 'Glassmorphism-Starlight',
        theme_settings: { ...settings, ...options.themeSettingsOverrides },
        visitor_audit_enabled: false,
      },
    }),
    me: () => ({ logged_in: options.loggedIn ?? false, username: 'visual-guest' }),
    version: () => ({ status: 'success', message: 'ok', data: { version: '1.2.6-visual', hash: 'visual' } }),
    rpc: (payload: FixtureRpcRequest) => handleRpc(payload, clientFixtures, statuses, options),
  }
}

export async function installKomariFixture(page: Page, options: VisualFixtureOptions = {}): Promise<void> {
  const fixture = createKomariFixture(options)
  await page.addInitScript(({ fixedNow }) => {
    localStorage.clear()
    sessionStorage.clear()
    const NativeDate = Date
    class FixedDate extends NativeDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        super(args.length ? args[0] : fixedNow)
      }

      static now() {
        return new NativeDate(fixedNow).getTime()
      }
    }
    globalThis.Date = FixedDate as DateConstructor
  }, { fixedNow: FIXED_NOW })

  await page.route('**/api/public', route => route.fulfill({ json: fixture.publicSettings() }))
  await page.route('**/api/me', route => route.fulfill({ json: fixture.me() }))
  await page.route('**/api/version', route => route.fulfill({ json: fixture.version() }))
  await page.route('**/rpc2', route => route.fulfill({ json: fixture.rpc(route.request().postDataJSON()) }))
  await page.route('https://ipwho.is/', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify(fixtureVisitor),
  }))
}
