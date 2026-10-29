#!/usr/bin/env node
// 付费走查 env-key 凭据来源的 loopback 演练（零额度、不出网）：跑真的 openPaidWalk（设了 APIMART_API_KEY 的那一路），
// 真的 Electron、真的接入页——填一把**假 key**，APIMart 的地址被重定向到本机夹具。
//
// 证什么：
//   ① key 真的经可见接入页进去（模型设置 → APIMart 只填 key 的页 → 填写 → 保存），存住了；
//   ② key 只到过夹具（那次免费的 key 有效性探测 GET /v1/balance 的鉴权头 = 这把假 key，只此一次，没出本机）；
//   ③ 被测 App 的进程环境里 APIMART_API_KEY 是空的（子进程拿不到）；
//   ④ 页面 DOM 里没有这把 key（输入框是密码框）；
//   ⑤ 跑完整个隔离副本已删，证据目录（报告、截图、网络账本的打码副本）里搜不到这把 key；
//   ⑥ 之后的「花钱面收窄」在这一路上问的是被测 App 自己（lockSpendToModels），结果照实记进报告。
// 验证大脑模型那一半（获取可用模型 → 选 → 验证 → 等认证）用真 key 才跑得起来：loopback 夹具没有认证那一整套。
import fs from 'node:fs'
import path from 'node:path'

import { expect } from './_assert.mjs'
import { ENV_KEY_VAR, assertNoSecretOnDisk, filesContainingSecret } from './_paidEnvKey.mjs'
import { openPaidWalk } from './_paidRun.mjs'
import { stationTimeout } from './_station-budget.mjs'
import { CREATION_PANEL, chooseAssistantModel, createRuntimeWalk, expandResidentPanel, sendCreation } from './agent-runtime-walk-support.mjs'

// 一眼就是假的：形状够长，值没有任何真实含义。
const FAKE_KEY = 'rehearsal-fake-key-0123456789abcdef'
const MODELS = [{ vendorKey: 'apimart', modelKey: 'deepseek-v4-flash' }, { vendorKey: 'apimart', modelKey: 'gpt-image-2' }]

const paid = await openPaidWalk('paid-env-key-connect.rehearsal.walk.mjs', 'paid-env-key-connect-rehearsal', MODELS, {
  env: { ...process.env, CI: '', NOMI_SPEND_OK: '1', [ENV_KEY_VAR]: FAKE_KEY },
  // 夹具那一档：APIMart 地址重定向到本机；不预置那把钥匙，让走查自己走接入页填。
  // 放行名单清空：就算哪一层没重定向，真请求也会被走查闸当场挡下（不是悄悄出网）。
  createWalk: (name, options) => createRuntimeWalk(name, {
    ...options, generationProvider: 'apimart', seedApimartKey: false, env: { ...options.env, NOMI_WALK_ALLOW_ORIGINS: '' },
  }),
})
const { walk } = paid
let failure
try {
  const { win, app } = await walk.start({ first: true })
  // ③ 被测 App 主进程的环境里 APIMART_API_KEY 是空的（走查进程的闭包之外没人拿得到这把 key）。
  expect(await app.evaluate((name) => process.env[name] ?? '', ENV_KEY_VAR), '被测 App 的进程环境里没有这把 key').toBe('')
  // 接入页走完「保存」，然后问被测 App 这些模型能不能用。
  // 在项目库页上接入、而且赶在页面刚（重）载的那一刻（waitUntil: commit，React 还没挂好监听）：接入要走看得见的顶栏齿轮 → 模型页，
  // 它会等入口出现；往 window 上派事件的老做法在这一刻发出去就丢了（修前这里红：等不到模型设置页，15 秒超时）。
  await win.reload({ waitUntil: 'commit' })
  let lockRefusal = null
  try { await paid.lockToAuthorizedModels(win) } catch (error) { lockRefusal = error }
  await walk.snap('env-key-00-after-connect-attempt')
  walk.report.lockRefusalFull = lockRefusal ? String(lockRefusal.message).slice(0, 1500) : null
  // 夹具里保存 key 之后模型是否已经「能用」是夹具的事实（真 App 上要等验证晋升）：只记事实，不当判据；
  // 无论哪种，拒绝的理由里都不能带 key。
  if (lockRefusal) expect(lockRefusal.message, '拒绝的理由里不能带 key').not.toContain(FAKE_KEY)
  walk.report.lockRefusal = lockRefusal ? String(lockRefusal.message).slice(0, 200) : null

  // ① key 经接入页存住了，且被授权的模型已可用 → 跳过「继续验证」那一半（loopback 夹具没有认证那一整套，真 key 上才会走它）。
  await walk.newProject() // 接入完了再开项目：下面 Agent 说话那一步要在项目里
  expect(walk.report.envKeyConnect?.keySaved, '接入页保存成功').toBe(true)
  expect(walk.report.envKeyConnect?.verification, '保存后预置模型已可用，跳过验证').toContain('skipped')
  expect(lockRefusal, '花钱面收窄通过（被授权的模型可用，其余生成模型已停）').toBeNull()
  await walk.snap('env-key-01-zh-after-connect')
  // ④ DOM 里没有这把 key。
  const domHasKey = await win.evaluate((needle) => document.documentElement.outerHTML.includes(needle), FAKE_KEY)
  expect(domHasKey, '页面 DOM（含文字节点）里没有这把 key').toBe(false)
  // ② 夹具只收到那一次免费探测，鉴权头是这把假 key。
  expect(walk.fixture.balanceProbes, 'key 有效性探测只发了一次、只到过本机夹具').toHaveLength(1)
  expect(walk.fixture.balanceProbes[0].authorization, '探测带的就是填进去的那把 key').toBe(`Bearer ${FAKE_KEY}`)
  // ⑦ 接入完成后 Agent 真的能用这把 key 说话：选被授权的大脑模型、发一句话，夹具（= 重定向后的 APIMart）收到一次对话请求，
  //    鉴权头就是这把 key（不是空的环境变量、不是别的凭据），面板上出现夹具回的那句话、没有红卡。
  //    2026-10-16 真 key 首跑：每轮都是红卡「服务商返回了一个没见过的错误」、0 token——这一步就是为它守的。
  walk.fixture.respond({ label: 'rehearsal chat', match: () => true, reply: { type: 'text', text: 'REHEARSAL_BRAIN_OK' } })
  await expandResidentPanel(win)
  await chooseAssistantModel(win, paid.label('apimart', 'deepseek-v4-flash'), CREATION_PANEL)
  await sendCreation(win, '你好，请回复一个字。')
  await expect(win.locator(`${CREATION_PANEL} [data-v4-block="assistant"]`).filter({ hasText: 'REHEARSAL_BRAIN_OK' }).first(), 'Agent 用这把 key 说话成功').toBeVisible({ timeout: stationTimeout({ turns: 1 }) })
  expect(walk.fixture.requests.length, '夹具收到对话请求').toBeGreaterThan(0)
  expect(walk.fixture.requests[0].authorization, 'Agent 对话请求带的就是接入页填的 key').toBe(`Bearer ${FAKE_KEY}`)
  walk.report.verified = ['key-through-visible-page', 'probe-only-to-loopback', 'dom-has-no-key', 'agent-chat-uses-saved-key']
  walk.report.tempRootBeforeFinish = walk.report.tempRoot
} catch (error) {
  failure = error
  process.exitCode = 1
} finally {
  // 失败 / 成功都走 finish：关 App、取证据、打码网络账本、删整个隔离副本、搜证据目录里的 key。
  const tempRoot = walk.report.tempRoot
  const outputDir = walk.outputDir
  try { await paid.finish(failure) } catch (error) { failure ??= error; process.exitCode = 1; console.error(String(error?.message ?? error)) }
  // ⑤ 跑完整个隔离副本已删；证据目录里没有 key；打码过的网络账本在。
  try {
    expect(fs.existsSync(tempRoot), '整个隔离副本已删除').toBe(false)
    expect(filesContainingSecret(outputDir, [FAKE_KEY]), '证据目录里搜不到这把 key').toEqual([])
    assertNoSecretOnDisk(outputDir, [FAKE_KEY])
    expect(fs.existsSync(path.join(outputDir, 'net-log.redacted.jsonl')), '打码过的网络账本在证据目录里').toBe(true)
    const report = JSON.parse(fs.readFileSync(path.join(outputDir, 'report.json'), 'utf8'))
    expect(report.isolatedCopyRemoved, '报告记了隔离副本已删').toBe(true)
    expect(report.credentialSource, '报告只记凭据来源的变量名').toContain(ENV_KEY_VAR)
  } catch (error) {
    process.exitCode = 1
    console.error(`收尾核对没过：${String(error?.message ?? error)}`)
  }
}
