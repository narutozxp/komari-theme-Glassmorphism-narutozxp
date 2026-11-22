import { expect, test } from '@playwright/test'
import { installKomariFixture } from './fixtures/komari'

test('quick filters and sorting place cards in their final grid slots immediately', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installKomariFixture(page, { themeSettingsOverrides: { disablePageAnimation: false } })
  await page.goto('/')
  const card = page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情', exact: true })
  await card.getByRole('button', { name: '收藏 主控-洛杉矶', exact: true }).click()
  const controls = page.getByRole('group', { name: '快捷筛选和排序' })
  const cards = page.locator('.node-card')
  await expect(cards).toHaveCount(12)

  for (const [label, count] of [['收藏', 1], ['总流量', 12], ['峰值', 12]] as const) {
    const frames = await controls.getByRole('button', { name: new RegExp(`^${label}，`) }).evaluate(async (button) => {
      const control = button as HTMLButtonElement
      const existing = document.querySelector('.node-card[aria-label*="主控-洛杉矶 详情"]')
      const read = () => {
        const cards = [...document.querySelectorAll('.node-card')]
        return {
          retained: Boolean(existing && cards.includes(existing)),
          positions: cards.map(card => [card.getAttribute('aria-label'), Math.round(card.getBoundingClientRect().left)]),
        }
      }
      control.click()
      const frames = []
      const start = performance.now()
      while (performance.now() - start < 300) {
        await new Promise(requestAnimationFrame)
        frames.push(read())
      }
      return frames
    })
    const final = frames.at(-1)!
    expect(final.positions).toHaveLength(count)
    expect(final.retained).toBe(true)
    const shiftedFrame = frames.find(frame => !frame.retained || JSON.stringify(frame.positions) !== JSON.stringify(final.positions))
    expect(shiftedFrame, `${label} settled at ${JSON.stringify(final)}`).toBeUndefined()
  }
})

test('default map aggregates regions and supports keyboard, pointer, and group changes', async ({ page }) => {
  await installKomariFixture(page)
  await page.goto('/')

  const map = page.getByRole('region', { name: '节点地图' })
  const marker = map.locator('[data-map-marker-code="US"]')
  const boundary = map.locator('[data-map-region-code="US"]')
  const status = map.locator('[aria-live="polite"]')
  const summary = map.getByRole('button', { name: /查看地区详情.*8 个地区 · 11 \/ 12 个节点在线/ })
  await summary.press('Enter')
  const details = page.getByRole('dialog', { name: '地区详情', exact: true })
  const usa = details.getByRole('button', { name: '美国 2 / 2 在线', exact: true })
  await expect(usa.locator('img')).toHaveAttribute('src', '/images/flags/US.svg')
  const uk = details.getByRole('button', { name: '英国 0 / 1 在线', exact: true })
  await expect(uk.locator('img')).toHaveAttribute('src', '/images/flags/GB.svg')
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  await expect(summary).toBeFocused()
  await expect(map.locator('[data-map-marker-code="GB"]')).toHaveClass(/is-offline/)
  await marker.hover()
  await expect(boundary).toHaveClass(/is-active/)
  await expect(status).toContainText('2 / 2 个节点在线')
  await page.mouse.move(0, 0)
  await expect(boundary).not.toHaveClass(/is-active/)

  await marker.focus()
  await expect(boundary).toHaveClass(/is-active/)
  await marker.press('Enter')
  const states = map.getByRole('group', { name: '美国省州节点分布' })
  await expect(states.locator('[data-map-province-code="US-CA"]')).toBeVisible()
  await expect(states.locator('[data-map-marker-code]')).toHaveCount(0)
  await expect(status).toContainText('节点仅定位到国家或地区')
  await map.getByRole('button', { name: /查看地区详情.*仅国家定位/ }).press('Enter')
  await expect(page.getByRole('dialog', { name: '美国省州详情' }).getByText('仅定位到国家或地区').locator('..')).toContainText('2 / 2 在线')
  await page.keyboard.press('Escape')
  await map.getByRole('button', { name: '返回全球' }).press('Enter')
  await expect(marker).toBeFocused()

  await page.getByRole('tab', { name: '生产', exact: true }).click()
  await expect(map).toContainText('6 个地区 · 5 / 6 个节点在线')
  await expect(marker).toHaveAccessibleName(/1 \/ 1 个节点在线/)
})

test('province map combines explicit regions and IP lookup, with a country-only count', async ({ page }) => {
  const uuid = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`
  await installKomariFixture(page, {
    loggedIn: true,
    nodeIpOverrides: {
      [uuid(1)]: { ipv4: '8.8.8.8', ipv6: '', region: 'CN' },
      [uuid(2)]: { ipv4: '1.1.1.1', ipv6: '', region: 'CN' },
      [uuid(6)]: { ipv4: '', ipv6: '', region: 'CN' },
    },
    extraRegions: [{ code: 'CN-SH', name: '上海-演示', cpu: 'AMD EPYC' }],
  })
  await page.route('https://api.ip.sb/geoip/*', (route) => {
    const first = route.request().url().endsWith('8.8.8.8')
    return route.fulfill({ json: {
      country_code: 'CN',
      region: first ? 'Guangdong' : '广东省',
      city: first ? 'Guangzhou' : 'Shenzhen',
      latitude: first ? 23.13 : 22.54,
      longitude: first ? 113.26 : 114.06,
    } })
  })
  await page.goto('/')
  const map = page.getByRole('region', { name: '节点地图' })
  const china = map.getByRole('button', { name: '中国，3 / 4 个节点在线，查看省州分布' })
  await china.press('Enter')
  await expect(map.getByRole('group', { name: '中国省州节点分布' })).toBeVisible()
  await expect(map.getByRole('button', { name: '广东省，2 / 2 个节点在线' })).toBeVisible()
  const summary = map.getByRole('button', { name: /查看地区详情.*2 个省州 · 3 \/ 4 个节点在线/ })
  await expect(summary).toBeFocused()
  await summary.press('Enter')
  const details = page.getByRole('dialog', { name: '中国省州详情' })
  await expect(details.getByText('仅定位到国家或地区').locator('..')).toContainText('0 / 1 在线')
  await details.getByRole('button', { name: '上海市 1 / 1 在线', exact: true }).click()
  const shanghai = map.getByRole('button', { name: '上海市，1 / 1 个节点在线' })
  await expect(shanghai).toHaveAttribute('aria-pressed', 'true')
  const status = map.locator('[aria-live="polite"]')
  await expect(status.getByText('上海市', { exact: true })).toBeVisible()
  await expect(status).toContainText('1 / 1 个节点在线')
  await expect(map.locator('[data-map-province-code="CN-SH"]')).toHaveClass(/is-active/)
  await expect(map.locator('[data-map-province-code="CN-GD"]')).not.toHaveClass(/is-active/)
  expect(await map.locator('[data-map-province-code]').count()).toBeGreaterThan(29)
  await shanghai.press('Escape')
  await expect(china).toBeFocused()
})

test('state map fits the drawing area after a viewport resize', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 850 })
  await installKomariFixture(page, {
    loggedIn: true,
    nodeIpOverrides: {
      '00000000-0000-4000-8000-000000000001': { ipv4: '8.8.8.8', ipv6: '', region: 'US' },
    },
  })
  await page.route('https://api.ip.sb/geoip/*', route => route.fulfill({ json: {
    latitude: 34.05,
    longitude: -118.24,
    country_code: 'US',
    region: 'California',
  } }))
  await page.goto('/')
  const map = page.getByRole('region', { name: '节点地图' })
  const usa = map.getByRole('button', { name: /美国.*查看省州分布/ })
  const worldDot = usa.locator('.star-map__dot')
  await expect(worldDot).toBeVisible()
  const desktopDot = (await worldDot.boundingBox())!.width
  await usa.press('Enter')
  const svg = map.getByRole('group', { name: '美国省州节点分布' })
  const california = svg.getByRole('button', { name: /加利福尼亚州.*1 \/ 1/ })
  const stateDot = california.locator('.star-map__dot')
  await expect(svg.locator('[data-map-province-code="US-CA"]')).toHaveClass(/is-active/)
  await expect(svg.locator('[data-map-province-code="US-NY"]')).toHaveAttribute('d', /^M/)
  expect((await stateDot.boundingBox())!.width).toBeCloseTo(desktopDot, 1)
  const desktopWidth = (await svg.boundingBox())!.width
  await page.setViewportSize({ width: 360, height: 780 })
  await expect.poll(() => svg.evaluate((element) => {
    const svg = element as unknown as SVGSVGElement
    const bounds = svg.getBoundingClientRect()
    const view = svg.viewBox.baseVal
    return bounds.width < 360 && Math.abs(view.width - bounds.width) < 1 && Math.abs(view.height - bounds.height) < 1
  })).toBe(true)
  const svgBox = (await svg.boundingBox())!
  const pinBox = (await california.boundingBox())!
  expect(svgBox.width).toBeLessThan(desktopWidth)
  expect(pinBox.x).toBeGreaterThan(svgBox.x)
  expect(pinBox.x + pinBox.width).toBeLessThan(svgBox.x + svgBox.width)
  expect(pinBox.y).toBeGreaterThan(svgBox.y)
  expect(pinBox.y + pinBox.height).toBeLessThan(svgBox.y + svgBox.height)
  const mobileDot = (await stateDot.boundingBox())!.width
  await map.getByRole('button', { name: '返回全球', exact: true }).click()
  await expect(worldDot).toBeVisible()
  expect((await worldDot.boundingBox())!.width).toBeCloseTo(mobileDot, 1)
})

test.describe('narrow touch layout', () => {
  test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true })

  test('public province codes support touch without IP lookup', async ({ page }) => {
    let geoCalls = 0
    await page.route('https://api.ip.sb/geoip/*', async (route) => {
      geoCalls++
      await route.abort()
    })
    await installKomariFixture(page, {
      extraRegions: [
        { code: 'CN-BJ', name: '北京-演示', cpu: 'AMD EPYC' },
        { code: 'CN-GD', name: '广东-演示', cpu: 'AMD EPYC' },
      ],
    })
    await page.goto('/')
    const map = page.getByRole('region', { name: '节点地图' })
    await map.getByRole('button', { name: /查看地区详情/ }).tap()
    await page.getByRole('dialog', { name: '地区详情', exact: true }).getByRole('button', { name: '中国 2 / 2 在线', exact: true }).tap()
    const regionalSvg = map.getByRole('group', { name: '中国省州节点分布' })
    await expect(regionalSvg.locator('[data-map-province-code="CN-GD"]')).toBeVisible()
    await expect.poll(() => regionalSvg.evaluate((element) => {
      const svg = element as unknown as SVGSVGElement
      const box = svg.getBoundingClientRect()
      const view = svg.viewBox.baseVal
      return Math.abs(view.width - box.width) < 1 && Math.abs(view.height - box.height) < 1
    })).toBe(true)
    const guangdong = map.getByRole('button', { name: '广东省，1 / 1 个节点在线' })
    await guangdong.tap()
    await expect(guangdong).toHaveAttribute('aria-pressed', 'true')
    await expect(map.locator('[data-map-province-code="CN-GD"]')).toHaveClass(/is-active/)
    await map.getByRole('button', { name: '返回全球', exact: true }).tap()
    await expect(map.getByRole('group', { name: '节点地区分布' })).toBeVisible()
    expect(geoCalls).toBe(0)
  })

  test('map, quick filters, search, and view switching stay usable', async ({ page }) => {
    await installKomariFixture(page, { dark: true })
    await page.goto('/')
    const map = page.getByRole('region', { name: '节点地图' })
    await expect(map).toHaveCSS('border-top-color', 'rgba(155, 92, 255, 0.31)')
    const gb = map.locator('[data-map-marker-code="GB"]')
    await gb.tap()
    await expect(map.getByRole('group', { name: '英国省州节点分布' })).toBeVisible()
    await expect(map.getByRole('button', { name: /仅国家定位.*0 \/ 1 个节点在线/ })).toBeVisible()
    await map.getByRole('button', { name: '返回全球' }).tap()

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

test('wide home and detail align with consistently sized toolbar actions', async ({ page }) => {
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
  const overviewRect = (await memory.locator('..').boundingBox())!
  const mapShapeRect = (await map.locator('.star-map__regions').boundingBox())!
  const groupsRect = (await groups.boundingBox())!
  const filtersRect = (await quickFilters.boundingBox())!
  expect(overviewRect.width).toBeGreaterThan(mapRect.width)
  expect(mapShapeRect.width / mapRect.width).toBeGreaterThan(0.9)
  expect(mapRect.height).toBeLessThan(240)
  expect(groupsRect.x).toBeCloseTo(memoryRect.x, 0)
  expect(filtersRect.x + filtersRect.width).toBeCloseTo(mapRect.x + mapRect.width, 0)
  await page.getByRole('button', { name: '显示首页工具', exact: true }).click()
  const tools = page.getByRole('group', { name: '首页工具' })
  const cards = page.getByRole('button', { name: '卡片视图', exact: true })
  const list = page.getByRole('button', { name: '列表视图', exact: true })
  await expect(tools).toBeVisible()
  const cardButton = (await cards.boundingBox())!
  const listButton = (await list.boundingBox())!
  expect(cardButton.x + cardButton.width).toBeLessThan(listButton.x)
  expect((await tools.boundingBox())!.x).toBeGreaterThan(listButton.x + listButton.width)
  for (const button of await tools.getByRole('button').all()) {
    const toolButton = (await button.boundingBox())!
    expect(toolButton.width).toBeCloseTo(cardButton.width, 0)
    expect(toolButton.height).toBeCloseTo(cardButton.height, 0)
    expect(toolButton.y).toBeCloseTo(cardButton.y, 0)
    await expect(button.locator('svg')).toHaveCSS('width', '16px')
  }

  await page.getByRole('button', { name: '查看节点 主控-洛杉矶 详情' }).click()
  await expect(page.getByText('节点价格', { exact: true })).toBeVisible()
  const detailHeader = page.getByRole('button', { name: '返回首页' }).locator('..')
  const detailRect = (await detailHeader.boundingBox())!
  expect(detailRect.x).toBeCloseTo(memoryRect.x, 0)
  expect(detailRect.x + detailRect.width).toBeCloseTo(mapRect.x + mapRect.width, 0)
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
