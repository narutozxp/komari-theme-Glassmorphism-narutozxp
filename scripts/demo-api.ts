import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import type { VisualFixtureOptions } from '../tests/visual/fixtures/komari'
import { createKomariFixture, FIXED_NOW, fixtureVisitor } from '../tests/visual/fixtures/komari'

const themeSettingsPath = '/api/admin/theme/settings'
const isoTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

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
    pingTaskOrdering: true,
    groupNodeCount: true,
    threeNetNodeBindings: '{"00000000-0000-4000-8000-000000000001":[20,30]}',
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
