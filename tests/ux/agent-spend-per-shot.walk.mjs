#!/usr/bin/env node
// 真实用户任务（R13）：付费卡逐镜——「点了的生成，去掉的不生成」（用户 2026-09-29 拍板），测试表第 1–6、9–12 行；
// D2 第③步（SpendCardQ1 板）之后的样子：卡上不再一页一张，逐镜的动作只剩「不生成 ×」（Q1-A，可「恢复」）；
// 要先生成某一镜，就点它的指向元素、在节点上点 ↑（画布接走它，卡上那一镜跟着节点说生成中，主按钮换成「生成剩下 N 张」）。
// 「取消」收回这一次出价（没决定的都不生成），卡开着时打字也一样；Agent 收到的回执只说真的发生了的事。
// 每一行中英各走一遍、各拍整窗与卡的近景。
//
//   node tests/ux/agent-spend-per-shot.walk.mjs
//   NOMI_PER_SHOT_PROFILE_FROM=<上一版某次走查的 report.json> node tests/ux/agent-spend-per-shot.walk.mjs   # 第 14 行：老资料上走一遍
//
// 只有远端供应商是 loopback 夹具（零额度）；SDK、IPC、ProductionRun、渲染层、落盘全是真的。
import fs from 'node:fs'

import { DEFAULT_TIMEOUT_MS, clickOrFail, expect, expectAbsent, proveProbe } from './_assert.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { FIXTURE_APIMART_MODEL, FIXTURE_APIMART_VENDOR } from './agent-runtime-fixture.mjs'
import {
  CARD_EDITORS, CARD_PRIMARY, CARD_TITLE, POINTER, armCanvasBridges, createPresenter, excludeShot, generateOnNode, offerRows,
  offerFacts, pointerFace, pressPrimary, primaryLabel, shotNodes,
} from './_spendCardWalk.mjs'
import {
  CANVAS_PANEL, COMPOSER_INPUT, COMPOSER_SEND, closeSpendCard, createRuntimeWalk, expandResidentPanel, openCanvas, recorded,
} from './agent-runtime-walk-support.mjs'

process.env.NOMI_WALK_UNPRICED_MODEL = '1'

const IMAGE = { providerId: FIXTURE_APIMART_VENDOR, modelId: FIXTURE_APIMART_MODEL }
const VIDEO = { providerId: 'apimart', modelId: 'doubao-seedance-2.0' }
/** 今天没有价格：卡上不许出现这几句（第 1 行）。 */
const RETIRED = /仍要生成|价格未知|Generate anyway|price unknown/i
const PAGER = '[data-v4-block="pager"]'
const LOCALE = { zh: 'zh-CN', en: 'en' }
const interrupt = (locale, tag) => (locale === 'en' ? `${tag}_TYPED hold on, I want to change the second one.` : `${tag}_TYPED 先停一下，我想改改第二张。`)

const present = createPresenter('PS')
const rows = {}

/** 记一行测试表：断言失败不抛，写成 ok:false 接着走（验收页要的是全部证据）。 */
async function row(id, title, check) {
  try {
    rows[id] = { title, ok: true, detail: (await check()) ?? '', shots: rows[id]?.shots ?? [] }
  } catch (error) {
    rows[id] = { title, ok: false, detail: String(error?.message ?? error).replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter(Boolean).slice(0, 4).join(' ').slice(0, 400), shots: rows[id]?.shots ?? [] }
    process.exitCode = 1
  }
  console.log(`[per-shot] ${rows[id].ok ? 'PASS' : 'FAIL'} ${id} ${title} ${rows[id].detail}`)
}

/** 整窗一张 + 确认条的近景一张。拍之前把鼠标挪到条的左上角（空着的那一块）：刚点过的按钮还停在悬停态。 */
async function snap(walk, id, label, card) {
  try {
    if (card && await card.isVisible().catch(() => false)) await card.hover({ position: { x: 2, y: 2 } })
    const file = await walk.snap(`${id}-${label}`)
    const shots = [file]
    if (card && await card.isVisible().catch(() => false)) {
      const close = file.replace(/\.png$/, '-card.png')
      await card.screenshot({ path: close })
      shots.push(close)
    }
    ;(rows[id] ??= { title: '', ok: false, detail: '', shots: [] }).shots.push(...shots)
  } catch (error) {
    console.log(`[per-shot] snap failed ${id}-${label}: ${String(error?.message ?? error).split('\n')[0]}`)
  }
}

/** 这一轮的几镜（标题 `${tag}-N`，提示词里带「第 N 镜」，供应商那一笔按它认回）。 */
const shotsOf = (count, kind) => (tag) => [...Array(count).keys()].map((index) => ({
  title: `${tag}-${index + 1}`, prompt: `${tag} 第 ${index + 1} 镜：渔港清晨`,
  ...(kind === 'video'
    ? { taskKind: 'text_to_video', candidate: VIDEO, durationSec: 4, parameters: { resolution: '480p', generate_audio: false } }
    : { taskKind: 'text_to_image', candidate: IMAGE }),
}))

/** 起草 `count` 镜、`generate` 把它们摆上卡；顺带读回每一镜落在画布上的节点。 */
async function presentShots(walk, win, projectId, locale, count, kind = 'image') {
  const round = await present(walk, win, { locale: LOCALE[locale], kind, shots: shotsOf(count, kind) })
  const nodes = await shotNodes(win, projectId, round.operationId)
  if (!nodes.every((shot) => shot.nodeId)) throw new Error(`${round.tag}：有镜没落到画布上`)
  return { ...round, nodes }
}

/** 供应商这一轮收到的是哪几镜（提示词里的「第 N 镜」）。 */
const sentShots = (records, from) => records.slice(from).map((record) => /第 (\d+) 镜/.exec(JSON.stringify(record.body ?? record))?.[1] ?? '?')

/** 画布上这一镜的占位此刻写着什么（点卡上它的指向元素，画布先把它带到眼前，再读）。 */
async function placeholderOf(win, card, nodeId) {
  // 被去掉的那一行行尾常驻「恢复」；点那一行左边（缩略图那一块），不让「恢复」挡住定位手势。
  await clickOrFail(pointerFace(card, nodeId), '点那一镜的指向元素，把画布带到它跟前', { position: { x: 4, y: 4 } })
  const marker = win.locator(`[data-production-shot-node="${nodeId}"]`).first()
  await expect(marker, '那一镜的占位在眼前').toBeVisible({ timeout: stationTimeout() })
  return marker.getAttribute('data-shot-placeholder-state')
}

/** 主按钮此刻写的那一句（去掉回车提示）。 */
const primaryText = async (card) => ((await card.locator(CARD_PRIMARY).textContent()) ?? '').replace('⏎', '').trim()

async function runLocale(walk, win, projectId, locale) {
  const R = (n) => `${n}-${locale}`
  const L = LOCALE[locale]

  // ── 第 1–3 行：2 张图；先在节点上生成第 1 张，再在卡上生成剩下的 ──
  {
    const before = walk.fixture.images.length
    const { card, tag, turnDone, receipt, operationId, nodes } = await presentShots(walk, win, projectId, locale, 2)
    await row(R(1), '2 张图：对话里两行、确认条没有标题也没有指向元素、「生成 2 张」；没有翻页、没有可改的东西、没有「仍要生成」和价格未知', async () => {
      await expect(card.locator(CARD_TITLE)).toHaveCount(0)
      await expect(card.locator(POINTER)).toHaveCount(0)
      await expect(offerRows(card).locator(POINTER)).toHaveCount(2)
      await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 2, kind: 'image' }))
      await expect(card.locator(PAGER)).toHaveCount(0)
      await expect(card.locator(CARD_EDITORS)).toHaveCount(0)
      const text = await card.innerText()
      if (RETIRED.test(text)) throw new Error(`卡上还有退役的话：${text.replace(/\s+/g, ' ').slice(0, 160)}`)
      return text.replace(/\s+/g, ' ').slice(0, 120)
    })
    await snap(walk, R(1), 'card', card)
    await generateOnNode(win, card, nodes[0].nodeId, `${locale}：在节点上生成第 1 张`)
    await row(R(2), '节点上生成第 1 张：供应商只收到第 1 张；卡还在、问的是剩下那 1 张；第 2 张还在等你确认', async () => {
      await expect.poll(() => walk.fixture.images.length - before, { timeout: stationTimeout({ operations: 4 }) }).toBe(1)
      await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 1, kind: 'image', remaining: true }), { timeout: stationTimeout({ operations: 4 }) })
      await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 1, kind: 'image', remaining: true }))
      const sent = sentShots(walk.fixture.images, before)
      if (sent.join() !== '1') throw new Error(`供应商收到：${sent.join()}`)
      const second = await placeholderOf(win, card, nodes[1].nodeId)
      if (second !== 'awaiting_confirmation') throw new Error(`第 2 张占位：${second}`)
      return `供应商收到第 ${sent.join()} 张；第 2 张占位：${second}`
    })
    await snap(walk, R(2), 'one-left', card)
    const cardProbe = await proveProbe(card, `${locale}：卡还在`)
    await pressPrimary(card, `${locale}：「生成剩下 1 张」`)
    await row(R(3), '「生成剩下 1 张」：供应商收到第 2 张；卡关掉；回执说第 2 张在生成、第 1 张是画布上接走的', async () => {
      await expectAbsent(card, { provenBy: cardProbe, message: '卡关掉' }, stationTimeout({ operations: 4 }))
      await recorded(turnDone.received, `${tag}: generate returns`)
      await expect.poll(() => sentShots(walk.fixture.images, before).join(), { timeout: stationTimeout({ operations: 4 }) }).toBe('1,2')
      const text = receipt()
      if (!text.includes('Generating now, because the user clicked generate for each of them: shot-2')) throw new Error(`回执：${text.slice(0, 240)}`)
      if (!text.includes('shot-1 were taken over on the canvas')) throw new Error(`回执：${text.slice(0, 240)}`)
      expect((await offerFacts(win, projectId, operationId)).closedBy).toBe('handed_to_canvas')
      return `回执：${text.slice(0, 160)}`
    })
    await snap(walk, R(3), 'after-both')
  }

  // ── 第 4 行：去掉第 1 张、生成剩下的 ──
  {
    const before = walk.fixture.images.length
    const { card, tag, turnDone, receipt, operationId, nodes } = await presentShots(walk, win, projectId, locale, 2)
    await excludeShot(card, nodes[0].nodeId, `${locale}：第 1 张「不生成 ×」`)
    await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 1, kind: 'image' }), { timeout: stationTimeout({ operations: 4 }) })
    const first = await placeholderOf(win, card, nodes[0].nodeId)
    await snap(walk, R(4), 'after-remove', card)
    const label = await primaryText(card)
    await pressPrimary(card, `${locale}：「${label}」`)
    await row(R(4), '去掉第 1 张、生成剩下的：只发了第 2 张；第 1 张占位写「已去掉」；回执说第 1 张是用户去掉的', async () => {
      await recorded(turnDone.received, `${tag}: generate returns`)
      await expect.poll(() => sentShots(walk.fixture.images, before).join(), { timeout: stationTimeout({ operations: 4 }) }).toBe('2')
      if (first !== 'removed') throw new Error(`第 1 张占位：${first}`)
      if (!receipt().includes('The user removed shot-1 from the card')) throw new Error(`回执：${receipt().slice(0, 200)}`)
      expect((await offerFacts(win, projectId, operationId)).removed).toEqual(['shot-1'])
      return `主按钮「${label}」 · 第 1 张占位：${first} · 回执：${receipt().slice(0, 140)}`
    })
    await snap(walk, R(4), 'canvas')
  }

  // ── 第 5 行：节点上生成第 1 张，然后卡上「取消」 ──
  {
    const before = walk.fixture.images.length
    const { card, tag, turnDone, receipt, operationId, nodes } = await presentShots(walk, win, projectId, locale, 2)
    await generateOnNode(win, card, nodes[0].nodeId, `${locale}：在节点上生成第 1 张`)
    await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 1, kind: 'image', remaining: true }), { timeout: stationTimeout({ operations: 4 }) })
    await closeSpendCard(card, `${locale}：「取消」`)
    await row(R(5), '生成第 1 张后「取消」：第 2 张没发；回执说第 2 张用户取消了、没生成；第 1 张是画布上接走的', async () => {
      await recorded(turnDone.received, `${tag}: generate returns`)
      await expect.poll(() => sentShots(walk.fixture.images, before).join(), { timeout: stationTimeout({ operations: 4 }) }).toBe('1')
      const text = receipt()
      if (!text.includes('Not generated and nothing spent for shot-2: the user cancelled the card')) throw new Error(`回执：${text.slice(0, 240)}`)
      if (!text.includes('shot-1 were taken over on the canvas')) throw new Error(`回执：${text.slice(0, 240)}`)
      expect((await offerFacts(win, projectId, operationId)).closedBy).toBe('user_closed')
      return `回执：${text.slice(0, 160)}`
    })
    await snap(walk, R(5), 'canvas')
  }

  // ── 第 6 行：节点上生成第 1 张，然后卡开着直接打字 ──
  {
    const before = walk.fixture.images.length
    const { card, tag, receipt, request, turnDone, nodes } = await presentShots(walk, win, projectId, locale, 2)
    await generateOnNode(win, card, nodes[0].nodeId, `${locale}：在节点上生成第 1 张`)
    await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 1, kind: 'image', remaining: true }), { timeout: stationTimeout({ operations: 4 }) })
    await win.locator(`${CANVAS_PANEL} ${COMPOSER_INPUT}`).fill(interrupt(locale, tag))
    await clickOrFail(win.locator(`${CANVAS_PANEL} ${COMPOSER_SEND}`), `${locale}：卡开着时打字发出去`)
    await row(R(6), '生成第 1 张后直接打字：第 2 张没发；Agent 按打的字办，回执里知道第 2 张没生成', async () => {
      // 打的字跟着 generate 的结果一起回到模型（同一个请求）：Agent 先看到第 2 张怎么了，再按打的字办。
      await recorded(turnDone.received, `${tag}: generate returns with the typed message`)
      if (!request().includes(`${tag}_TYPED`)) throw new Error('打的字没跟着回到模型')
      await expect.poll(() => sentShots(walk.fixture.images, before).join(), { timeout: stationTimeout({ operations: 4 }) }).toBe('1')
      const text = receipt()
      if (!/the user wrote/.test(text) || !text.includes('shot-2')) throw new Error(`回执：${text.slice(0, 240)}`)
      return `回执：${text.slice(0, 160)}`
    })
    await snap(walk, R(6), 'after-typing')
  }

  // ── 第 9 行：5 张，节点上生成 1、去掉 2、节点上生成 3，然后「取消」 ──
  {
    const before = walk.fixture.images.length
    const { card, tag, turnDone, receipt, nodes } = await presentShots(walk, win, projectId, locale, 5)
    await generateOnNode(win, card, nodes[0].nodeId, `${locale}：在节点上生成第 1 张`)
    await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 4, kind: 'image', remaining: true }), { timeout: stationTimeout({ operations: 4 }) })
    await excludeShot(card, nodes[1].nodeId, `${locale}：第 2 张「不生成 ×」`)
    await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 3, kind: 'image', remaining: true }), { timeout: stationTimeout({ operations: 4 }) })
    await generateOnNode(win, card, nodes[2].nodeId, `${locale}：在节点上生成第 3 张`)
    await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 2, kind: 'image', remaining: true }), { timeout: stationTimeout({ operations: 4 }) })
    await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 2, kind: 'image', remaining: true }))
    await snap(walk, R(9), 'two-left', card)
    await closeSpendCard(card, `${locale}：「取消」`)
    await row(R(9), '5 张：节点上生成 1、3，去掉 2，然后「取消」：只发了 1、3；回执逐张说对', async () => {
      await recorded(turnDone.received, `${tag}: generate returns`)
      await expect.poll(() => sentShots(walk.fixture.images, before).sort().join(), { timeout: stationTimeout({ operations: 4 }) }).toBe('1,3')
      const text = receipt()
      for (const part of ['The user removed shot-2', 'shot-1, shot-3 were taken over on the canvas', 'Not generated and nothing spent for shot-4, shot-5: the user cancelled the card']) {
        if (!text.includes(part)) throw new Error(`回执缺「${part}」：${text.slice(0, 300)}`)
      }
      return `回执：${text.slice(0, 200)}`
    })
    await snap(walk, R(9), 'canvas')
  }

  // ── 第 10 行：只有 1 张 ──
  {
    const before = walk.fixture.images.length
    const { card, turnDone, tag } = await presentShots(walk, win, projectId, locale, 1)
    await row(R(10), '只有 1 张：没有翻页；主按钮就是「生成」', async () => {
      await expect(card.locator(PAGER)).toHaveCount(0)
      await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 1, kind: 'image', single: true }))
      return 'ok'
    })
    await snap(walk, R(10), 'card', card)
    const probe = await proveProbe(card, `${locale}：一张的卡`)
    await pressPrimary(card, `${locale}：「生成」`)
    await expectAbsent(card, { provenBy: probe, message: '卡消失' }, stationTimeout({ operations: 4 }))
    await recorded(turnDone.received, `${tag}: generate returns`)
    await expect.poll(() => walk.fixture.images.length - before, { timeout: stationTimeout({ operations: 4 }) }).toBe(1)
  }

  // ── 第 11 行：「全部生成（2）」连点两下 ──
  {
    const before = walk.fixture.images.length
    const { card, turnDone, tag } = await presentShots(walk, win, projectId, locale, 2)
    await card.locator(CARD_PRIMARY).dblclick()
    await row(R(11), '「全部生成（2）」连点两下：两张各只发一次', async () => {
      await recorded(turnDone.received, `${tag}: generate returns`)
      await expect.poll(() => sentShots(walk.fixture.images, before).sort().join(), { timeout: stationTimeout({ operations: 4 }) }).toBe('1,2')
      return `供应商收到：${sentShots(walk.fixture.images, before).sort().join()}`
    })
    await snap(walk, R(11), 'after-double-click')
  }

  // ── 第 12 行：视频的卡 ──
  {
    const before = walk.fixture.videos.length
    const { card, turnDone, tag } = await presentShots(walk, win, projectId, locale, 1, 'video')
    await row(R(12), '视频的确认：不画标题，主按钮「生成」；点了就发这一段', async () => {
      await expect(card.locator(CARD_TITLE)).toHaveCount(0)
      await expect(card.locator(CARD_PRIMARY)).toContainText(primaryLabel(L, { count: 1, kind: 'video', single: true }))
      return (await card.innerText()).replace(/\s+/g, ' ').slice(0, 120)
    })
    await snap(walk, R(12), 'card', card)
    await pressPrimary(card, `${locale}：「生成」`)
    await recorded(turnDone.received, `${tag}: generate returns`)
    await expect.poll(() => walk.fixture.videos.length - before, { timeout: stationTimeout({ operations: 4 }) }).toBe(1)
  }
}

/**
 * 换语言只重载渲染层；重载之后有时落回项目库首页（项目没跟着重开）。像人一样从项目库点开同一个项目、进生成工作区，
 * 再把常驻的 Agent 面板展开——按钮按这一种语言的字找。
 */
async function backToCanvas(win, project, locale) {
  const stage = win.locator('.generation-canvas-v2__stage')
  if (!(await stage.isVisible().catch(() => false))) {
    const projectCard = win.locator('[data-project-card="true"]').filter({ hasText: project.name }).first()
    if (await projectCard.isVisible().catch(() => false)) {
      await projectCard.hover()
      await clickOrFail(projectCard.getByRole('button', { name: /继续创作|Continue/ }), `${locale}：从项目库打开刚才那个项目`)
      await win.waitForFunction((id) => location.href.includes(`projectId=${encodeURIComponent(id)}`), project.projectId)
    }
    await clickOrFail(win.getByRole('button', { name: locale === 'zh' ? '生成' : 'Generate', exact: true }), `${locale}：生成工作区`)
    await expect(stage).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS })
  }
  await expandResidentPanel(win)
}

const upgradeFrom = process.env.NOMI_PER_SHOT_PROFILE_FROM
const previous = upgradeFrom ? JSON.parse(fs.readFileSync(upgradeFrom, 'utf8')) : null
const walk = await createRuntimeWalk(previous ? 'spend-per-shot-old-profile' : 'spend-per-shot', {
  generationProvider: 'apimart', trustFixtureOrigin: true,
  ...(previous ? { profileDir: previous.tempRoot } : {}),
})
walk.report.rows = rows
walk.report.profile = previous ? `old profile from ${upgradeFrom}` : 'fresh install'
let failure
try {
  const { win } = await walk.start({ first: !previous })
  if (previous) {
    // 老资料上一次可能停在英文界面：先切回中文再建项目（项目库的入口按钮按中文认）。
    await win.evaluate(() => localStorage.setItem('nomi:locale:v1', 'zh-CN'))
    await win.reload()
  }
  await armCanvasBridges(win)
  const project = await walk.newProject()
  await openCanvas(win)
  const noShare = win.getByRole('button', { name: '不分享', exact: true }).first()
  if (await noShare.isVisible().catch(() => false)) await noShare.click()
  // 只跑一种语言：NOMI_PER_SHOT_LOCALES=en（重拍某一种时用）；缺省中英都走。
  const locales = (process.env.NOMI_PER_SHOT_LOCALES || 'zh,en').split(',').map((value) => value.trim()).filter(Boolean)
  for (const locale of locales) {
    // 换语言只重载渲染层；落回项目库就从项目库重开同一个项目（`backToCanvas`，按钮按这一种语言的字找）。
    await win.evaluate((value) => localStorage.setItem('nomi:locale:v1', value), LOCALE[locale])
    await win.reload()
    await backToCanvas(win, project, locale)
    await runLocale(walk, win, project.projectId, locale)
  }
  console.log(`[per-shot] rows ${Object.entries(rows).map(([id, entry]) => `${id} ${entry.ok ? 'PASS' : 'FAIL'}`).join(' · ')}`)
} catch (error) {
  failure = error
  process.exitCode = 1
  await walk.snap('failure-state').catch(() => undefined)
} finally {
  await walk.finish(failure)
}
