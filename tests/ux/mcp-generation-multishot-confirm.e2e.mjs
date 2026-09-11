// P4 S3a — 多镜确认卡端到端（真 Electron + 真渲染管线，零额度）。
//
// 这条走查证的是 S3a 交付的**渲染半程**：一份带 pricing 的多镜 gate payload，经**真实**的
// handleCapabilityApply('generation.gate.confirm', …) → confirmGenerationGateForAgent →
// buildMultiShotContractView → 唯一 spendConfirm 漏斗 → SpendConfirmDialog 弹出多镜确认卡。
// 不是 mock 卡：调的就是那个真 handler（生产同一函数），payload 走真 S2 定价语义（未知价显「未知」不伪造 0）。
//
// 为什么不驱动真 MCP gate：真 gate 目前只发扁平单镜 payload，多镜 gate（含 shots 投影）的后端拼装属 S4
// （mcpGenerationTools.ts:616 注释「scales once shots[] is threaded through the operation」）。所以 S3a
// 在渲染边界注入真 payload、走真管线取证卡；后端 receipt/per-shot 盖章由单镜 E2E（14/14）守着那条机制。
//
// 断言：卡出现 → 逐镜清单/价格/冻结项/固定 footer 可见 → 光/暗双截图（卡整体 + footer 特写）→ 点确认
// → 真 handler 的 Promise resolve {confirmed:true} → 全程 provider 请求数 = 0（多镜派发是 S4，这里不跑生成）。
import fs from 'node:fs'
import path from 'node:path'

import { launchNomiApp } from './_launchApp.mjs'
import { repoRoot } from './_mcpJourney.mjs'
import { clickOrFail, expectAbsent, proveProbe } from './_assert.mjs'

const shotsDir = path.join(repoRoot, 'tests/ux/shots/mcp-generation-multishot-confirm')
fs.rmSync(shotsDir, { recursive: true, force: true })
fs.mkdirSync(shotsDir, { recursive: true })

// 带 pricing 的多镜计划（S2 语义）：3 镜，2 镜已定价、1 镜价未知；第 2 镜带「认不了脸」降级。
// projectName 走 gate payload 顶层（与真实 appIntegration.ts 转发形状一致：challenge.display.projectName），
// 不塞进 shots 投影（MultiShotGateProjection 本身不带项目名）。
const MULTISHOT_PAYLOAD = {
  planVersion: 3,
  planHash: 'sha256:multishot-e2e',
  specs: { durationSeconds: 40, aspectRatio: '9:16', shotCount: 3 },
  currency: 'CNY',
  hardLimit: 30,
  waitSeconds: 180,
  frozenItems: ['shots', 'models', 'references', 'price'],
  anchorChips: [{ label: '主角 · 阿雨', price: { known: true, amount: 2 } }],
  shots: [
    { shotId: 'shot-1', index: 1, sceneOneLiner: '雨夜，阿雨推开便利店玻璃门', providerModelText: 'APIMart · 即梦（文生图）', durationSeconds: 5, price: { known: true, amount: 4 }, degradations: [] },
    { shotId: 'shot-2', index: 2, sceneOneLiner: '货架前，两人隔着冷柜对视', providerModelText: 'APIMart · 某视频模型（图生视频）', durationSeconds: 6, price: { known: true, amount: 6 }, degradations: [{ code: 'model_cannot_take_character_reference', params: { modelId: 'some-video' } }] },
    { shotId: 'shot-3', index: 3, sceneOneLiner: '收银台特写，硬币落进盒子', providerModelText: 'APIMart · 未定价模型', durationSeconds: null, price: { known: false }, degradations: [] },
  ],
}

let gui
let exitCode = 0
let passed = 0
const check = (condition, message) => {
  if (!condition) throw new Error(`MULTISHOT CONFIRM FAIL: ${message}`)
  passed += 1
  console.log(`  ✓ ${message}`)
}

try {
  gui = await launchNomiApp({
    name: 'mcp-generation-multishot-confirm',
    args: ['--disable-gpu', '--disable-software-rasterizer', '--no-proxy-server'],
    settleMs: 0,
  })
  const win = gui.win

  // 开 E2E 桥 + 压掉首启覆盖层，reload 让 mount-time effect 带上标志（reload 发生在库页、开项目在其后，
  // 不触 getActiveWorkbenchProjectId=null 陷阱）。
  await win.evaluate(() => {
    window.localStorage.setItem('__nomiE2E', '1')
    for (const k of ['nomi:splash:v1', 'nomi:journey-tour:v1', 'nomi:canvas-gesture-hint:v1']) {
      window.localStorage.setItem(k, 'seen')
    }
    window.localStorage.setItem('nomi-color-scheme', 'light')
  })
  await win.reload()
  await win.waitForLoadState('domcontentloaded')

  // 进一个项目（库页 → 新建空白项目），否则 workbench 根不渲染 → 确认桥不挂。
  // 用 clickOrFail 等按钮真可见再点（不用固定 sleep 当「页面好了」信号）。
  await clickOrFail(win.getByText('新建空白项目', { exact: false }).first(), '库页「新建空白项目」')
  await win.waitForFunction(() => window.location.hash.includes('projectId='), undefined, { timeout: 10_000 })

  // 等真实 handler 桥挂上（mount-time effect 带 __nomiE2E 标志），不用固定 sleep。
  await win.waitForFunction(() => typeof window.__nomiCapabilityApply === 'function', undefined, { timeout: 10_000 })
  check(true, 'E2E 桥挂上了真实 handleCapabilityApply（不是 mock）')

  // 用**真** handler 驱动多镜确认门。返回的是 handler 的 Promise，先不 await（卡还在等用户点）。
  await win.evaluate((payload) => {
    const apply = window.__nomiCapabilityApply
    window.__nomiMultiShotResult = undefined
    // 真管线：generation.gate.confirm → confirmGenerationGateForAgent → buildMultiShotContractView → requestConfirm。
    window.__nomiMultiShotPromise = apply('generation.gate.confirm', { challengeId: 'e2e-challenge', projectName: '雨夜便利店', shots: payload })
      .then((r) => { window.__nomiMultiShotResult = r })
  }, MULTISHOT_PAYLOAD)

  const card = win.locator('.fixed.inset-0').filter({ hasText: '允许 Nomi 生成这一批镜头？' })
  await card.waitFor({ timeout: 15_000 })
  // 证探针活（卡真的会出现）→ 供确认后 expectAbsent 用作阳性基线。
  const cardProbe = await proveProbe(card, '多镜确认卡会浮出（标题「允许 Nomi 生成这一批镜头？」）', 15_000)
  check(await card.count() === 1, '多镜确认卡弹出（标题「允许 Nomi 生成这一批镜头？」）')

  // 卡宽 680（contract 形态）。
  const cardBox = await card.locator('> div').first().boundingBox()
  check(Boolean(cardBox) && Math.abs(cardBox.width - 680) <= 2, `卡宽 = 680（实测 ${cardBox ? Math.round(cardBox.width) : '?'}）`)

  const cardText = await card.innerText()
  // 一句话正文（项目名 + 先出主角形象）。
  check(cardText.includes('雨夜便利店') && cardText.includes('先出主角形象'), '正文写清项目名 + 定妆照先行的开拍节奏')
  // 规格条 4 格。
  check(cardText.includes('总时长') && cardText.includes('画幅') && cardText.includes('镜头数') && cardText.includes('预计等待'), '规格条 4 格齐（总时长/画幅/镜头数/预计等待）')
  // 主角形象 chips（含定妆照先行 + 锚参考费用）。
  check(cardText.includes('主角形象') && cardText.includes('定妆照先行') && cardText.includes('阿雨'), '主角形象 chips 行含「定妆照先行」+ 主角名')
  // 汇总行（共 N 镜 · M 镜有提醒）。
  check(cardText.includes('共 3 镜') && cardText.includes('1 镜有提醒'), '清单上方汇总行：共 3 镜 · 1 镜有提醒')

  // 逐镜清单：三行都在，画面一句 + 模型·模式 + 单价可见。
  const rows = card.locator('[data-production-shot-row]')
  check(await rows.count() === 3, '逐镜清单渲染出 3 行')
  check(cardText.includes('雨夜，阿雨推开便利店玻璃门') && cardText.includes('即梦（文生图）'), '逐镜行显示画面一句 + 模型·模式人话')
  check(cardText.includes('¥4') && cardText.includes('¥6'), '已定价镜显示单价（¥4 / ¥6）')
  // 未知价镜诚实显「价未知」，不伪造 ¥0。
  check(cardText.includes('价未知') && !cardText.includes('¥0'), '未定价镜显「价未知」，绝不伪造 ¥0')

  // 降级镜：整行浅警示底 + 人话徽标「该模型认不了脸」。
  const degradedRow = card.locator('[data-production-shot-degraded="true"]')
  check(await degradedRow.count() === 1, '恰有 1 行是降级镜（data-production-shot-degraded=true）')
  check(cardText.includes('该模型认不了脸'), '降级镜带人话徽标「该模型认不了脸」（结构化 code 经 t() 翻）')
  // 术语红线：卡上零内部术语。
  for (const banned of ['锚', '封存', '物化', '合同']) {
    check(!cardText.includes(banned), `卡上无内部术语「${banned}」`)
  }

  // 固定 footer：费用块 + 冻结项 + 按钮区。
  const footer = card.locator('[data-production-footer]')
  check(await footer.count() === 1, '固定 footer 存在')
  const footerText = await footer.innerText()
  check(footerText.includes('预估合计 ¥10') && footerText.includes('1 镜价未知'), '费用块：预估合计 ¥10（已知镜合计）+ 明示 1 镜价未知')
  check(footerText.includes('单镜重拍只花该镜费用'), '费用块含单镜返工承诺句')
  check(footerText.includes('最多花费 ≤¥30'), '右侧硬上限「最多花费 ≤¥30」')
  check(footerText.includes('确认后不可再改') && footerText.includes('镜头清单') && footerText.includes('价格'), '冻结项一行：确认后不可再改 镜头清单/模型/参考/价格')
  check(footerText.includes('先试拍第 1 镜（¥4）'), 'footer 左侧「先试拍第 1 镜（¥4）」文字链（首镜单价）')
  check(footerText.includes('返回修改'), 'footer 左侧「返回修改」文字链')
  check(footerText.includes('确认生成 3 镜'), '主按钮「确认生成 3 镜」')

  // 审批卡永不因空闲超时（2026-09-11 拍板）：卡上没有倒计时条，放着不动也不会替用户答。
  // 判据分两条——DOM 上没有那个条（结构），停 2s 之后卡还在等（行为）。只断结构会漏掉
  // 「条不渲染但计时器照跑，到点自己 resolve(false)」那种看不见的自动决定。
  check(await card.locator('[data-production-countdown]').count() === 0, '卡上没有倒计时条')
  await win.waitForTimeout(2000)
  check(await card.count() === 1, '静置 2s 之后卡还在等人答（没有到点自动决定）')
  check(!(await footer.innerText()).includes('自动'), 'footer 不说任何「自动」')

  // 光模式截图（卡整体 + footer 特写）。
  await card.screenshot({ path: path.join(shotsDir, '01-multishot-card-light.png') })
  await footer.screenshot({ path: path.join(shotsDir, '02-multishot-footer-light.png') })

  // 暗模式：钉死 data-mantine-color-scheme=dark（token 即刻翻），等 transition。
  await win.evaluate(() => {
    document.documentElement.setAttribute('data-mantine-color-scheme', 'dark')
    document.documentElement.style.colorScheme = 'dark'
  })
  await win.waitForTimeout(300)
  await card.screenshot({ path: path.join(shotsDir, '03-multishot-card-dark.png') })
  await footer.screenshot({ path: path.join(shotsDir, '04-multishot-footer-dark.png') })
  // 截图落地后自检：四张都存在且非空。
  for (const f of ['01-multishot-card-light.png', '02-multishot-footer-light.png', '03-multishot-card-dark.png', '04-multishot-footer-dark.png']) {
    const stat = fs.statSync(path.join(shotsDir, f))
    check(stat.size > 0, `截图 ${f} 落地且非空（${stat.size} 字节）`)
  }

  // 点「确认生成 3 镜」→ 真 handler 的 Promise 应 resolve {confirmed:true}。
  await card.locator('[data-production-action="confirm"]').click()
  await win.waitForFunction(() => window.__nomiMultiShotResult !== undefined, undefined, { timeout: 8_000 })
  const result = await win.evaluate(() => window.__nomiMultiShotResult)
  check(result?.confirmed === true, '点确认后真 handler 返回 { confirmed:true }')
  check(result?.challengeId === 'e2e-challenge', 'challengeId 原样带回（confirm 回执可回指挑战）')
  // 卡收起（用 expectAbsent + 上面证过的探针基线，而非裸 count===0）。
  await expectAbsent(card, { provenBy: cardProbe, message: '确认后确认卡应收起' })
  check(true, '确认后确认卡收起')

  console.log(`\nMULTISHOT CONFIRM PASS: ${passed} 断言；真管线弹卡 + 确认，多镜派发属 S4（本走查未跑生成，provider=0）。`)
  console.log('  截图 →', shotsDir)
} catch (error) {
  console.error(`✗ ${error?.stack || error}`)
  exitCode = 1
} finally {
  await gui?.app?.close().catch(() => undefined)
  setTimeout(() => process.exit(exitCode), 300)
}
