#!/usr/bin/env node
// 剧本 PB06 · 「生成失败了：看提示、缩小窗口、按提示换一家、再生成」
//
// 已知问题（0.22.1）：
//   · 右上角弹出的「切换供应商」提示框整条伸出窗口右边，按钮和关闭钮被截掉；提示里夹着供应商的英文原文，还叠 ×3 / ×2；
//   · 节点失败后换了模型，旧失败还留在节点上，切家提示把它算到新供应商头上，而且连弹三次。
// 真实创作者会做的事：点生成 → 失败 → 看提示 → 笔记本上把窗口缩小 → 点提示里的「切到另一家」→ 再点生成。
// 乱用：缩到最小窗（electron/main.ts 登记的 minWidth × minHeight）；换家之后不关旧提示直接再生成。
//
// 零花费：两家都是本机回环供应商（同一个档案、同一个模型，两把不同的钥匙）；A 家第一笔回一个「模型已下线」的英文报错。
import { DEFAULT_TIMEOUT_MS, expect } from '../../_assert.mjs'
import { stationTimeout } from '../../_station-budget.mjs'
import { FIXTURE_IMAGE_MODEL, FIXTURE_VENDOR } from '../../agent-runtime-fixture.mjs'
import { clickNodeGenerate, clickVisiblePart, resizeContent } from '../actions.mjs'
import { startPlaybook } from '../launch.mjs'
import { providerFailedPatterns } from '../monitor.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'
// 卡片标题与提示词是用户自己写的内容：英文界面那一档就用英文写（界面漏译才是要抓的，用户写中文不是）。
const SEED_EN = process.env.NOMI_FULL_WALK_LOCALE === 'en'
const PROVIDER_ERROR = 'This model has been deprecated and is no longer available. Please switch to another model or provider.'

const base = { categoryId: 'shots', references: [], runs: [] }
const pb = await startPlaybook({
  id: 'pb06-failure-small-window',
  needs: ['loopbackProvider'],
  fixtureOptions: { extraImageVendor: true },
  seed: () => ({
    nodes: [{
      ...base, id: 'fail-card', kind: 'image', title: SEED_EN ? 'Rainy corner' : '雨夜街角', prompt: SEED_EN ? 'A neon street corner on a rainy night, reflections in puddles, cinematic' : '雨夜的霓虹街角，积水倒影，电影感', position: { x: 200, y: 140 }, status: 'idle', history: [],
      meta: { modelKey: FIXTURE_IMAGE_MODEL, modelVendor: FIXTURE_VENDOR, imageModel: FIXTURE_IMAGE_MODEL, imageModelVendor: FIXTURE_VENDOR },
    }],
    groups: [],
    edges: [],
  }),
})
const { smoke, fixture, monitor } = pb
const win = () => smoke.win
const node = async () => ((await monitor.readProject())?.payload?.generationCanvas?.nodes ?? []).find((entry) => entry.id === 'fail-card')
// A 家（第一家回环）的第一笔：供应商说这个模型下线了（原样英文）。
fixture.setMediaBehavior(({ index }) => (index === 0 ? { reject: { status: 400, json: { error: { message: PROVIDER_ERROR, code: 'model_not_found' } } } } : undefined))
const toast = () => win().locator('.mantine-Notification-root')

let harnessError = null
try {
  await monitor.step('打开项目（从项目库）', () => smoke.openProject(), { surfaces: ['*'], critical: true })

  await monitor.step('点这张卡的 ↑ 生成', async () => {
    await monitor.consentNodeGenerate('fail-card', { label: '第一次生成' })
    await clickNodeGenerate(win(), 'fail-card')
  }, { surfaces: ['modal', 'canvasGesture'] })
  await monitor.step('等它失败、看提示', async () => {
    await expect.poll(async () => (await node())?.status, { message: '这张卡落成失败', timeout: stationTimeout({ operations: 4 }) }).toBe('error')
    await expect(toast().first(), '失败之后弹出一条提示').toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  }, { user: false, surfaces: [] })

  const min = monitor.limits.minWindow.value
  await monitor.step(`乱用：把窗口缩到最小（${min.width}×${min.height}）`, async () => {
    await resizeContent(smoke.app, win(), min)
    await monitor.screenshot('min-window-with-toast')
  }, { surfaces: ['canvasViewport'] })

  await monitor.step('点提示里的「切到另一家」（按钮被窗口右沿截掉了一半，点露出来的那一半）', async () => {
    const switchAction = toast().locator('button').filter({ hasText: /切到|Switch to/ }).first()
    await clickVisiblePart(win(), switchAction, '提示里的「切到 …」')
    await expect.poll(async () => (await node())?.meta?.modelVendor, { message: '节点换到了另一家', timeout: DEFAULT_TIMEOUT_MS }).not.toBe(FIXTURE_VENDOR)
  }, { surfaces: [] })

  await monitor.step('换家之后停一会儿（旧失败还在节点上）', async () => {
    await win().waitForTimeout(monitor.limits.runViewPollMs.value * 2)
    await monitor.screenshot('after-switch')
  }, { user: false, surfaces: [] })

  await monitor.step('再点一次 ↑ 生成（换过家了）', async () => {
    await monitor.consentNodeGenerate('fail-card', { label: '换家后再生成' })
    await clickNodeGenerate(win(), 'fail-card')
  }, { surfaces: ['modal', 'canvasGesture'] })
  await monitor.step('等这一次出图', async () => {
    await expect.poll(async () => (await node())?.status, { message: '这一次落成 success', timeout: stationTimeout({ operations: 4 }) }).toBe('success')
  }, { user: false, surfaces: [] })

  await monitor.step('出图之后看提示还在不在', async () => {
    // 「某某家：失败原因。建议」那一类（切家提示，认法取自词典，与监视器同一份）：卡已经成功了，它还挂着就是一句过期的话。
    const failureToasts = (await toast().allInnerTexts()).map((text) => text.replace(/\s+/g, ' ').trim())
      .filter((text) => providerFailedPatterns().some(({ pattern }) => pattern.test(text)))
    if (failureToasts.length > 0) {
      await monitor.violate({
        invariant: 4, rule: 'stale-failure-toast', key: 'fail-card',
        module: 'src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts（ttl:false 的切家提示不随节点成功收回）',
        message: `这张卡已经换家生成成功了，右上角还挂着 ${failureToasts.length} 条说它失败、劝它换家的提示`,
        snapshot: { toasts: failureToasts, node: await node() },
      })
    }
  }, { user: false, surfaces: [] })

  await monitor.settle('收尾')
} catch (error) {
  harnessError = error
  console.error('[full-walk] pb06 故障：', error?.stack ?? error)
}
process.exit(await pb.finish(harnessError))
