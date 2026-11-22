// R13：参数面板数字控件（2026-08-18 从私有 fork 比对中捞出的两条回归）。
//
// ① 打字中间态被写进 meta：输入框受控、逐键回写。输 `0.4` 要途经 `0.`，它按 HTML 规范不是合法
//    浮点数、`input.value` 读出来是空串，于是那一键把 `null` 写进节点 meta（也就进了生成请求参数）。
//    校准：type="number" 会保留键入原文，所以**看不到**小数点被抹掉——坏的是写出去的值。
// ② 0–1 参数退化成两档滑杆：修好 min/max 解析（0 不再被当非法丢掉）后，0–1 开始带上区间，
//    而默认步长 1 只切得出 0 和 1 两个端点——不加判据就等于把参数废掉。
//
// 为什么用隔离夹具而不是真 catalog：内置模型目录里没有任何 number 型参数（那条路只有自定义
// 能力契约与导入的 ComfyUI 工作流走得到），拿真 catalog 根本渲染不出这一段。夹具挂的是**真组件**
// （真 React / Mantine / i18n），不是 mock。
//
// 用法：node tests/ux/param-panel-numeric.e2e.mjs
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const fixturePath = '/tests/ux/fixtures/param-panel-numeric/index.html'

let server
let browser
let passed = 0
const ok = (label, detail = '') => { passed += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`) }

try {
  server = await createServer({
    root: repoRoot,
    configFile: path.join(repoRoot, 'vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  await server.listen()
  const address = server.httpServer?.address()
  assert(address && typeof address !== 'string', 'Vite 没有暴露出 TCP 端口')

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(`http://127.0.0.1:${address.port}${fixturePath}`)

  // 打开参数面板（摘要 pill）。
  const pill = page.locator('button[aria-expanded]').first()
  await pill.click()
  await page.getByLabel('百万像素').waitFor({ state: 'visible', timeout: 15_000 })
  ok('参数面板打开，三个数字参数都渲染出来了')

  // ── ① 小数输入：逐字符敲 0.4，中途不能被回写冲掉 ─────────────────────
  const megapixels = page.getByLabel('百万像素')
  await megapixels.fill('')
  await megapixels.pressSequentially('0.4', { delay: 60 })

  assert.equal(await megapixels.inputValue(), '0.4', '打完 0.4 后输入框里必须还是 0.4')
  ok('小数逐字符输入后框里是完整值', await megapixels.inputValue())

  assert.equal(
    await page.getByTestId('megapixels-value').textContent(),
    '0.4',
    '完整值必须已经提交进 meta',
  )
  ok('完整的小数已提交进 meta')

  // 提交序列必须**恰好**是两次：敲下 `0` 时它本身就是个完整值（该提交），
  // 敲出 `0.` 时是中间态（不该提交），敲完 `0.4` 再提交一次。
  // 修复前每一键都回写，`0.` 会再提交一次 0——于是日志里会出现连着两个 megapixels=0。
  const commitLog = (await page.getByTestId('commit-log').textContent()) || ''
  assert.deepEqual(
    commitLog.split('|'),
    ['megapixels=0', 'megapixels=0.4'],
    `提交序列不对：中间态 0. 不该产生一次回写。实际：${commitLog}`,
  )
  ok('中间态 0. 没有产生回写', commitLog)

  // ── ② 0–1 未声明步长：必须是可输入的数字框，不是两档滑杆 ──────────────
  const denoise = page.getByLabel('去噪强度')
  await denoise.waitFor({ state: 'visible', timeout: 15_000 })
  assert.equal(
    await denoise.evaluate((el) => el.tagName.toLowerCase()),
    'input',
    '0–1 且未声明步长的参数必须退回数字输入框',
  )
  ok('0–1 未声明步长 → 数字输入框而非废滑杆')

  await denoise.fill('')
  await denoise.pressSequentially('0.35', { delay: 60 })
  assert.equal(await page.getByTestId('denoise-value').textContent(), '0.35', 'denoise 小数要能落进 meta')
  ok('0–1 参数可以输入任意小数', '0.35')

  // ── ③ 反向对照：步长可用的区间仍然是滑杆（没把滑杆全砍）─────────────
  const durationSlider = page.locator('[role="slider"]')
  assert.ok(
    await durationSlider.first().waitFor({ state: 'visible' }).then(() => true, () => false),
    '声明了可用步长的区间参数仍应是滑杆——本次修的是「切不出两档时退回」，不是「全砍滑杆」',
  )
  ok('有可用步长的区间参数仍然是滑杆')

  // The accessible name must belong to the interactive thumb, not its wrapper.
  // Keep the invariant when the panel contains several parameters or just one.
  async function checkNamedDuration() {
    const slider = page.getByRole('slider', { name: '时长', exact: true })
    await slider.waitFor({ state: 'visible' })
    assert.equal(await slider.getAttribute('aria-valuenow'), '5')
    await slider.focus()
    await slider.press('ArrowRight')
    await page.waitForFunction(() => document.querySelector('[data-testid="duration-value"]')?.textContent === '6')
    assert.equal(await slider.getAttribute('aria-valuenow'), '6')
    await slider.press('Home')
    await page.waitForFunction(() => document.querySelector('[data-testid="duration-value"]')?.textContent === '1')
    await slider.press('End')
    await page.waitForFunction(() => document.querySelector('[data-testid="duration-value"]')?.textContent === '10')
    assert.equal(await slider.getAttribute('aria-valuenow'), '10')
  }
  await checkNamedDuration()
  ok('面板滑块有真实名称，键盘写入参数且遵守范围')
  await page.goto(`http://127.0.0.1:${address.port}${fixturePath}?single=1`)
  await page.locator('button[aria-expanded]').first().click()
  await checkNamedDuration()
  ok('仅一个数值参数的面板仍保留名称和键盘写入边界')

  // 参数面板只剩一种摆法：静止浮层 portal 到 body（D2 第③步把付费卡里那份「面板内嵌在节点里」的摆法随旧卡删了）。
  const keyboardFailures = []
  for (const single of [false, true]) {
    try {
      const query = `?flow=1${single ? '&single=1' : ''}`
      await page.goto(`http://127.0.0.1:${address.port}${fixturePath}${query}`)
      await page.locator('button[aria-expanded]').first().click()
      const slider = page.getByRole('slider', { name: '时长', exact: true })
      await slider.waitFor({ state: 'visible' })
      assert.equal(await slider.evaluate(element => Boolean(element.closest('.react-flow__node'))), false,
        'The parameter panel must exercise the actual component\'s body portal placement')
      const before = await page.evaluate(() => window.numericFlowSnapshot())
      assert.deepEqual(before, { ownsNodes: true, position: { x: 80, y: 80 } })
      await slider.focus()
      await slider.press('ArrowRight')
      await page.waitForFunction(() => document.querySelector('[data-testid="duration-value"]')?.textContent === '6')
      assert.equal(await slider.getAttribute('aria-valuenow'), '6')
      assert.deepEqual(await page.evaluate(() => window.numericFlowSnapshot()), before,
        `portal/${single ? 'single' : 'multiple'} slider ArrowRight must change only the parameter, preserving node position and ownership`)
      await slider.press('Escape')
      const node = page.locator('.react-flow__node[data-id="numeric-node"]')
      await node.focus()
      await node.press('ArrowRight')
      assert.deepEqual(await page.evaluate(() => window.numericFlowSnapshot()),
        { ownsNodes: true, position: { x: 85, y: 80 } }, 'Original node keyboard movement must remain enabled')
      ok(`真实 React Flow portal/${single ? '单参数' : '多参数'} 滑块键盘不移动节点，节点自身键盘仍可用`)
    } catch (error) { keyboardFailures.push(error) }
  }

  try {
    await page.goto(`http://127.0.0.1:${address.port}${fixturePath}?flow=1&providers=1`)
    await page.getByRole('button', { name: '模型', exact: true }).click()
    const dropdown = page.locator('[data-nomi-select-dropdown]:visible')
    const provider = dropdown.getByRole('button', { name: 'Remote fixture', exact: true })
    await provider.waitFor({ state: 'visible' })
    assert.equal(await provider.evaluate(element => Boolean(element.closest('.react-flow__node'))), false,
      'Provider choice must be in the real NomiSelect body portal')
    const before = await page.evaluate(() => window.numericFlowSnapshot())
    await provider.focus()
    await provider.press('ArrowRight')
    const afterArrow = await page.evaluate(() => window.numericFlowSnapshot())
    await provider.press('Enter')
    await page.waitForFunction(() => document.querySelector('[data-testid="selected-provider"]')?.textContent === 'fixture-remote')
    const selected = await page.locator('.react-flow__node[data-id="numeric-node"]').evaluate(element => element.classList.contains('selected'))
    assert.deepEqual(afterArrow, before, 'NomiSelect portal provider ArrowRight must not move the node')
    assert.equal(selected, true, 'NomiSelect provider Enter must retain canvas selection while changing provider')
    assert.deepEqual(await page.evaluate(() => window.numericFlowSnapshot()), before)
    ok('真实 NomiSelect 供应商按钮 Arrow 不移动节点，Enter 保留选中并执行原换家动作')
  } catch (error) { keyboardFailures.push(error) }
  if (keyboardFailures.length) throw new AggregateError(keyboardFailures, 'Framework portal keyboard ownership regressions')

  assert.deepEqual(pageErrors, [], '页面不应有运行时错误')
  ok('无运行时错误')

  console.log(`\n✅ 通过：${passed} 条判据`)
} finally {
  await browser?.close()
  await server?.close()
}
