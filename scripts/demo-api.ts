import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { FixturePingTask, VisualFixtureOptions } from '../tests/visual/fixtures/komari'
import { createKomariFixture, FIXED_NOW, fixtureVisitor } from '../tests/visual/fixtures/komari'
import { demoExtraRegions, demoNodeId } from './demo-nodes'

const themeSettingsPath = '/api/admin/theme/settings'
const isoTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

const demoNetworks: Array<Pick<FixturePingTask, 'id' | 'name' | 'type' | 'demoLatency' | 'dropEvery' | 'clients'>> = [
  { id: 20, name: '浙江电信 IPv4', type: 'icmp', demoLatency: 64 },
  { id: 21, name: '广东电信 IPv6', type: 'icmp', demoLatency: 96, dropEvery: 23 },
  { id: 22, name: '四川电信 TCP', type: 'tcp', demoLatency: 124, dropEvery: 13, clients: [demoNodeId(1), demoNodeId(3), demoNodeId(13)] },
  { id: 10, name: '江苏联通 IPv4', type: 'icmp', demoLatency: 73, dropEvery: 37 },
  { id: 11, name: '北京联通 TCP', type: 'tcp', demoLatency: 111, dropEvery: 18 },
  { id: 12, name: '山东联通 IPv6', type: 'icmp', demoLatency: 87 },
  { id: 30, name: '上海移动 IPv4', type: 'icmp', demoLatency: 58 },
  { id: 31, name: '广东移动 IPv6', type: 'icmp', demoLatency: 83, dropEvery: 28 },
  { id: 32, name: '湖北移动 HTTP', type: 'http', demoLatency: 146, dropEvery: 9 },
  { id: 40, name: '东京 NTT', type: 'icmp', demoLatency: 44 },
  { id: 41, name: '新加坡 Singtel', type: 'tcp', demoLatency: 67, dropEvery: 47 },
  { id: 42, name: '北京教育网 IPv6', type: 'icmp', demoLatency: 79 },
  { id: 43, name: '法兰克福 DE-CIX', type: 'tcp', demoLatency: 185 },
  { id: 44, name: '多伦多 Bell', type: 'icmp', demoLatency: 156, clients: [demoNodeId(1), demoNodeId(17)] },
  { id: 45, name: '圣保罗 IX.br', type: 'http', demoLatency: 221, dropEvery: 11, clients: [demoNodeId(17), demoNodeId(18)] },
]

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function sendJson(response: ServerResponse, value: unknown, status = 200): void {
  const timeOffset = Date.now() - Date.parse(FIXED_NOW)
  const body = JSON.stringify(value, (_key, field: unknown) => {
    if (typeof field === 'string' && isoTimePattern.test(field))
      return new Date(Date.parse(field) + timeOffset).toISOString()
    return field
  })
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(body)
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = ''
  for await (const chunk of request)
    raw += chunk
  const body: unknown = JSON.parse(raw)
  if (!isJsonObject(body))
    throw new TypeError('Expected a JSON object')
  return body
}

export function komariDemo(): Plugin {
  const options: VisualFixtureOptions = {
    dark: true,
    loggedIn: true,
    threeNetPing: true,
    groupNodeCount: true,
    extraRegions: demoExtraRegions,
    pingTasks: demoNetworks.map((task, weight) => ({ ...task, interval: 75, weight, loss: 0 })),
    threeNetTaskIds: JSON.stringify([20, 21, 10, 11, 30, 31, 40, 41, 42, 43]),
    threeNetNodeBindings: JSON.stringify({ [demoNodeId(1)]: [20, 22, 10, 30, 32, 40, 44] }),
    themeSettingsOverrides: { visitorInfoEnabled: true, stopEarth: false, disablePageAnimation: false },
  }
  const fixture = createKomariFixture(options)

  return {
    name: 'komari-demo',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const { pathname } = new URL(request.url ?? '/', 'http://localhost')
        if (!pathname.startsWith('/api/'))
          return next()

        try {
          switch (pathname) {
            case '/api/public': {
              const settings = fixture.publicSettings()
              settings.data.sitename = 'Komari 本地预览（演示数据）'
              sendJson(response, settings)
              return
            }
            case '/api/me':
              sendJson(response, { ...fixture.me(), username: 'preview' })
              return
            case '/api/version':
              sendJson(response, fixture.version())
              return
            case '/api/demo/visitor':
              sendJson(response, fixtureVisitor)
              return
            case '/api/rpc2': {
              const { id, method, params } = await readJson(request)
              if (typeof method !== 'string' || (params !== undefined && !isJsonObject(params)))
                throw new TypeError('Invalid RPC request')
              sendJson(response, fixture.rpc({ id, method, params }))
              return
            }
            case themeSettingsPath:
              if (request.method === 'POST') {
                options.themeSettingsOverrides = { ...options.themeSettingsOverrides, ...await readJson(request) }
                response.writeHead(204).end()
                return
              }
              break
          }
          sendJson(response, { message: '该接口在本地演示中不可用。' }, 404)
        }
        catch {
          sendJson(response, { message: '本地演示请求无效。' }, 400)
        }
      })
    },
  }
}
