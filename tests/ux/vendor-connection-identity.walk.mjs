// 真实用户走查：同一个中转站的三个计价分组，各自是一条独立连接（GitHub issue #831）。
//
// 复刻报告人现场：同一个 Base URL、三把不同的 Key、三个不同的名字。改之前，加第二条会把
// 第一条的名字和 Key 当场覆盖（三个分组变成一个）。
//
// 本走查不打真实上游、不花额度：自带一个假的 OpenAI 兼容网关跑在 127.0.0.1 随机端口，
// 只提供 /v1/models。zh / en 两轨各跑一遍（R15：EN 串长 1.5-2 倍，截断只有眼睛看得出）。
//
// 用法: node tests/ux/vendor-connection-identity.walk.mjs
// 截图保存在系统临时目录。
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp } from './_launchApp.mjs'
import { screenshotSettled } from './_assert.mjs'
import { openCustomApiWizard, openModelSettings, setAppLanguage } from './_shell.mjs'
import { assertOutsideRepo } from './uiDriverOptions.mjs'

const shotsDir = fs.mkdtempSync(path.join(assertOutsideRepo(os.tmpdir()), 'nomi-vendor-connection-identity-shots-'))
process.env.EVIDENCE_DIR = shotsDir

const MODELS = ['seedance-2.0', 'seedance-2.0-mini', 'seedance-2.0-fast']
const gateway = http.createServer((req, res) => {
  if ((req.url || '').startsWith('/v1/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ object: 'list', data: MODELS.map((id) => ({ id, object: 'model' })) }))
  }
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'walkthrough gateway: only /v1/models' } }))
})
await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve))
const gatewayBase = `http://127.0.0.1:${gateway.address().port}/v1`
console.log(`— 假网关: ${gatewayBase} —`)

const failures = []
function check(ok, label) {
  if (ok) {
    console.log(`  ✓ ${label}`)
  } else {
    console.error(`  ✗ ${label}`)
    failures.push(label)
  }
}

const { app, win } = await launchNomiApp({
  name: 'vendor-connection-identity',
  initialLocalStorage: {
    'nomi:locale:v1': 'zh-CN',
    'nomi:splash:v1': 'seen',
    'nomi:journey-tour:v1': 'seen',
  },
})

let n = 0
async function snap(name) {
  n += 1
  const tag = `${String(n).padStart(2, '0')}-${name}`
  await screenshotSettled(win, { path: path.join(shotsDir, `${tag}.png`) })
  console.log(`  · shot ${tag}`)
}

async function clickFirst(patterns, label) {
  for (const pattern of patterns) {
    const target = win.locator('button, [role="button"], a, div[role="menuitem"], summary', { hasText: pattern }).first()
    if (await target.count()) {
      await target.click().catch(() => {})
      await win.waitForTimeout(900)
      return true
    }
  }
  console.log(`  ! 没找到「${label}」`)
  return false
}

async function closeOverlays() {
  for (let i = 0; i < 6; i += 1) {
    await win.keyboard.press('Escape').catch(() => {})
    await win.waitForTimeout(220)
  }
}

/** 目录里现在有哪几条连接（读真实主进程目录，不是读 DOM 的猜测）。 */
async function listConnections() {
  return win.evaluate(async () => {
    const rows = await window.nomiDesktop.modelCatalog.listVendors()
    return rows.map((row) => ({
      key: String(row.key ?? ''),
      name: String(row.name ?? ''),
      baseUrl: String(row.baseUrlHint ?? ''),
      hasApiKey: Boolean(row.hasApiKey),
    }))
  })
}

/** 在打开的表单里填三格。返回填完之后那行 hint 的 marker（none 时为 null）。 */
async function fillConnectionForm({ name, apiKey }) {
  const inputs = win.locator('input')
  const count = await inputs.count()
  for (let i = 0; i < count; i += 1) {
    const box = inputs.nth(i)
    const placeholder = (await box.getAttribute('placeholder')) || ''
    const type = (await box.getAttribute('type')) || ''
    if (/搜索|Search|TikHub/i.test(placeholder)) continue
    if (/socks5|7897|代理|proxy/i.test(placeholder)) continue
    if (/http|api\.|地址|url|base/i.test(placeholder)) await box.fill(gatewayBase).catch(() => {})
    else if (type === 'password' || /key|密钥/i.test(placeholder)) await box.fill(apiKey).catch(() => {})
    else if (/TOAPI|来源|名称|Source|name/i.test(placeholder)) await box.fill(name).catch(() => {})
  }
  await win.waitForTimeout(700)
  const hint = win.locator('[data-field-hint]').first()
  return (await hint.count()) ? hint.getAttribute('data-field-hint') : null
}

/**
 * 提示行里被抬成 ink 色 + 中粗的那一段是什么、它跟整句是不是真的不同色。
 * 只断言「有这一段且颜色与整句不同」——不比字面色值（oklch 序列化是已知的坑）。
 */
async function hintEmphasis() {
  return win.evaluate(() => {
    const line = document.querySelector('[data-field-hint]')
    const mark = line?.querySelector('[data-field-hint-emphasis]')
    if (!line || !mark) return null
    return {
      text: (mark.textContent || '').trim(),
      sameColorAsLine: getComputedStyle(mark).color === getComputedStyle(line).color,
      weight: getComputedStyle(mark).fontWeight,
    }
  })
}

async function saveConnection(hints) {
  await clickFirst(hints.save, '保存连接')
  await win.waitForTimeout(1600)
}

const GROUPS = [
  { name: 'Full tier', apiKey: 'sk-walk-full' },
  { name: 'Mini tier', apiKey: 'sk-walk-mini' },
  { name: 'Fast tier', apiKey: 'sk-walk-fast' },
]

async function runTrack(track, hints) {
  console.log(`\n=== ${track} 轨 ===`)
  for (const [index, group] of GROUPS.entries()) {
    await openCustomApiWizard(win)
    const marker = await fillConnectionForm(group)
    await snap(`${track}-${index + 1}-form-${group.name.replace(/\s+/g, '-').toLowerCase()}`)
    if (index === 0) {
      check(marker === null, `${track}·第 1 条：地址没被占，不出重复提示（marker=${marker}）`)
    } else {
      check(
        marker === 'duplicate-host-create',
        `${track}·第 ${index + 1} 条：撞域名 + 新名字 → 出「会新建独立连接」那一句（marker=${marker}）`,
      )
      // 拍板：整句 muted，**只有连接名**抬成 ink 色 + 中粗。
      const emphasis = await hintEmphasis()
      check(
        Boolean(emphasis) && emphasis.text.length > 0 && !emphasis.sameColorAsLine && Number(emphasis.weight) >= 500,
        `${track}·第 ${index + 1} 条：提示行里的连接名是 ink 加粗、与整句不同色（${JSON.stringify(emphasis)}）`,
      )
    }
    await saveConnection(hints)
    await closeOverlays()
  }

  const connections = (await listConnections()).filter((row) => row.baseUrl === gatewayBase)
  console.log(`  · 目录里的连接: ${JSON.stringify(connections)}`)
  check(connections.length === 3, `${track}：三条连接都在（实际 ${connections.length} 条）`)
  for (const group of GROUPS) {
    check(connections.some((row) => row.name === group.name), `${track}：连接「${group.name}」名字没被覆盖`)
  }
  check(new Set(connections.map((row) => row.key)).size === connections.length, `${track}：三条 key 互不相同`)
  check(connections.every((row) => row.hasApiKey), `${track}：三条各自都有自己的 Key`)

  // 同名那一次：提示行必须改口说「会更新」，不能还说「会新建」。
  await openCustomApiWizard(win)
  const updateMarker = await fillConnectionForm({ name: 'Mini tier', apiKey: 'sk-walk-mini-2' })
  await snap(`${track}-4-form-same-name-update`)
  check(
    updateMarker === 'duplicate-host-update',
    `${track}：同域名 + 同名 → 改口说「会更新连接的 Key」（marker=${updateMarker}）`,
  )
  await closeOverlays()

  // 删一条，另外两条纹丝不动。
  const victim = connections.find((row) => row.name === 'Mini tier')
  await win.evaluate((key) => window.nomiDesktop?.modelCatalog?.deleteVendor?.(key), victim.key)
  await win.waitForTimeout(800)
  const left = (await listConnections()).filter((row) => row.baseUrl === gatewayBase)
  check(left.length === 2, `${track}：删一条后剩两条（实际 ${left.length}）`)
  check(
    left.some((row) => row.name === 'Full tier') && left.some((row) => row.name === 'Fast tier'),
    `${track}：删「Mini tier」不影响另外两条`,
  )
  // 拍**改动区**：删完之后的连接列表（看得见剩下两条的名字），不是空的添加表单。
  await openModelSettings(win)
  const rows = win.locator('[data-model-home-connection]')
  await rows.first().waitFor({ state: 'visible' })
  const listedNames = await win.evaluate(() =>
    [...document.querySelectorAll('[data-model-home-connection]')].map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim()))
  console.log(`  · 连接列表: ${JSON.stringify(listedNames)}`)
  check(
    listedNames.some((t) => t.includes('Full tier')) && listedNames.some((t) => t.includes('Fast tier')),
    `${track}：删除后的连接列表里仍看得见 Full tier 与 Fast tier`,
  )
  check(
    !listedNames.some((t) => t.includes('Mini tier')),
    `${track}：删掉的 Mini tier 已经不在列表里`,
  )
  // 把剩下那两条滚进画面再拍——改动区在视口外，截图就证明不了任何事（R13 眼见链）。
  await rows.last().scrollIntoViewIfNeeded()
  await win.waitForTimeout(400)
  const visibleAfterScroll = await win.evaluate(() => {
    const view = { top: 0, bottom: window.innerHeight }
    return [...document.querySelectorAll('[data-model-home-connection]')]
      .filter((el) => {
        const box = el.getBoundingClientRect()
        return box.top >= view.top && box.bottom <= view.bottom
      })
      .map((el) => (el.textContent || '').replace(/\s+/g, ' ').trim())
  })
  check(
    visibleAfterScroll.some((t) => t.includes('Full tier')) && visibleAfterScroll.some((t) => t.includes('Fast tier')),
    `${track}：两条幸存连接都在视口内（截图拍得到改动区）`,
  )
  await snap(`${track}-5-connections-after-delete`)
  await closeOverlays()
}

// ── zh 轨 ──
await snap('zh-app-ready')
await runTrack('zh', {
  save: [/保存连接/],
})

await setAppLanguage(win, 'en')
const locale = await win.evaluate(() => document.documentElement.lang)
check(String(locale).startsWith('en'), `界面真的切到 English（locale=${locale}）`)
await closeOverlays()
await snap('en-app-ready')

// en 轨从干净目录重来：把 zh 轨留下的连接删掉。
for (const row of (await listConnections()).filter((r) => r.baseUrl === gatewayBase)) {
  await win.evaluate((key) => window.nomiDesktop?.modelCatalog?.deleteVendor?.(key), row.key)
}
await win.waitForTimeout(800)

await runTrack('en', {
  save: [/Save connection/i],
})

console.log(`\n截图落在 ${shotsDir}`)
await app.close()
gateway.close()

if (failures.length > 0) {
  console.error(`\n✖ 走查失败 ${failures.length} 条：`)
  for (const failure of failures) console.error(`   · ${failure}`)
  process.exit(1)
}
console.log('\n✅ 走查全绿（截图仍需人眼过一遍）')
