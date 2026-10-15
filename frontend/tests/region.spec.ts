import { expect, test, type Page } from '@playwright/test'

async function prepare(page: Page) {
  await page.route('**/api/health', route => route.fulfill({ json: { configured: true, evaluation_model: 'test', image_edit_model: 'test' } }))
  await page.goto('/')
  await page.getByRole('button', { name: '载入狐狸信使示例' }).click()
  await expect(page.getByRole('button', { name: '选区', exact: true })).toBeEnabled()
}

async function select(page: Page, x = .35) {
  await page.getByRole('button', { name: '选区', exact: true }).click()
  const canvas = page.getByLabel('绘画画布')
  await canvas.scrollIntoViewIfNeeded()
  const bounds = (await canvas.boundingBox())!
  await page.mouse.move(bounds.x + bounds.width * x, bounds.y + bounds.height * .35)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * (x + .2), bounds.y + bounds.height * .55, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByRole('region', { name: '选区对话', exact: true })).toBeVisible()
}

test('readable typography, selection tooltip and adaptive conversation panel', async ({ page }) => {
  await prepare(page)
  const button = page.getByRole('button', { name: '选区', exact: true })
  await button.hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await expect(page.getByRole('tooltip')).toContainText('拖动框选')
  expect(await page.locator('#goal').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(15)
  await select(page)
  const panel = page.getByRole('region', { name: '选区对话', exact: true })
  await expect(page.getByRole('textbox', { name: '给选区 AI 的消息' })).toBeFocused()
  const bounds = (await panel.boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440)
  await page.screenshot({ path: 'test-results/region-chat-desktop.png', fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: '收起选区对话' }).click()
  await expect(page.getByRole('textbox', { name: '给选区 AI 的消息' })).toHaveCount(0)
  await page.getByRole('button', { name: '展开选区对话' }).click()
  await expect(page.getByRole('textbox', { name: '给选区 AI 的消息' })).toBeVisible()
})

test('multi-turn chat, failure retry, direct local edit and adoption', async ({ page }) => {
  await prepare(page)
  let starts = 0
  let fail = true
  const modes: string[] = []
  await page.route('**/api/region-sessions', async route => {
    starts++
    const input = route.request().postDataJSON()
    expect(input.image).toMatch(/^data:image\/png;base64,/)
    expect(input.brief.region.width).toBeCloseTo(.2, 1)
    await route.fulfill({ json: { id: 'c'.repeat(32) } })
  })
  await page.route('**/api/region-sessions/*/messages', async route => {
    const input = route.request().postDataJSON()
    modes.push(input.mode)
    if (fail) { fail = false; await route.fulfill({ status: 502, json: { detail: '测试连接失败，请重试。' } }); return }
    await route.fulfill({ json: { reply: input.mode === 'chat' ? '围巾可以改成低饱和度蓝色。' : '已按要求生成局部候选。', candidate: input.mode === 'edit' ? { id: 'd'.repeat(32), session_id: 'c'.repeat(32), image_url: '/api/artifacts/region.png', model: 'test', prompt: '仅将围巾改为蓝色', prompt_version: 'test', scope: 'masked_region' } : null } })
  })
  const image = await page.locator('.canvas-frame canvas').nth(1).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  await page.route('**/api/artifacts/region.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(image.split(',')[1], 'base64') }))
  await select(page)
  const input = page.getByRole('textbox', { name: '给选区 AI 的消息' })
  await input.fill('围巾换什么颜色合适？')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.locator('.region-chat-error')).toContainText('连接失败')
  await expect(input).toHaveValue('围巾换什么颜色合适？')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('低饱和度蓝色')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await input.fill('保留边缘线条可以吗？')
  await input.press('Control+Enter')
  await expect(page.locator('.region-message')).toHaveCount(4)
  expect(starts).toBe(1)
  await input.fill('按刚才说的改成蓝色，保留线条')
  await page.getByRole('button', { name: '修改选区', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('选区外原始像素已保留')
  await page.getByRole('button', { name: '采纳并保存新版本' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('log')).not.toContainText('低饱和度蓝色')
  await expect(page.getByRole('button', { name: '恢复版本：采纳 AI 修正', exact: true })).toBeVisible()
  expect(modes).toEqual(['chat', 'chat', 'chat', 'edit'])
})

test('changing the selection or brief starts a fresh conversation', async ({ page }) => {
  await prepare(page)
  await page.route('**/api/region-sessions', route => route.fulfill({ json: { id: 'e'.repeat(32) } }))
  await page.route('**/api/region-sessions/*/messages', route => route.fulfill({ json: { reply: '这是旧选区的回答。', candidate: null } }))
  await select(page)
  await page.getByRole('textbox', { name: '给选区 AI 的消息' }).fill('这里是什么？')
  await page.getByRole('button', { name: '发送消息', exact: true }).click()
  await expect(page.getByRole('log')).toContainText('旧选区')
  await page.getByRole('button', { name: '收起选区对话' }).click()
  await select(page, .1)
  await expect(page.getByRole('log')).not.toContainText('旧选区')
  await page.locator('#goal').fill('新的创作目标')
  await page.locator('#goal').pressSequentially('，保留动作')
  await expect(page.locator('#goal')).toHaveValue('新的创作目标，保留动作')
  await expect(page.locator('#goal')).toBeFocused()
  await expect(page.getByRole('textbox', { name: '给选区 AI 的消息' })).toHaveValue('')
  await page.getByRole('button', { name: '清除选区' }).click()
  await expect(page.getByRole('region', { name: '选区对话', exact: true })).toHaveCount(0)
})

test('region conversation stays inside a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await prepare(page)
  await select(page, .65)
  const bounds = (await page.getByRole('region', { name: '选区对话', exact: true }).boundingBox())!
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(844)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'test-results/region-chat-mobile.png', fullPage: true, animations: 'disabled' })
})
