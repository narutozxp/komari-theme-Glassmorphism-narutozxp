import type { Locator } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { FIXED_NOW, installKomariFixture } from './fixtures/komari'

const UUID = '00000000-0000-4000-8000-000000000001'
const OTHER = '00000000-0000-4000-8000-000000000002'
const HIDDEN = '11111111-1111-4111-8111-111111111111'

async function chooseScope(dialog: Locator, scope: 'global' | 'node', mobile: boolean) {
  await dialog.getByRole('button', { name: scope === 'global' ? '全局任务' : '按服务器', exact: true }).click()
  if (scope === 'node') {
    if (mobile)
      await dialog.getByRole('combobox', { name: '选择服务器', exact: true }).selectOption(UUID)
    else
      await dialog.getByRole('button', { name: /^主控-洛杉矶(?: 自定义)?$/ }).click()
  }
}

test('downstream compact curves add only row height and keep the same card width', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 844 } })
  const dimensions: Array<{ width: number, height: number }> = []
  for (const mode of ['default', 'curves', 'bars'] as const) {
    const page = await context.newPage()
    await installKomariFixture(page, { hideEarth: true, pingTaskOrdering: true, threeNetPing: mode !== 'default', threeNetSparkline: mode === 'curves', themeSettingsOverrides: { threeNetPingLabelMode: 'full' } })
    await page.goto('/')
    await expect(page.locator('.node-card')).toHaveCount(12)
    if (mode !== 'default')
      await expect(page.locator('[data-three-net-task]')).toHaveCount(36)
    const rect = await page.locator('.node-card').first().boundingBox()
    dimensions.push({ width: rect!.width, height: rect!.height })
    if (mode === 'bars') {
      await expect(page.locator('[data-node-ping-bars="task-20-latency"]')).toHaveCount(12)
      await expect(page.locator('.sparkline')).toHaveCount(0)
    }
    await page.close()
  }
  expect(dimensions[1]!.width).toBe(dimensions[0]!.width)
  expect(dimensions[1]!.height - dimensions[0]!.height).toBe(24)
  expect(dimensions[2]!.height).toBeGreaterThan(dimensions[1]!.height)
  await context.close()
})

test('empty selection falls back to summary and standalone sparkline works', async ({ page }) => {
  await installKomariFixture(page, { hideEarth: true, pingTaskOrdering: true, threeNetPing: true, threeNetTaskIds: '[]' })
  await page.goto('/')
  await expect(page.locator('.node-card')).toHaveCount(12)
  await expect(page.locator('[data-three-net-task]')).toHaveCount(0)
  await expect(page.locator('.sparkline')).toHaveCount(12)
})

test('long full task names leave both Ping bar plots the same height', async ({ page }) => {
  const longName = '广东电信国际出口广州南沙骨干线路全称展示测试-IPv6-TCP-Server-Frankfurt'
  await installKomariFixture(page, {
    hideEarth: true,
    pingTaskOrdering: true,
    threeNetPing: true,
    threeNetSparkline: false,
    themeSettingsOverrides: { threeNetPingLabelMode: 'full' },
  })
  await page.route('**/rpc2', async (route) => {
    const request = route.request().postDataJSON()
    if (request.method !== 'public:getPublicPingTasks')
      return route.fallback()
    await route.fulfill({ json: {
      jsonrpc: '2.0',
      id: request.id,
      result: [{ id: 20, name: longName }, { id: 10, name: '联通' }, { id: 30, name: '移动' }],
    } })
  })
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情', exact: true })
  const name = card.getByText(longName, { exact: true })
  await expect(name).toBeVisible()
  for (const width of [1280, 360]) {
    await page.setViewportSize({ width, height: 844 })
    await expect(name).toHaveCSS('text-overflow', 'ellipsis')
    expect(await name.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
    const latency = card.locator('[data-node-ping-bars="task-20-latency"]')
    const heights = await Promise.all([latency, card.locator('[data-node-ping-bars="task-20-loss"]'), card.locator('[data-node-ping-bars="task-10-latency"]')].map(plot => plot.evaluate(element => element.getBoundingClientRect().height)))
    expect(heights[0]).toBeGreaterThan(0)
    expect(heights).toEqual([heights[0], heights[0], heights[0]])
    await expect(latency.locator('..')).toHaveAttribute('title', `${longName} · 最近一小时窗口平均延迟`)
  }
})

for (const mobile of [false, true]) {
  test(`task picker saves IDs and preserves latest settings on ${mobile ? 'mobile' : 'desktop'}`, async ({ page }) => {
    await page.setViewportSize({ width: mobile ? 390 : 1280, height: 844 })
    const options = {
      hideEarth: true,
      pingTaskOrdering: true,
      threeNetPing: true,
      loggedIn: true,
      threeNetNodeBindings: JSON.stringify({ [UUID]: [30], [HIDDEN]: [10] }),
      themeSettingsOverrides: {} as Record<string, unknown>,
    }
    const saves: Record<string, unknown>[] = []
    await installKomariFixture(page, options)
    await page.route('**/api/admin/theme/settings?theme=*', async (route) => {
      expect(new URL(route.request().url()).searchParams.get('theme')).toBe('Glassmorphism-Starlight')
      const body = route.request().postDataJSON()
      saves.push(body)
      options.themeSettingsOverrides = body
      await route.fulfill({ status: 204 })
    })
    await page.goto('/')
    await page.getByRole('button', { name: '按服务器配置 Ping 任务', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await chooseScope(dialog, 'node', mobile)
    await expect(dialog.getByRole('checkbox', { name: '浙江电信' })).toBeVisible()
    await dialog.getByRole('checkbox', { name: '浙江电信' }).check()
    // Simulate changes saved in another tab after this editor was opened.
    options.themeSettingsOverrides = {
      backgroundOverlay: 23,
      threeNetPingNodeTaskBindings: JSON.stringify({ [UUID]: [30], [HIDDEN]: [10], [OTHER]: [20] }),
    }
    await dialog.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '配置已保存', exact: true })).toBeDisabled()
    expect(saves).toHaveLength(1)
    expect(saves[0]!.backgroundOverlay).toBe(23)
    expect(saves[0]!.threeNetPingTaskIds).toBe('[20,10,30]')
    expect(JSON.parse(saves[0]!.threeNetPingNodeTaskBindings as string)).toEqual({ [UUID]: [30, 20], [HIDDEN]: [10], [OTHER]: [20] })
    await chooseScope(dialog, 'global', mobile)
    await expect(dialog.getByRole('complementary', { name: '服务器列表' })).toHaveCount(0)
    const restore = dialog.getByRole('button', { name: '恢复默认任务', exact: true })
    await expect(restore).toBeDisabled()
    await dialog.getByRole('checkbox', { name: '浙江联通' }).uncheck()
    await dialog.getByRole('button', { name: '选中全部可用', exact: true }).click()
    await expect(restore).toBeEnabled()
    await dialog.getByRole('button', { name: '清空选择', exact: true }).click()
    await expect(dialog.getByText('已选 0 个', { exact: true })).toBeVisible()
    await restore.click()
    await expect(dialog.getByRole('checkbox', { name: '浙江联通' })).toBeChecked()
    await expect(dialog.getByRole('button', { name: '配置已保存', exact: true })).toBeDisabled()
    await dialog.getByRole('checkbox', { name: '浙江联通' }).uncheck()
    await dialog.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect(dialog.getByRole('button', { name: '配置已保存', exact: true })).toBeDisabled()
    expect(saves[1]!.threeNetPingTaskIds).toBe('[20,30]')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `test-results/three-net-settings-${mobile ? 'mobile' : 'desktop'}.png` })
    options.loggedIn = false
    await dialog.getByRole('checkbox', { name: '曲线样式', exact: true }).uncheck()
    await dialog.getByRole('button', { name: '保存配置', exact: true }).click()
    await expect(dialog.getByText('登录状态已过期，请先登录管理员账号。', { exact: true })).toBeVisible()
    expect(saves).toHaveLength(2)
  })
}

test('guest has no theme settings entry', async ({ page }) => {
  await installKomariFixture(page, { hideEarth: true, threeNetPing: true, loggedIn: false })
  await page.goto('/')
  await expect(page.locator('.node-card')).toHaveCount(12)
  await expect(page.getByRole('button', { name: '按服务器配置 Ping 任务', exact: true })).toHaveCount(0)
})

for (const scope of ['node', 'global'] as const) {
  for (const catalog of ['normal', 'empty', 'error'] as const) {
    test(`unavailable Ping selections can be removed and saved: ${scope}, ${catalog} catalog`, async ({ page }) => {
      await page.setViewportSize({ width: scope === 'global' ? 390 : 1280, height: 844 })
      const options = {
        hideEarth: true,
        pingTaskOrdering: true,
        threeNetPing: true,
        loggedIn: true,
        threeNetTaskIds: '[30,7,10]',
        threeNetNodeBindings: JSON.stringify({ [UUID]: [30, 7, 10], [OTHER]: [20], [HIDDEN]: [7] }),
        themeSettingsOverrides: {} as Record<string, unknown>,
      }
      await installKomariFixture(page, options)
      if (catalog !== 'normal') {
        await page.route('**/rpc2', async (route) => {
          const payload = route.request().postDataJSON()
          if (payload.method !== 'public:getPublicPingTasks')
            return route.fallback()
          await route.fulfill({ json: {
            jsonrpc: '2.0',
            id: payload.id,
            ...(catalog === 'empty' ? { result: [] } : { error: { code: -32601, message: 'Catalog unavailable' } }),
          } })
        })
      }
      const saves: Record<string, unknown>[] = []
      await page.route('**/api/admin/theme/settings?theme=*', async (route) => {
        const body = route.request().postDataJSON()
        saves.push(body)
        options.themeSettingsOverrides = body
        await route.fulfill({ status: 204 })
      })
      await page.goto('/')
      await page.getByRole('button', { name: '按服务器配置 Ping 任务', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await chooseScope(dialog, scope, scope === 'global')
      const remove = dialog.getByRole('button', { name: '移除任务 ID 7', exact: true })
      await expect(remove).toBeVisible()
      // Neither failed/empty catalogs nor searching should silently change saved selections.
      await expect(dialog.getByRole('button', { name: '配置已保存', exact: true })).toBeDisabled()
      await dialog.getByPlaceholder('搜索 Ping 任务名称或 ID').fill('no-matching-task')
      await expect(remove).toBeVisible()
      if (catalog === 'normal') {
        await remove.scrollIntoViewIfNeeded()
        await page.screenshot({ path: `test-results/issue-62-${scope}.png` })
      }
      await remove.click()
      await expect(remove).toHaveCount(0)
      await dialog.getByPlaceholder('搜索 Ping 任务名称或 ID').fill('')
      if (catalog === 'normal') {
        await expect(dialog.getByRole('button', { name: '移除任务 ID 30', exact: true })).toHaveCount(0)
        await dialog.getByRole('checkbox', { name: '浙江电信' }).check()
      }
      else {
        await dialog.getByRole('button', { name: '移除任务 ID 30', exact: true }).click()
        await dialog.getByRole('button', { name: '移除任务 ID 10', exact: true }).click()
      }
      await dialog.getByRole('button', { name: '保存配置', exact: true }).click()
      await expect(dialog.getByRole('button', { name: '配置已保存', exact: true })).toBeDisabled()
      expect(saves).toHaveLength(1)
      const next = catalog === 'normal' ? [30, 10, 20] : []
      const bindings = JSON.parse(saves[0]!.threeNetPingNodeTaskBindings as string)
      expect(bindings[OTHER]).toEqual([20])
      expect(bindings[HIDDEN]).toEqual([7])
      if (scope === 'node') {
        expect(bindings[UUID]).toEqual(next.length ? next : undefined)
        expect(saves[0]!.threeNetPingTaskIds).toBe('[30,7,10]')
      }
      else {
        expect(bindings[UUID]).toEqual([30, 7, 10])
        expect(JSON.parse(saves[0]!.threeNetPingTaskIds as string)).toEqual(next)
      }
      await expect(dialog.getByRole('button', { name: '移除任务 ID 7', exact: true })).toHaveCount(0)
    })
  }
}

test('theme defaults and unlimited node overrides follow backend task assignments', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 })
  const options = {
    hideEarth: true,
    pingTaskOrdering: true,
    threeNetPing: true,
    threeNetTaskIds: '[30,10,20]',
    loggedIn: true,
    themeSettingsOverrides: { threeNetPingLabelMode: 'full' } as Record<string, unknown>,
  }
  const tasks = [
    { id: 30, name: '浙江移动', clients: [UUID] },
    { id: 10, name: '浙江联通', clients: [UUID, OTHER] },
    { id: 20, name: '浙江电信', clients: [UUID, OTHER] },
    { id: 40, name: '东京探测', clients: [UUID, OTHER] },
    { id: 50, name: '仅香港节点', clients: [OTHER] },
    { id: 60, name: '尚未分配', clients: [], default_on: true },
    { id: 70, name: '旧版本任务' },
  ]
  await installKomariFixture(page, options)
  await page.route('**/rpc2', async (route) => {
    const payload = route.request().postDataJSON()
    if (payload.method !== 'public:getPublicPingTasks')
      return route.fallback()
    await route.fulfill({ json: { jsonrpc: '2.0', id: payload.id, result: tasks } })
  })
  const saves: Record<string, unknown>[] = []
  await page.route('**/api/admin/theme/settings?theme=*', async (route) => {
    const settings = route.request().postDataJSON()
    saves.push(settings)
    options.themeSettingsOverrides = settings
    await route.fulfill({ status: 204 })
  })

  await page.goto('/')
  const settings = page.getByRole('button', { name: '按服务器配置 Ping 任务', exact: true })
  // The modal makes the cards aria-hidden while they continue to update.
  const first = page.locator('[aria-label="查看节点 主控-洛杉矶 详情"]')
  const second = page.locator('[aria-label="查看节点 香港边缘节点-超长名称布局测试 详情"]')
  await expect(second.locator('[data-three-net-task]')).toHaveCount(2)

  // Edit the same theme setting in the backend while this home page is open.
  options.themeSettingsOverrides = { threeNetPingTaskIds: '[20,10,30]', threeNetPingLabelMode: 'full' }
  await settings.click()
  const dialog = page.getByRole('dialog', { name: '首页 Ping 显示设置' })
  await dialog.getByRole('checkbox', { name: '东京探测', exact: true }).check()
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '配置已保存', exact: true })).toBeDisabled()
  expect(saves[0]!.threeNetPingTaskIds).toBe('[20,10,30,40]')
  await expect(first.locator('[data-three-net-task]')).toHaveCount(4)
  await expect(second.locator('[data-three-net-task="30"]')).toHaveCount(0)
  await expect(second.locator('[data-three-net-task="40"]')).toHaveCount(1)

  await chooseScope(dialog, 'node', false)
  await expect(dialog.getByText('沿用全局', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('checkbox', { name: /仅香港节点|尚未分配/ })).toHaveCount(0)
  await dialog.getByRole('button', { name: '选中全部可用', exact: true }).click()
  await expect(dialog.getByText('已选 5 个', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '配置已保存', exact: true })).toBeDisabled()
  expect(JSON.parse(saves[1]!.threeNetPingNodeTaskBindings as string)).toEqual({ [UUID]: [30, 10, 20, 40, 70] })
  await expect(first.locator('[data-three-net-task]')).toHaveCount(5)
  await expect(second.locator('[data-three-net-task="70"]')).toHaveCount(0)

  await dialog.getByRole('button', { name: '恢复全局默认', exact: true }).click()
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '配置已保存', exact: true })).toBeDisabled()
  expect(saves[2]!.threeNetPingNodeTaskBindings).toBe('{}')
  await expect(first.locator('[data-three-net-task]')).toHaveCount(4)

  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  tasks[3]!.clients = [UUID]
  await settings.click()
  await expect(second.locator('[data-three-net-task="40"]')).toHaveCount(0)
  await expect(first.locator('[data-three-net-task="40"]')).toHaveCount(1)
})

test('probe modes use only each node’s selected tasks for carrier and overall averages', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 })
  const options = {
    hideEarth: true,
    pingTaskOrdering: true,
    threeNetPing: true,
    threeNetTaskIds: '[20,21,10,30,50]',
    threeNetNodeBindings: JSON.stringify({ [OTHER]: [51] }),
    loggedIn: true,
    themeSettingsOverrides: {} as Record<string, unknown>,
  }
  const tasks = [
    { id: 20, name: '浙江电信', latency: 40, success: 2, total: 2 },
    { id: 21, name: '广东电信', latency: 100, success: 3, total: 4 },
    { id: 10, name: '浙江联通', latency: 70, success: 1, total: 2 },
    { id: 30, name: '广东移动', latency: 90, success: 1, total: 1 },
    { id: 50, name: '东京监测', latency: 200, success: 1, total: 1 },
    { id: 51, name: '上海电信', latency: 900, success: 1, total: 1 },
  ]
  await installKomariFixture(page, options)
  await page.route('**/rpc2', async (route) => {
    const { id, method, params } = route.request().postDataJSON()
    let result
    if (method === 'public:getPublicPingTasks') {
      result = tasks.map(task => ({ id: task.id, name: task.name, clients: [UUID, OTHER] }))
    }
    else if (method === 'public:getPingMetricStats') {
      result = {
        stats: tasks.map(task => ({
          entity_id: params.entity_id,
          task_id: String(task.id),
          avg: task.latency,
          valid: task.success,
          total: task.total,
          loss: (task.total - task.success) / task.total * 100,
          loss_approximate: false,
        })),
      }
    }
    else if (method === 'public:queryMetrics' && params.metric_keys?.includes('ping.latency_ms')) {
      result = {
        series: tasks.flatMap(task => params.metric_keys.map((key: string) => ({
          metric_key: key,
          entity_id: params.entity_id,
          type: 'gauge',
          tags: { task_id: String(task.id), task_name: task.name },
          points: [{
            time: FIXED_NOW,
            value: key === 'ping.loss' ? (task.total - task.success) / task.total : task.latency,
            count: key === 'ping.loss' ? task.total : task.success,
          }],
        }))),
      }
    }
    else {
      return route.fallback()
    }
    await route.fulfill({ json: { jsonrpc: '2.0', id, result } })
  })
  await page.route('**/api/admin/theme/settings?theme=*', async (route) => {
    options.themeSettingsOverrides = route.request().postDataJSON()
    await route.fulfill({ status: 204 })
  })
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情' })
  const telecom = card.locator('[data-ping-summary="telecom"]')
  await expect(card.locator('[data-ping-summary]')).toHaveCount(3)
  await expect(telecom).toContainText('76 ms')
  await expect(telecom).toContainText('16.7%')
  await expect(card.locator('[data-ping-summary="unicom"]')).toContainText('70 ms')
  await expect(card.locator('[data-ping-summary="mobile"]')).toContainText('90 ms')
  const history = telecom.getByRole('button', { name: /历史延迟/ })
  await history.press('ArrowLeft')
  await expect(telecom.locator('[data-three-net-history]')).toContainText('延迟 76 ms')
  await expect(telecom.locator('[data-three-net-history]')).toContainText('丢包 16.7%')
  await history.press('Escape')
  await expect(card.getByText('$9.9', { exact: true })).toBeVisible()

  const settings = page.getByRole('button', { name: '按服务器配置 Ping 任务', exact: true })
  const dialog = page.getByRole('dialog')
  await settings.click()
  const displayMode = dialog.getByRole('combobox', { name: '探测显示方式' })
  await displayMode.selectOption('full')
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '配置已保存', exact: true })).toBeDisabled()
  expect(options.themeSettingsOverrides.threeNetPingLabelMode).toBe('full')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await expect(card.locator('[data-three-net-task]')).toHaveCount(5)
  await expect(card.locator('[data-three-net-task="20"]')).toContainText('浙江电信')
  await expect(card.locator('[data-three-net-task="21"]')).toContainText('广东电信')
  await expect(card.locator('[data-three-net-task="50"]')).toContainText('东京监测')
  await expect(card.locator('[data-three-net-task="51"]')).toHaveCount(0)

  await settings.click()
  await displayMode.selectOption('summary')
  await dialog.getByRole('checkbox', { name: '曲线样式', exact: true }).uncheck()
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click()
  await expect(dialog.getByRole('button', { name: '配置已保存', exact: true })).toBeDisabled()
  expect(options.themeSettingsOverrides.threeNetPingEnabled).toBe(false)
  expect(options.themeSettingsOverrides.threeNetPingTaskIds).toBe('[20,21,10,30,50]')
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  const selected = card.locator('[data-ping-summary="selected"]')
  await expect(selected).toContainText('所选任务平均')
  await expect(selected).toContainText('93 ms')
  await expect(selected).toContainText('20.0%')
  await expect(page.getByRole('button', { name: '查看节点 香港边缘节点-超长名称布局测试 详情' }).locator('[data-ping-summary="selected"]')).toContainText('900 ms')
})
