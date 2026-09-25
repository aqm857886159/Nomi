// 画布跟手量具 · 提示词面板上的动作：打字、@ 素材、「图生视频」下 @ 画布视频、时长滑杆、自动保存。
// 全部在待写视频节点（Seedance 2.0）上做；判定放在入口文件里。
import { beginMeasure, endMeasure, maxGapIn, median, maxOf, r1, firstAfter, perKeyLatency, renderSummary } from './probe.mjs'
import { EDITOR, selectIdle, storeNode, sleep } from './session.mjs'
import { installPoll, pollLog, clearPoll } from './scenarios-canvas.mjs'
import { readSavedNode, projectFileMtimes } from './fixture.mjs'

const EDITOR_WATCH = '[data-composer-host] .ProseMirror'

async function clearEditor(s) {
  await s.win.locator(EDITOR).first().click()
  await s.win.keyboard.press('Control+A'); await s.win.keyboard.press('Backspace'); await sleep(350)
}

/** 20 个字 × 3 轮：按键到画面、最长帧；再打 5 个字开渲染计数：每键重渲组件数（按区域）+ 前 15 个组件名。 */
export async function typing(s, idleId, { rounds = 3, chars = 'abcdefghijklmnopqrst', renderKeys = 'abcde' } = {}) {
  await selectIdle(s, idleId)
  const runs = []
  for (let rep = 0; rep < rounds; rep++) {
    await clearEditor(s)
    const t0 = await beginMeasure(s.win, { watch: EDITOR_WATCH })
    await s.win.keyboard.type(chars, { delay: 90 })
    const m = await endMeasure(s.win, t0, { settleMs: 600 })
    const keys = perKeyLatency(m)
    const firstKey = m.events.find((e) => e.type === 'keydown')
    runs.push({ keys: keys.length, toPaintMedian: r1(median(keys.map((k) => k.toPaint))), toPaintMax: r1(maxOf(keys.map((k) => k.toPaint))), maxFrame: maxGapIn(m.frames, firstKey?.t ?? m.t0, m.t1), longtasks: m.longtasks.map(([, d]) => d) })
  }
  await clearEditor(s)
  const t0 = await beginMeasure(s.win, { watch: EDITOR_WATCH, renders: true, focusNode: idleId })
  await s.win.keyboard.type(renderKeys, { delay: 160 })
  const m = await endMeasure(s.win, t0, { settleMs: 700 })
  const renders = renderSummary(m.commits)
  renders.perKey = r1(renders.rendered / renderKeys.length)
  renders.perKeyByRegion = Object.fromEntries(Object.entries(renders.byRegion).map(([k, v]) => [k, r1(v / renderKeys.length)]))
  const text = await s.win.locator(EDITOR).first().textContent()
  return { runs, toPaintMedian: median(runs.map((r) => r.toPaintMedian)), toPaintMax: median(runs.map((r) => r.toPaintMax)), maxFrame: median(runs.map((r) => r.maxFrame)), renders, typedLanded: text.includes(renderKeys) }
}

/** 一个字的结构检查（快速档）：只打 1 个字，别的节点必须 0 重渲；本卡编辑器必须有重渲（探针阳性对照）。 */
export async function typingOneKey(s, idleId) {
  await selectIdle(s, idleId)
  await clearEditor(s)
  const t0 = await beginMeasure(s.win, { watch: EDITOR_WATCH, renders: true, focusNode: idleId })
  await s.win.keyboard.type('x')
  const m = await endMeasure(s.win, t0, { settleMs: 900 })
  const renders = renderSummary(m.commits)
  const otherNodeSample = [...new Set(m.commits.flatMap((c) => c.otherNodeIds))].slice(0, 8)
  return { ...renders, otherNodeSample, composerOrFocus: (renders.byRegion.composer || 0) + (renders.byRegion.focusNode || 0) }
}

const waitList = (s, ms = 2500) => s.win.locator('[data-mention-list] [data-mention-item]').first().waitFor({ state: 'attached', timeout: ms }).then(() => true, () => false)

/** 全能参考模式下 @：打 @ → 列表出现 → 缩略图全部出现 → 回车选中 → chip 出现；3 轮 + 1 轮渲染计数。 */
export async function atMention(s, idleId, { rounds = 3 } = {}) {
  await selectIdle(s, idleId)
  await resetReferences(s, idleId)
  await installPoll(s.win)
  const runs = []
  for (let rep = 0; rep < rounds; rep++) {
    await clearEditor(s); await clearPoll(s.win)
    const t0 = await beginMeasure(s.win, {})
    await s.win.keyboard.type('@')
    await waitList(s)
    await sleep(1200)
    const picked = await s.win.evaluate(() => { const b = document.querySelector('[data-mention-list] [data-mention-item]'); return b ? `${b.getAttribute('data-mention-group')}/${b.getAttribute('data-mention-kind')}/${b.getAttribute('data-mention-item')}` : null })
    await s.win.keyboard.press('Enter')
    const m = await endMeasure(s.win, t0, { settleMs: 900 })
    const pl = await pollLog(s.win)
    const kd = m.events.filter((e) => e.type === 'keydown')
    const atK = kd.find((e) => e.key === '@'); const enterK = kd.find((e) => e.key === 'Enter')
    const shown = pl.find((e) => e.t >= atK.t && e.items > 0)
    const thumbs = pl.find((e) => e.t >= atK.t && e.items > 0 && e.imgs > 0 && e.loaded === e.imgs)
    const chipsBefore = pl.filter((e) => e.t < enterK.t).slice(-1)[0]?.chips ?? 0
    const chip = pl.find((e) => e.t >= enterK.t && e.chips > chipsBefore)
    runs.push({
      picked, atToList: shown ? r1(shown.t - atK.t) : null, listImgsAtOpen: shown ? `${shown.loaded}/${shown.imgs}` : null,
      atToThumbs: thumbs ? r1(thumbs.t - atK.t) : null, enterToChip: chip ? r1(chip.t - enterK.t) : null,
      openFrame: maxGapIn(m.frames, atK.t, atK.t + 400), selectFrame: maxGapIn(m.frames, enterK.t, enterK.t + 500), longtasks: m.longtasks.map(([, d]) => d),
    })
    await s.win.keyboard.press('Escape').catch(() => undefined)
  }
  await clearEditor(s)
  const t0 = await beginMeasure(s.win, { renders: true, focusNode: idleId })
  await s.win.keyboard.type('@'); await waitList(s); await sleep(700)
  await s.win.keyboard.press('Enter'); await sleep(900)
  const m = await endMeasure(s.win, t0, { settleMs: 200 })
  await clearEditor(s)
  await resetReferences(s, idleId)
  return {
    runs, coldOpenFrame: runs[0]?.openFrame ?? null, atToList: median(runs.map((r) => r.atToList)), atToThumbs: median(runs.map((r) => r.atToThumbs)), enterToChip: median(runs.map((r) => r.enterToChip)),
    openFrame: median(runs.map((r) => r.openFrame)), selectFrame: median(runs.map((r) => r.selectFrame)), chipEveryTime: runs.every((r) => r.enterToChip != null), renders: renderSummary(m.commits),
  }
}

const modeButton = (s, label) => s.win.locator('[data-composer-host] [role="group"] button', { hasText: label }).first()

async function composerState(s, idleId) {
  return s.win.evaluate((idleId) => {
    const st = window.__nomiCanvasStore.getState()
    const n = st.nodes.find((x) => x.id === idleId)
    const host = document.querySelector('[data-composer-host]')
    const ed = host?.querySelector('.ProseMirror')
    const notes = host ? Array.from(host.querySelectorAll('[role="status"],[role="alert"]')).map((e) => e.textContent.trim()).filter(Boolean) : []
    return {
      chips: ed ? ed.querySelectorAll('[data-asset-mention]').length : -1,
      edges: st.edges.filter((e) => e.target === idleId).length,
      edgeHandles: st.edges.filter((e) => e.target === idleId).map((e) => e.targetHandle || e.data?.slot || e.data?.role || 'ref'),
      mode: n?.meta?.archetype?.modeId, notes,
    }
  }, idleId)
}

/** 撤掉连到待写节点上的所有参考边（上一轮 @ 留下的），让每一轮都从「图生视频、没有参考」起步。 */
async function resetReferences(s, idleId) {
  await s.win.evaluate((idleId) => {
    const st = window.__nomiCanvasStore.getState()
    for (const e of st.edges.filter((x) => x.target === idleId)) st.disconnectEdge(e.id)
  }, idleId)
}

/** 「图生视频」模式下 @ 画布上的视频 × 10：chip 出现几次、是否切到全能参考、有没有多余连线。每次先撤掉参考边、清空输入、切回图生视频。 */
export async function atVideoInImageToVideo(s, idleId, { trials = 10 } = {}) {
  await selectIdle(s, idleId)
  const out = []
  for (let i = 0; i < trials; i++) {
    if (!(await s.win.locator(EDITOR).count())) await selectIdle(s, idleId)
    await clearEditor(s)
    await resetReferences(s, idleId); await sleep(200)
    await modeButton(s, '图生视频').click(); await sleep(500)
    const before = await composerState(s, idleId)
    await s.win.locator(EDITOR).first().click(); await s.win.keyboard.press('End')
    await s.win.keyboard.type('@'); await waitList(s); await sleep(300)
    const videos = s.win.locator('[data-mention-list] [data-mention-item][data-mention-group="canvas"][data-mention-kind="video"]')
    const n = await videos.count()
    let picked = null
    if (n > 0) { const it = videos.nth(i % n); picked = await it.getAttribute('data-mention-item'); await it.click() }
    await sleep(1000)
    const after = await composerState(s, idleId)
    const chipsAdded = after.chips - before.chips; const edgesAdded = after.edges - before.edges
    out.push({ i: i + 1, picked, modeBefore: before.mode, modeAfter: after.mode, chipsAdded, edgesAdded, extraEdges: Math.max(0, edgesAdded - Math.max(0, chipsAdded)), edgeHandles: after.edgeHandles.slice(-2), notes: after.notes })
    await s.win.keyboard.press('Escape').catch(() => undefined)
  }
  await clearEditor(s)
  await resetReferences(s, idleId)
  return {
    trials: out,
    chipAppeared: out.filter((t) => t.chipsAdded > 0).length,
    // 各档案的「参考」模式叫法不同（Seedance 2.0 = omni，即梦 = multimodal）：换了模式且不再是图生视频就算切到了参考模式。
    switchedToReference: out.filter((t) => t.modeAfter && t.modeAfter !== t.modeBefore).length,
    modesAfter: [...new Set(out.map((t) => t.modeAfter))],
    startedInImageToVideo: out.filter((t) => t.modeBefore !== 'omni').length,
    extraEdges: out.reduce((a, t) => a + t.extraEdges, 0),
    edgesAdded: out.reduce((a, t) => a + t.edgesAdded, 0),
  }
}

/**
 * 换待写节点的模型（点提示词面板里的「模型」→ 选菜单项），返回换完后节点上的模型 key。
 * 用来在「即梦 Seedance（会员）」上重跑 @ 测试：用户现场报「@ 出来的东西不显示」就是这类图生视频带首帧槽的模型。
 */
export async function switchModel(s, idleId, labelPattern) {
  await selectIdle(s, idleId)
  await s.win.locator('[data-composer-host] button[aria-label="模型"]').first().click(); await sleep(600)
  const item = s.win.locator('[role="option"], [role="menuitem"], [role="menuitemradio"]').filter({ hasText: labelPattern }).first()
  await item.waitFor({ state: 'visible', timeout: 4000 })
  await item.click(); await sleep(800)
  await s.win.keyboard.press('Escape').catch(() => undefined)
  return (await storeNode(s, idleId))?.meta?.modelKey ?? null
}

/** 参数面板里的时长滑杆：拖动期间最长帧、每步到画面、每步重渲；松手后值进 store、再进磁盘。 */
export async function durationSlider(s, idleId, { rounds = 3 } = {}) {
  await selectIdle(s, idleId)
  await s.win.locator('[data-composer-host] [data-parameter-summary], [data-parameter-summary]').first().click(); await sleep(600)
  const panel = s.win.locator('[data-agent-parameter-panel="true"]').first()
  await panel.waitFor({ state: 'visible', timeout: 4000 })
  const sliders = panel.locator('[role="slider"]')
  const labels = await sliders.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || ''))
  const index = Math.max(0, labels.findIndex((l) => /时长|duration/i.test(l)))
  const thumb = sliders.nth(index)
  const runs = []; let renders = null; let lastValue = null
  for (let rep = 0; rep <= rounds; rep++) {
    const counting = rep === rounds
    const tb = await thumb.boundingBox()
    const track = await thumb.evaluate((el) => { const r = (el.closest('.mantine-Slider-root') || el.parentElement).getBoundingClientRect(); return { x: r.x, w: r.width } })
    const cx = tb.x + tb.width / 2; const cy = tb.y + tb.height / 2
    const dist = (track.w || 160) * 0.8 * (rep % 2 === 0 ? 1 : -1)
    await s.win.mouse.move(cx, cy); await sleep(150)
    const t0 = await beginMeasure(s.win, { watch: '[data-agent-parameter-panel="true"]', renders: counting, focusNode: idleId })
    await s.win.mouse.down()
    for (let i = 1; i <= 30; i++) { await s.win.mouse.move(cx + (dist * i) / 30, cy); await sleep(16) }
    await s.win.mouse.up()
    const m = await endMeasure(s.win, t0, { settleMs: 500 })
    const moves = m.events.filter((e) => e.type === 'pointermove' && e.buttons === 1)
    // 每次显示值变化：从「促成它的那次指针移动」（它之前最近的一次 move）到变化后的第一帧。
    // 不按「每次 move 到下一次变化」算：滑杆只在跨过整数秒时才变，没跨过的 move 会被算成等到下一次变化的时长。
    const lat = [...new Set(m.mutations.map((mu) => firstAfter(m.frames, mu)))].filter((p) => p != null).map((p) => {
      const prev = moves.filter((e) => e.t <= p).slice(-1)[0]
      return prev ? p - prev.t : null
    }).filter((x) => x != null)
    const down = m.events.find((e) => e.type === 'pointerdown') || { t: m.t0 }
    const up = m.events.find((e) => e.type === 'pointerup') || { t: m.t1 }
    lastValue = await thumb.getAttribute('aria-valuenow')
    const run = { moves: moves.length, updates: m.mutations.length, latMedian: r1(median(lat)), latMax: r1(maxOf(lat)), maxFrame: maxGapIn(m.frames, down.t, up.t + 150), releaseFrame: maxGapIn(m.frames, up.t, up.t + 400), value: lastValue, longtasks: m.longtasks.map(([, d]) => d) }
    if (counting) { renders = renderSummary(m.commits); renders.perMove = r1(renders.rendered / Math.max(1, moves.length)); renders.perMoveByRegion = Object.fromEntries(Object.entries(renders.byRegion).map(([k, v]) => [k, r1(v / Math.max(1, moves.length))])) } else runs.push(run)
  }
  await sleep(300)
  const stored = (await storeNode(s, idleId))?.meta?.duration
  let disk = null
  for (let i = 0; i < 40; i++) { const saved = readSavedNode(s.fixture.projDir, idleId); disk = saved?.node?.meta?.duration; if (String(disk) === String(lastValue)) break; await sleep(150) }
  await s.win.keyboard.press('Escape').catch(() => undefined)
  return {
    label: labels[index], runs, latMedian: median(runs.map((r) => r.latMedian)), latMax: median(runs.map((r) => r.latMax)), maxFrame: median(runs.map((r) => r.maxFrame)), releaseFrame: median(runs.map((r) => r.releaseFrame)),
    renders, finalValue: lastValue, storeValue: stored ?? null, diskValue: disk ?? null,
    persisted: String(stored) === String(lastValue) && String(disk) === String(lastValue),
  }
}

/** 编辑一次（提示词里打一个字）→ 停手 → 自动保存：保存那一刻界面线程最长阻塞。保存时刻 = 项目文件 mtime 变化（换算到页面时钟）。 */
export async function autosave(s, idleId, { rounds = 3 } = {}) {
  await selectIdle(s, idleId)
  await clearEditor(s)
  await sleep(2500)
  const runs = []
  for (let rep = 0; rep < rounds; rep++) {
    const mtimes0 = projectFileMtimes(s.fixture.projDir)
    const t0 = await beginMeasure(s.win, {})
    await s.win.keyboard.type(String.fromCharCode(0x61 + rep))
    let savedAt = null
    for (let i = 0; i < 120 && savedAt == null; i++) {
      await sleep(25)
      const now = projectFileMtimes(s.fixture.projDir)
      const changed = now.map((t, k) => (t > mtimes0[k] ? t : 0)).filter(Boolean)
      if (changed.length) savedAt = Math.min(...changed)
    }
    const m = await endMeasure(s.win, t0, { settleMs: 400 })
    const key = m.events.find((e) => e.type === 'keydown')
    const savePage = savedAt != null ? savedAt - m.timeOrigin : null
    // 保存窗口：停手 400ms 之后到落盘后 300ms（打字本身那一帧不算进来）。
    const from = (key?.t ?? m.t0) + 400; const to = savePage != null ? savePage + 300 : m.t1
    runs.push({ saveAfterKeyMs: savePage != null && key ? r1(savePage - key.t) : null, maxBlock: maxGapIn(m.frames, from, to), longtasks: m.longtasks.filter(([st]) => st >= from - 50).map(([, d]) => d) })
    await sleep(800)
  }
  await clearEditor(s)
  return { runs, saveAfterKeyMs: median(runs.map((r) => r.saveAfterKeyMs)), maxBlock: median(runs.map((r) => r.maxBlock)), saved: runs.every((r) => r.saveAfterKeyMs != null) }
}
