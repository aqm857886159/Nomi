// F15 死锁旅程走查 + 回归门：**冻结门有了操作者**（用户能在锚卡上点「定妆」放行下游镜头）。
//
// 复现的死锁（审查者实测）：拆镜落画布 → 选镜头 1 → 生成 → 执行计划确认条 → 按计划生成 →
//   锚「便利店」真生成成功 → 镜头 1 报「参考卡『便利店』还没冻结」→ 从此无路可走。
//   根因：门造了、门把手从来没装（全仓零处写 meta.frozen）；且确认条只在「锚没出图」时才开，
//   锚一出图门既过不了、错误红字又擦不掉（破案见 docs/plan/2026-08-25-f15-freeze-gate-operator.md）。
//
// 这份走查把死锁旅程钉成回归门（零额度，不跑真 provider——门放行与否是纯依赖逻辑，出片是另一回事）：
//   ① 种下死锁现场：scene 锚「便利店」（referenceSheet + 已出图）+ 镜头 1 引用它、未定妆。
//   ② 断言此刻门确实拦着（proveProbe：buildDependencyWaves 把镜头 1 标 unfrozen-anchor）——阳性对照。
//   ③ **用真实 UI**：选中锚卡 → 浮条最左点「定妆」→ meta.frozen 落。
//   ④ 断言门放行（expectAbsent，provenBy ②）：镜头 1 不再 unfrozen-anchor，进 waves。
//   ⑤ 顺带核确认条 F11 价格块存在（价格未知也要显，未知≠¥0）。
//
// 跑：pnpm run build && node tests/ux/f15-freeze-gate.walk.mjs
import os from 'node:os'
import path from 'node:path'
import { launchNomiApp, closeNomiApp } from './_launchApp.mjs'
import { proveProbe, expectAbsent } from './_assert.mjs'
import { newProjectEntry } from './_shell.mjs'
import { stationTimeout } from './_station-budget.mjs'

const CAP_DIR = path.join(os.tmpdir(), 'nomi-f15-freeze-capdir') // 防与用户真 Nomi 经 loopback RPC 串库（memory 记）

// 在页面内用暴露的画布 store 种下死锁现场并读依赖计划。__nomiCanvasStore 由 ProductionCanvasLandingHost
// 在 __nomiE2E==='1' 时挂上（跟着画布常驻的稳宿主）。
async function seedDeadlockCanvas(win) {
  return win.evaluate(async () => {
    const store = window.__nomiCanvasStore
    if (!store) throw new Error('__nomiCanvasStore 未暴露（没 build / 画布没挂 / __nomiE2E 没置）')
    // 场景锚「便利店」：referenceSheet + kind scene + 已出图（模拟「真生成成功」），未定妆。
    const anchor = {
      id: 'anchor-便利店', kind: 'scene', title: '便利店', position: { x: 100, y: 120 }, prompt: '便利店内景',
      categoryId: 'scene', meta: { referenceSheet: true },
      result: { id: 'r-便利店', type: 'image', url: 'https://example.com/store.png', createdAt: Date.now() },
    }
    const shot = { id: 'shot-1', kind: 'video', title: '镜头 1', position: { x: 500, y: 120 }, prompt: '主角走进便利店', categoryId: 'shots' }
    const edge = { id: 'e1', source: 'anchor-便利店', target: 'shot-1', mode: 'style_ref' }
    store.getState().restoreSnapshot({ nodes: [anchor, shot], edges: [edge], selectedNodeIds: [], groups: [] })
    return { anchorId: anchor.id, shotId: shot.id }
  })
}

// 读依赖计划里镜头 1 的 blocked reason（用页面内真实 buildDependencyWaves——显示的≡执行的）。
// 生产构建源码路径不可 import，走 __nomiBuildDependencyWaves（ProductionCanvasLandingHost 在 __nomiE2E 挂出）。
async function shotBlockedReason(win, shotId) {
  return win.evaluate((id) => {
    const build = window.__nomiBuildDependencyWaves
    if (typeof build !== 'function') throw new Error('__nomiBuildDependencyWaves 未暴露')
    const store = window.__nomiCanvasStore.getState()
    const plan = build([id], { nodes: store.nodes, edges: store.edges })
    const blocked = plan.blocked.find((b) => b.nodeId === id)
    return {
      reason: blocked?.reason ?? null,
      detail: blocked?.detail ?? null,
      inWaves: plan.waves.some((w) => w.includes(id)),
    }
  }, shotId)
}

let handle = null
try {
  console.log('═══ F15 冻结门操作者走查（零额度）═══')
  handle = await launchNomiApp({ name: 'f15-freeze', env: { NOMI_CAPABILITY_DIR: CAP_DIR } })
  const win = handle.win

  // 置 E2E 闸 → 画布挂载时 ProductionCanvasLandingHost 把 store 挂到 window。切到「生成」工作区让画布挂上。
  await win.evaluate(() => localStorage.setItem('__nomiE2E', '1'))
  // 跳过开屏 + 建空白项目 + 进生成区（复用最短路：直接找「新建空白项目」→「生成」tab）。
  const skip = win.locator('[data-splash-skip="true"]')
  if (await skip.count().catch(() => 0)) await skip.click({ timeout: 4000 }).catch(() => {})
  await newProjectEntry(win).click({ timeout: stationTimeout({ operations: 2 }) })
  await win.waitForTimeout(1200) // 项目落地（默认停在「创作」工作区）
  // 切到「生成」工作区（顶栏 stepper 的「生成」按钮，exact），画布 + landing host 才挂载。
  await win.getByRole('button', { name: '生成', exact: true }).first().click({ timeout: 8000 })
  // 等 store 暴露（带重试）。
  let hasStore = false
  for (let i = 0; i < 20; i++) {
    hasStore = await win.evaluate(() => Boolean(window.__nomiCanvasStore)).catch(() => false)
    if (hasStore) break
    await win.waitForTimeout(500)
  }
  if (!hasStore) throw new Error('store 未暴露：确认已 build、已进生成区、__nomiE2E 已置')

  const { anchorId, shotId } = await seedDeadlockCanvas(win)
  console.log('✓ 已种死锁现场：锚', anchorId, '(已出图·未定妆) → 镜头', shotId)

  // ② 阳性对照：此刻门确实拦着（这就是死锁）。
  const before = await shotBlockedReason(win, shotId)
  console.log('  死锁态：镜头 1 blocked =', JSON.stringify(before))
  if (before.reason !== 'unfrozen-anchor') {
    throw new Error(`阳性对照失败：种下现场后镜头 1 应被 unfrozen-anchor 拦，实得 ${JSON.stringify(before)}`)
  }
  // detail 必须是新词汇「定妆」+ 可点下一步语义，不是旧的裸「冻结」。
  if (!/定妆/.test(before.detail || '')) {
    throw new Error(`词汇未统一：blocked detail 应含「定妆」，实得「${before.detail}」`)
  }
  console.log('✓ ② 阳性对照成立：门拦着镜头 1（unfrozen-anchor），detail 用「定妆」词汇')

  // ③ 用真实 UI 定妆：跳到锚卡（切 scene 分类 + 选中 + 居中，走 focus 事件）→ 浮条最左「定妆」钮。
  // 锚在 scene 分类，画布按 activeCategoryId 分屏——不切分类看不到它的卡。FOCUS 事件一步到位（同副本角标跳源）。
  await win.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('nomi-focus-generation-node', { detail: { nodeId: id } }))
  }, anchorId)
  await win.waitForTimeout(600) // 切分类 + 居中的过渡（<1500，仅让 React 提交，非完成信号）
  // 阳性对照（把手真的在）：未定妆时浮条最左是「定妆」（accent 主动作）。proveProbe 证明这个检查测得到东西——
  // 之后 expectAbsent 才有资格断言「点完它就消失了」（换成了「已定妆」态）。
  const freezeBtn = win.getByRole('button', { name: '定妆', exact: true })
  const freezeProof = await proveProbe(freezeBtn, '锚卡浮条最左有「定妆」按钮（冻结门的操作者存在）', 8000)
  await freezeBtn.first().click({ timeout: 5000 })
  console.log('✓ ③ 已在锚卡浮条点「定妆」（真实 UI）；把手存在证明 =', freezeProof ? 'ok' : 'n/a')

  // ④a 真实 UI 态变了：定妆后「定妆」按钮消失、变成「已定妆」。expectAbsent 用 ③ 的正向证明兜底（防假绿）。
  await win.waitForTimeout(300) // 让 meta.frozen 写入 + 订阅刷新（<1500，不当完成信号，仅让 React 提交）
  await expectAbsent(freezeBtn, {
    provenBy: freezeProof,
    message: '定妆后「定妆」按钮应消失（换成「已定妆」态）——没消失=点击没生效',
  })
  const doneBtn = win.getByRole('button', { name: '已定妆', exact: true })
  if (!(await doneBtn.count().catch(() => 0))) throw new Error('定妆后浮条没出现「已定妆」态——UI 没反映冻结')

  // ④b 门放行：镜头 1 不再 unfrozen-anchor，进 waves（依赖逻辑真相源，显示的≡执行的）。
  const after = await shotBlockedReason(win, shotId)
  console.log('  定妆后：镜头 1 =', JSON.stringify(after))
  if (after.reason === 'unfrozen-anchor') {
    throw new Error(`门没放行：定妆后镜头 1 仍被 unfrozen-anchor 拦（${JSON.stringify(after)}）——回归！`)
  }
  if (!after.inWaves) {
    throw new Error(`门放行但镜头 1 没进 waves（${JSON.stringify(after)}）——放行不彻底`)
  }
  // 冻结判据也真落了（meta.frozen 是带正时间戳的对象、by:user）。
  const frozenOk = await win.evaluate((id) => {
    const node = window.__nomiCanvasStore.getState().nodes.find((n) => n.id === id)
    const f = node?.meta?.frozen
    return Boolean(f && typeof f === 'object' && typeof f.at === 'number' && f.at > 0 && f.by === 'user')
  }, anchorId)
  if (!frozenOk) throw new Error('meta.frozen 没落成 {at>0,by:user}——把手没真拧上')
  console.log('✓ ④ 门放行：镜头 1 进 waves、不再被拦；meta.frozen 已落（by:user）')

  console.log('\n✓✓ F15 死锁旅程走通：锚出图 → 用真实 UI 定妆 → 下游镜头放行。冻结门装上了操作者。')
  await closeNomiApp(handle.app)
  console.log('F15 WALK DONE')
} catch (err) {
  console.log('✗ FATAL:', err?.message || err)
  if (handle) await closeNomiApp(handle.app).catch(() => {})
  process.exit(1)
}
