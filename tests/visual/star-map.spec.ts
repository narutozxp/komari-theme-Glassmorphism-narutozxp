import { expect, test } from '@playwright/test'
import { installKomariFixture } from './fixtures/komari'

test('default map aggregates regions and supports keyboard, pointer, and group changes', async ({ page }) => {
  await installKomariFixture(page)
  await page.goto('/')

  const map = page.getByRole('region', { name: '节点地图' })
  const marker = map.locator('[data-map-marker-code="US"]')
  const boundary = map.locator('[data-map-region-code="US"]')
  const status = map.locator('[aria-live="polite"]')
  await expect(map).toContainText('8 个地区 · 11 / 12 个节点在线')
  await expect(map.locator('[data-map-marker-code="GB"]')).toHaveClass(/is-offline/)
  await marker.hover()
  await expect(boundary).toHaveClass(/is-active/)
  await expect(status).toContainText('2 / 2 个节点在线')
  await page.mouse.move(0, 0)
  await expect(boundary).not.toHaveClass(/is-active/)

  await marker.focus()
  await expect(boundary).toHaveClass(/is-active/)
  await marker.press('Enter')
  await expect(marker).toHaveAttribute('aria-pressed', 'true')
  await marker.press('Escape')
  await expect(marker).toHaveAttribute('aria-pressed', 'false')
  await expect(boundary).not.toHaveClass(/is-active/)

  await page.getByRole('tab', { name: '生产', exact: true }).click()
  await expect(map).toContainText('6 个地区 · 5 / 6 个节点在线')
  await expect(marker).toHaveAccessibleName(/1 \/ 1 个节点在线/)
})

test.describe('narrow touch layout', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true })

  test('map, quick filters, search, and view switching stay usable', async ({ page }) => {
    await installKomariFixture(page, { dark: true })
    await page.goto('/')
    const map = page.getByRole('region', { name: '节点地图' })
    await expect(map).toHaveCSS('border-top-color', 'rgba(155, 92, 255, 0.31)')
    const gb = map.locator('[data-map-marker-code="GB"]')
    await gb.tap()
    await expect(gb).toHaveAttribute('aria-pressed', 'true')
    await expect(map.locator('[aria-live="polite"]')).toContainText('0 / 1 个节点在线')

    const overload = page.getByRole('button', { name: /^高负载，/ })
    const all = page.getByRole('tab', { name: '全部节点' })
    await overload.tap()
    await expect(overload).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.node-card')).toHaveCount(1)

    const search = page.getByRole('textbox', { name: '搜索节点' })
    const visitorIp = page.getByRole('contentinfo').getByText('2001:db8::25', { exact: true }).filter({ visible: true })
    await expect(visitorIp.locator('..')).toHaveCSS('position', 'static')
    await search.tap()
    await expect(search).toBeFocused()
    await search.fill('无匹配')
    await expect(page.getByText('没有匹配的节点')).toBeVisible()
    await all.tap()
    await expect(overload).toHaveAttribute('aria-pressed', 'false')
    await expect(search).toHaveValue('')
    await expect(page.locator('.node-card')).toHaveCount(12)

    const list = page.getByRole('button', { name: '列表视图' })
    await list.tap()
    await expect(list).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情' })).toBeVisible()
    await expect(page.locator('.node-card')).toHaveCount(0)
    await page.getByRole('button', { name: '访客信息', exact: true }).tap()
    const visitorDetails = page.getByRole('region', { name: '访客信息', exact: true })
    await expect(visitorDetails).toHaveCSS('position', 'static')
    await expect(visitorDetails.getByText('Example Networks')).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
})

for (const disablePageAnimation of [false, true]) {
  test(`home and details stay navigable with reduced transitions ${disablePageAnimation}`, async ({ page }) => {
    const transitionWarnings: string[] = []
    page.on('console', (message) => {
      if (message.text().includes('renders non-element root node'))
        transitionWarnings.push(message.text())
    })
    await installKomariFixture(page, { themeSettingsOverrides: { disablePageAnimation } })
    await page.goto('/')
    await page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情' }).click()
    await expect(page.getByText('硬件信息', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: '返回首页' }).click()
    await expect(page.getByRole('region', { name: '节点地图' })).toBeVisible()
    await expect(page.locator('.node-card')).toHaveCount(12)
    expect(transitionWarnings).toEqual([])
  })
}

test('wide overview and controls align, with compact header actions', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 })
  await installKomariFixture(page, { loggedIn: true, groupNodeCount: true })
  await page.goto('/')
  const map = page.getByRole('region', { name: '节点地图' })
  const memory = page.locator('[data-general-card-key="memory"]')
  const quickFilters = page.getByRole('group', { name: '快捷筛选和排序' })
  const groups = page.getByRole('tablist', { name: '服务器分组' })
  const pingSettings = page.getByRole('button', { name: '按服务器配置 Ping 任务', exact: true })
  await expect(map).toBeVisible()
  await expect(memory).toBeVisible()
  await expect(pingSettings).toHaveText('')
  await pingSettings.hover()
  await expect(page.getByRole('tooltip', { name: '按服务器配置 Ping 任务' })).toBeVisible()

  const mapRect = (await map.boundingBox())!
  const memoryRect = (await memory.boundingBox())!
  const groupsRect = (await groups.boundingBox())!
  const filtersRect = (await quickFilters.boundingBox())!
  expect(mapRect.width).toBeGreaterThan(720)
  expect(mapRect.height).toBeLessThan(280)
  expect(groupsRect.x).toBeCloseTo(memoryRect.x, 0)
  expect(filtersRect.x + filtersRect.width).toBeCloseTo(mapRect.x + mapRect.width, 0)
  await page.getByRole('button', { name: '显示首页工具', exact: true }).click()
  const tools = page.getByRole('group', { name: '首页工具' })
  const cards = page.getByRole('button', { name: '卡片视图', exact: true })
  await expect(tools).toBeVisible()
  expect((await tools.boundingBox())!.height).toBeCloseTo((await cards.boundingBox())!.height, 0)
})

test('desktop visitor details can collapse independently of the IP bar', async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 900 })
  await installKomariFixture(page)
  await page.goto('/')
  const details = page.getByRole('region', { name: '访客信息', exact: true })
  const ipBar = page.getByRole('contentinfo').getByText('2001:db8::25', { exact: true }).first()
  await expect(details.getByText('Example Networks')).toBeVisible()
  await expect(ipBar.locator('..')).toHaveCSS('position', 'fixed')

  await details.getByRole('button', { name: '关闭访客信息' }).click()
  await expect(details).toBeHidden()
  await expect(ipBar).toBeVisible()
  const open = page.getByRole('button', { name: '访客信息', exact: true })
  await expect(open).toBeFocused()
  await open.press('Enter')
  await expect(details.getByRole('button', { name: '关闭访客信息' })).toBeFocused()
})
