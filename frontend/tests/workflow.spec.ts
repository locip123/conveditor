import { expect, test, type Page } from '@playwright/test'

// Network fixtures exercise UI states only; production always calls the real backend.
async function connected(page: Page) {
  await page.route('**/api/health', route => route.fulfill({ json: { configured: true, evaluation_model: 'test-vision', image_edit_model: 'test-image' } }))
  await page.goto('/')
  await expect(page.getByText('已自动保存到本机')).toBeVisible()
  await page.getByRole('button', { name: '载入狐狸信使示例' }).click()
  await expect(page.getByRole('button', { name: '评估当前画稿' })).toBeEnabled()
}

async function evaluate(page: Page) {
  await page.route('**/api/evaluations', async route => {
    const body = route.request().postDataJSON()
    expect(body.image).toMatch(/^data:image\/png;base64,/)
    expect(body.brief.stage).toBe('sketch')
    await route.fulfill({ json: {
      id: 'a'.repeat(32), model: 'test-vision', prompt_version: 'test', summary: '角色识别清楚，肩部需要调整。', strengths: ['围巾很有特点'],
      suggestions: [{ id: 's1', title: '调整肩部连接', priority: 'high', observation: '肩部连接不自然', action: '连接肩部轮廓', reason: '保持动作连续', region: { x: .2, y: .3, width: .2, height: .2 } }],
    } })
  })
  await page.getByRole('button', { name: '评估当前画稿' }).click()
  await expect(page.getByText('调整肩部连接', { exact: true })).toBeVisible()
}

test('drawing, undo, selection, versions and reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await connected(page)
  const canvas = page.getByLabel('绘画画布')
  const bounds = (await canvas.boundingBox())!
  await page.mouse.move(bounds.x + 80, bounds.y + 80)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 160, bounds.y + 160, { steps: 10 })
  await page.mouse.up()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect(page.getByRole('button', { name: '重做', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await page.getByRole('button', { name: '选区', exact: false }).first().click()
  await page.mouse.move(bounds.x + 90, bounds.y + 90)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 200, bounds.y + 220, { steps: 8 })
  await page.mouse.up()
  await expect(page.getByText('局部选区', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '保存版本', exact: false }).click()
  await expect(page.getByRole('button', { name: '恢复版本：手动保存', exact: true })).toBeVisible()
  await expect(page.getByText('已自动保存到本机')).toBeVisible()
  await page.reload()
  await expect(page.getByText('局部选区', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复版本：手动保存', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '评估当前画稿' })).toBeEnabled()
  expect(errors).toEqual([])
  await page.screenshot({ path: 'test-results/workspace.png', fullPage: true })
})

test('drawing name persists without changing artwork or invalidating evaluation', async ({ page }) => {
  await connected(page)
  await evaluate(page)
  const rendered = () => page.locator('.canvas-frame canvas').nth(1).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  const before = await rendered()
  const name = page.getByRole('textbox', { name: '画稿名称', exact: true })
  await expect(name).toHaveValue('未命名画稿')
  await name.fill('  狐狸信使 · 动作探索  ')
  await name.press('Enter')
  await expect(name).toHaveValue('狐狸信使 · 动作探索')
  await expect(page.getByText('调整肩部连接', { exact: true })).toBeVisible()
  await expect(page.locator('.revision')).toHaveCount(1)
  expect(await rendered()).toBe(before)
  await expect(page.getByText('已自动保存到本机')).toBeVisible()
  await page.locator('.app-header').screenshot({ path: 'test-results/drawing-name.png' })
  await page.reload()
  await expect(name).toHaveValue('狐狸信使 · 动作探索')
  await expect(page.getByRole('button', { name: '评估当前画稿' })).toBeEnabled()
  await expect(page.locator('.revision')).toHaveCount(1)
  expect(await rendered()).toBe(before)
})

test('blank drawing names fall back to the default', async ({ page }) => {
  await connected(page)
  const name = page.getByRole('textbox', { name: '画稿名称', exact: true })
  await name.fill('   ')
  await name.press('Tab')
  await expect(name).toHaveValue('未命名画稿')
  await expect(page.getByText('已自动保存到本机')).toBeVisible()
  await page.reload()
  await expect(name).toHaveValue('未命名画稿')
})

test('workspaces saved before naming keep their drawing and versions', async ({ page }) => {
  await connected(page)
  await page.getByRole('button', { name: '保存版本', exact: false }).click()
  await expect(page.getByText('已自动保存到本机')).toBeVisible()
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('conveditor', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('workspace', 'readwrite')
      const store = transaction.objectStore('workspace')
      const current = store.get('current')
      current.onsuccess = () => {
        delete current.result.name
        store.put(current.result, 'current')
      }
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => { db.close(); reject(transaction.error) }
    }
  }))
  await page.reload()
  await expect(page.getByRole('textbox', { name: '画稿名称', exact: true })).toHaveValue('未命名画稿')
  await expect(page.getByRole('button', { name: '评估当前画稿' })).toBeEnabled()
  await expect(page.locator('.revision')).toHaveCount(1)
})

test('restoring a saved version repeatedly does not create copies', async ({ page }) => {
  await connected(page)
  await page.getByRole('button', { name: '保存版本', exact: false }).click()
  await expect(page.locator('.revision')).toHaveCount(1)
  for (let click = 0; click < 3; click++) {
    await page.getByRole('button', { name: '恢复版本：手动保存', exact: true }).click()
    await expect(page.locator('.revision')).toHaveCount(1)
  }
})

test('restoring only archives drawing and brief edits missing from history', async ({ page }) => {
  await connected(page)
  const rendered = () => page.locator('.canvas-frame canvas').nth(1).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  const original = await rendered()
  const goal = page.getByLabel('创作目标', { exact: false })
  const originalGoal = await goal.inputValue()
  await page.getByRole('button', { name: '保存版本', exact: false }).click()
  const bounds = (await page.getByLabel('绘画画布').boundingBox())!
  await page.mouse.move(bounds.x + 80, bounds.y + 80)
  await page.mouse.down()
  await page.mouse.move(bounds.x + 160, bounds.y + 160, { steps: 10 })
  await page.mouse.up()
  const edited = await rendered()
  expect(edited).not.toBe(original)
  await goal.fill('保留我还没有保存的新目标')
  await page.getByRole('button', { name: '恢复版本：手动保存', exact: true }).click()
  await expect(page.locator('.revision')).toHaveCount(2)
  await expect.poll(rendered).toBe(original)
  await expect(goal).toHaveValue(originalGoal)
  for (let click = 0; click < 2; click++) {
    await page.getByRole('button', { name: '恢复版本：恢复前的画稿', exact: true }).click()
    await expect(page.locator('.revision')).toHaveCount(2)
    await expect.poll(rendered).toBe(edited)
    await expect(goal).toHaveValue('保留我还没有保存的新目标')
    await page.getByRole('button', { name: '恢复版本：手动保存', exact: true }).click()
    await expect(page.locator('.revision')).toHaveCount(2)
  }
})

test('deleting versions preserves the current drawing and persists after reload', async ({ page }) => {
  await connected(page)
  const goal = page.getByLabel('创作目标', { exact: false })
  const originalGoal = await goal.inputValue()
  await page.getByRole('button', { name: '保存版本', exact: false }).click()
  await goal.fill('另一个版本的目标')
  await page.getByRole('button', { name: '保存版本', exact: false }).click()
  await page.getByRole('button', { name: '恢复版本：手动保存', exact: true }).last().click()
  await expect(page.locator('.revision')).toHaveCount(2)
  const rendered = () => page.locator('.canvas-frame canvas').nth(1).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  const current = await rendered()
  await page.screenshot({ path: 'test-results/history.png', fullPage: true })
  await page.locator('.revision').first().getByRole('button', { name: '删除版本：手动保存', exact: true }).click()
  await expect(page.locator('.revision')).toHaveCount(1)
  await expect(goal).toHaveValue(originalGoal)
  expect(await rendered()).toBe(current)
  await expect(page.getByText('已自动保存到本机')).toBeVisible()
  await page.reload()
  await expect(page.locator('.revision')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '评估当前画稿' })).toBeEnabled()
  await expect(goal).toHaveValue(originalGoal)
  expect(await rendered()).toBe(current)
  await page.getByRole('button', { name: '删除版本：手动保存', exact: true }).click()
  await expect(page.locator('.revision')).toHaveCount(0)
  await expect(page.getByText('已自动保存到本机')).toBeVisible()
  await page.reload()
  await expect(page.locator('.revision')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '评估当前画稿' })).toBeEnabled()
  expect(await rendered()).toBe(current)
})

test('evaluation becomes stale when creative brief changes', async ({ page }) => {
  await connected(page)
  await evaluate(page)
  await expect(page.getByRole('button', { name: '生成修正候选' })).toBeDisabled()
  await page.getByLabel('创作目标', { exact: false }).fill('新的动作目标')
  await expect(page.getByText('画稿或要求已更新')).toBeVisible()
  await expect(page.getByText('调整肩部连接', { exact: true })).toHaveCount(0)
})

test('candidate waits for explicit adoption, discard retains drawing, adoption is reversible', async ({ page }) => {
  await connected(page)
  await evaluate(page)
  let before = ''
  await page.route('**/api/edits', async route => {
    expect(route.request().postDataJSON().suggestion_ids).toEqual(['s1'])
    await route.fulfill({ json: { id: 'b'.repeat(32), evaluation_id: 'a'.repeat(32), image_url: '/api/artifacts/test.png', model: 'test-image', prompt: '测试修正', prompt_version: 'test', scope: 'instruction' } })
  })
  const candidate = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = c.height = 1024
    const ctx = c.getContext('2d')!; ctx.fillStyle = '#aabbcc'; ctx.fillRect(0, 0, 1024, 1024)
    return c.toDataURL()
  })
  await page.route('**/api/artifacts/test.png', route => route.fulfill({ contentType: 'image/png', body: Buffer.from(candidate.split(',')[1], 'base64') }))
  await page.getByRole('checkbox').check()
  before = await page.locator('.canvas-frame canvas').nth(1).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())
  await page.getByRole('button', { name: '生成修正候选' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.locator('.canvas-frame canvas').nth(1).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(before)
  await page.getByRole('button', { name: '放弃候选，继续绘画' }).click()
  expect(await page.locator('.canvas-frame canvas').nth(1).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(before)
  await page.getByRole('button', { name: '生成修正候选' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '并排对比' }).click()
  await page.screenshot({ path: 'test-results/comparison.png', fullPage: true })
  await page.getByRole('button', { name: '采纳并保存新版本' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '恢复版本：采纳 AI 修正', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await expect.poll(() => page.locator('.canvas-frame canvas').nth(1).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL())).toBe(before)
})

test('service error leaves artwork editable and permits retry', async ({ page }) => {
  await connected(page)
  await page.route('**/api/evaluations', route => route.fulfill({ status: 504, json: { detail: '模型请求超时，画稿已保留。' } }))
  await page.getByRole('button', { name: '评估当前画稿' }).click()
  await expect(page.getByRole('alert')).toContainText('模型请求超时')
  await expect(page.getByRole('button', { name: '评估当前画稿' })).toBeEnabled()
  await expect(page.getByRole('button', { name: '画笔', exact: false }).first()).toBeEnabled()
})

test('mobile layout and missing configuration', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/health', route => route.fulfill({ json: { configured: false, evaluation_model: 'test', image_edit_model: 'test' } }))
  await page.goto('/')
  await expect(page.getByText(/模型尚未配置/)).toBeVisible()
  await expect(page.getByRole('button', { name: '评估当前画稿' })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true })
})
