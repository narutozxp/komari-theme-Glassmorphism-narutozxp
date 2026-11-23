import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import { installKomariFixture } from './fixtures/komari'

const UUID = '00000000-0000-4000-8000-000000000001'

async function getPingChartOption(page: Page) {
  return page.evaluate(() => {
    interface Option {
      yAxis: Array<{ name: string, min?: number, max?: number, interval?: number }>
      series: Array<{ name: string, smooth: boolean | number, step: boolean | string, data: Array<number | null> }>
    }
    interface Chart { getDom: () => HTMLElement, getOption: () => Option }
    interface VNode {
      component?: { exposed?: { chart?: Chart | { value?: Chart } }, subTree?: VNode }
      children?: VNode[]
    }
    const root = (document.querySelector('#app') as HTMLElement & { _vnode?: VNode })._vnode
    const pending = root ? [root] : []
    while (pending.length) {
      const node = pending.pop()!
      const exposed = node.component?.exposed?.chart
      const chart = exposed && 'getOption' in exposed ? exposed : exposed?.value
      if (chart?.getDom().closest('[data-ping-history-chart]')) {
        const { yAxis: [axis], series } = chart.getOption()
        return {
          axis: { name: axis?.name, min: axis?.min, max: axis?.max, interval: axis?.interval },
          series: series.map(({ name, data, smooth, step }) => ({ name, data, smooth, step })),
        }
      }
      if (node.component?.subTree)
        pending.push(node.component.subTree)
      if (Array.isArray(node.children))
        pending.push(...node.children.filter(child => child && typeof child === 'object'))
    }
    return null
  })
}

test('detail Ping switches units and keeps the selected range and tasks', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 850 })
  await installKomariFixture(page, { hideEarth: true, pingTaskOrdering: true, pingGaps: true })
  let historyCalls = 0
  page.on('request', (request) => {
    if (!request.url().endsWith('/rpc2'))
      return
    const { method, params } = request.postDataJSON()
    if (method === 'public:queryMetrics' && params.metric_keys?.includes('ping.loss') && params.max_points === 6000)
      historyCalls++
  })

  await page.goto(`/instance/${UUID}`)
  const trend = page.getByRole('region', { name: 'Ping 趋势' })
  const latency = trend.getByRole('button', { name: '延迟', exact: true })
  const loss = trend.getByRole('button', { name: '丢包率', exact: true })
  const smooth = trend.getByRole('button', { name: '平滑峰值', exact: true })
  await expect(latency).toHaveAttribute('aria-pressed', 'true')
  const range = page.getByRole('tab', { name: '6 小时', exact: true }).last()
  await range.click()
  await expect.poll(() => getPingChartOption(page).then(option => option?.axis.name)).toBe('延迟 (ms)')

  await page.locator('[data-ping-task-id="30"]').click({ position: { x: 12, y: 12 } })
  await smooth.click()
  await expect.poll(() => getPingChartOption(page).then(option => option?.series.length)).toBe(2)
  const before = await getPingChartOption(page)
  const requestsBeforeSwitch = historyCalls
  await loss.focus()
  await loss.press('Space')
  await expect(loss).toHaveAttribute('aria-pressed', 'true')
  await expect(range).toHaveAttribute('aria-selected', 'true')
  await expect(smooth).toBeHidden()
  await expect.poll(() => getPingChartOption(page).then(option => option?.axis.name)).toBe('丢包率')

  const after = await getPingChartOption(page)
  expect(after?.axis).toEqual({ name: '丢包率', min: 0, max: 10, interval: 2 })
  expect(after?.series.map(series => series.name)).toEqual(before?.series.map(series => series.name))
  expect(after?.series[0]).toMatchObject({ smooth: false, step: 'middle' })
  expect(after?.series[0]?.data).toEqual(expect.arrayContaining([1.5, 8, null]))
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await trend.screenshot({ path: testInfo.outputPath('ping-loss-light.png') })

  await latency.click()
  await expect(smooth).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(getPingChartOption.bind(null, page)).toEqual(before)
  expect(historyCalls).toBe(requestsBeforeSwitch)
})

test('detail Ping charts a full outage without latency samples', async ({ page }) => {
  await installKomariFixture(page, {
    hideEarth: true,
    pingTasks: [{ id: 1, name: '不可达线路', interval: 75, loss: 0, dropEvery: 1 }],
  })
  await page.goto(`/instance/${UUID}`)
  await page.getByRole('region', { name: 'Ping 趋势' }).getByRole('button', { name: '丢包率', exact: true }).click()
  await expect.poll(() => getPingChartOption(page)).toMatchObject({
    axis: { min: 0, max: 100 },
    series: [{ data: Array.from({ length: 48 }).fill(100) }],
  })
})

test('Ping legend wraps long task names and preserves the hidden line across metrics', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 850 })
  const longName = 'TokyoNTTInternationalBackbone'.repeat(3)
  const pingTasks = Array.from({ length: 14 }, (_, index) => ({
    id: index + 1,
    name: index === 13 ? longName : `跨区探测 ${index + 1} · IPv6`,
    interval: 75,
    loss: 0,
    weight: index,
    dropEvery: 8 + index,
  }))
  await installKomariFixture(page, { hideEarth: true, dark: true, pingTasks })
  await page.goto(`/instance/${UUID}`)
  const trend = page.getByRole('region', { name: 'Ping 趋势' })
  const legend = trend.getByRole('group', { name: '探测线路图例' })
  const longTask = legend.getByRole('button', { name: longName })
  await expect(legend.getByRole('button')).toHaveCount(pingTasks.length)

  const layout = await legend.evaluate((element) => {
    const buttons = [...element.querySelectorAll('button')]
    return {
      rows: new Set(buttons.map(button => button.offsetTop)).size,
      overflow: element.scrollWidth > element.clientWidth + 1,
      longButtonHeight: buttons.at(-1)?.offsetHeight,
    }
  })
  expect(layout.rows).toBeGreaterThan(1)
  expect(layout.overflow).toBe(false)
  expect(layout.longButtonHeight).toBeGreaterThan(28)

  await longTask.press('Space')
  await expect(longTask).toHaveAttribute('aria-pressed', 'false')
  await trend.getByRole('button', { name: '丢包率', exact: true }).click()
  await expect(longTask).toHaveAttribute('aria-pressed', 'false')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await trend.screenshot({ path: testInfo.outputPath('ping-legend-mobile.png') })

  await page.setViewportSize({ width: 1280, height: 850 })
  await longTask.click()
  await expect(longTask).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await trend.screenshot({ path: testInfo.outputPath('ping-legend-desktop.png') })
})

test('legacy detail Ping presents bucketed packet loss on mobile', async ({ browser }, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  try {
    const page = await context.newPage()
    await installKomariFixture(page, { hideEarth: true, dark: true })
    await page.goto(`/instance/${UUID}`)
    const trend = page.getByRole('region', { name: 'Ping 趋势' })
    await trend.getByRole('button', { name: '丢包率', exact: true }).tap()
    await expect(trend.getByText('每 5 分钟统计')).toBeVisible()
    await expect.poll(() => getPingChartOption(page).then(option => option?.series[0]?.data)).toEqual(expect.arrayContaining([0, 25]))
    const bounds = await trend.boundingBox()
    expect(bounds?.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await trend.screenshot({ path: testInfo.outputPath('ping-loss-dark-mobile.png') })

    await page.getByRole('button', { name: '全不选', exact: true }).tap()
    await expect(trend.getByText('请选择要显示的探测任务')).toBeVisible()
  }
  finally {
    await context.close()
  }
})
