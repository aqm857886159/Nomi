// 画布跟手量具 · 画布面的动作：空闲、悬停扫过、悬停起播、右键新建、拖节点、叠放拖出、方向键。
// 每个函数只做「像人一样操作 + 页面探针记账」，判定放在入口文件里。
import { beginMeasure, endMeasure, maxGapIn, median, maxOf, pct, r1, firstAfter, renderSummary } from './probe.mjs'
import { census, processMemory, nodeRect, storeNode, sleep, fitAll, EDITOR, STAGE } from './session.mjs'
import { findCanvasBlankPoint, findNodeHitPoint } from '../_canvasHit.mjs'

const vid = (n) => `gen-v2-video-${String(n).padStart(3, '0')}`

/** 等画布上的媒体安顿下来：改后构建=封面补齐且没有挂着的播放器；改前构建=挂着的播放器数与缓冲量连续 3 秒不变。 */
export async function waitMediaSettled(s, { maxMs = 90_000 } = {}) {
  const t0 = Date.now()
  let prev = null; let stable = 0; let last = null
  while (Date.now() - t0 < maxMs) {
    const c = await census(s)
    last = c
    if (c.videos === 0 && c.posters >= c.videoNodes && c.videoNodesWithThumbnail >= c.videoNodes) return { settledMs: Date.now() - t0, how: 'posters', census: c }
    const sig = `${c.videos}|${Math.round(c.buffered)}|${c.posters}`
    stable = sig === prev ? stable + 1 : 0
    prev = sig
    if (stable >= 3 && c.videos > 0) return { settledMs: Date.now() - t0, how: 'players-stable', census: c }
    await sleep(1000)
  }
  return { settledMs: Date.now() - t0, how: 'timeout', census: last }
}

export async function idleState(s, { samples = 3 } = {}) {
  await s.win.mouse.move(5, 5)
  const out = []
  for (let i = 0; i < samples; i++) {
    await sleep(i ? 2000 : 500)
    out.push({ ...(await census(s)), ...(await processMemory(s)) })
  }
  return {
    samples: out,
    videosMounted: median(out.map((x) => x.videos)),
    playing: maxOf(out.map((x) => x.playing)),
    gpuPrivMB: median(out.map((x) => x.gpuPrivMB)), gpuWsMB: median(out.map((x) => x.gpuWsMB)),
    tabPrivMB: median(out.map((x) => x.tabPrivMB)), tabWsMB: median(out.map((x) => x.tabWsMB)),
  }
}

async function blankPoint(s) { return findCanvasBlankPoint(s.win, { preference: 'bottom' }) }

/** 鼠标不停顿地来回扫过一排视频卡（第 2 排，9 张）。 */
export async function hoverSweep(s, { rounds = 3, passes = 2, steps = 60 } = {}) {
  const ids = Array.from({ length: 9 }, (_, i) => vid(9 + i)).filter(Boolean)
  const a = await nodeRect(s, ids[0]); const b = await nodeRect(s, ids[ids.length - 1])
  const y = a.y + a.h / 2; const x0 = a.x + 2; const x1 = b.x + b.w - 2
  const blank = await blankPoint(s)
  const runs = []
  for (let round = 0; round < rounds; round++) {
    await s.win.mouse.move(blank.x, blank.y); await sleep(1500)
    const t0 = await beginMeasure(s.win, {})
    for (let p = 0; p < passes; p++) {
      for (let k = 0; k <= steps; k++) {
        const f = p % 2 === 0 ? k / steps : 1 - k / steps
        await s.win.mouse.move(x0 + (x1 - x0) * f, y + Math.sin(k / 4) * 3)
        await sleep(12)
      }
    }
    await s.win.mouse.move(blank.x, blank.y)
    const m = await endMeasure(s.win, t0, { settleMs: 300 })
    const moves = m.events.filter((e) => e.type === 'pointermove')
    const delays = moves.map((e) => e.now - e.t).sort((p, q) => p - q)
    await sleep(1500)
    const left = await census(s)
    runs.push({ moves: moves.length, queueP99: r1(pct(delays, 0.99)), queueMax: r1(delays[delays.length - 1]), maxFrame: maxGapIn(m.frames, m.t0, m.t1), commits: m.commitTimes.length, maxVideosMounted: m.video.maxMounted, maxPlaying: m.video.maxPlaying, videosLeftMounted: left.videos, longtasks: m.longtasks.map(([, d]) => d) })
  }
  return { runs, queueP99: median(runs.map((r) => r.queueP99)), maxFrame: median(runs.map((r) => r.maxFrame)), commits: median(runs.map((r) => r.commits)), maxVideosMounted: maxOf(runs.map((r) => r.maxVideosMounted)), maxPlaying: maxOf(runs.map((r) => r.maxPlaying)), videosLeftMounted: maxOf(runs.map((r) => r.videosLeftMounted)) }
}

/** 停在一张卡上：pointerover 进卡 → 这张卡的 <video> 触发 playing。最后连续悬停相邻两张，查同时在播数。 */
export async function hoverToPlay(s, { cards = [20, 21, 22], holdMs = 2500 } = {}) {
  const blank = await blankPoint(s)
  const runs = []
  for (const n of cards) {
    const id = vid(n)
    await s.win.mouse.move(blank.x, blank.y); await sleep(1500)
    const r = await nodeRect(s, id)
    const t0 = await beginMeasure(s.win, {})
    await s.win.mouse.move(r.x + r.w / 2, r.y + r.h / 2, { steps: 3 })
    await sleep(holdMs)
    const m = await endMeasure(s.win, t0, { settleMs: 50 })
    const enter = m.events.find((e) => e.type === 'pointerover' && e.node === id)
    const playing = m.media.find((e) => e.type === 'playing' && e.node === id)
    runs.push({ id, startMs: enter && playing ? r1(playing.t - enter.t) : null, played: Boolean(playing), maxPlaying: m.video.maxPlaying, maxVideosMounted: m.video.maxMounted })
  }
  // 相邻两张连续悬停：新的开始播，上一张必须停（全画布同时 ≤ 1 个在播）。
  const a = await nodeRect(s, vid(23)); const b = await nodeRect(s, vid(24))
  await s.win.mouse.move(blank.x, blank.y); await sleep(1500)
  const t0 = await beginMeasure(s.win, {})
  await s.win.mouse.move(a.x + a.w / 2, a.y + a.h / 2, { steps: 3 }); await sleep(1800)
  await s.win.mouse.move(b.x + b.w / 2, b.y + b.h / 2, { steps: 3 }); await sleep(1800)
  const m = await endMeasure(s.win, t0, { settleMs: 50 })
  // 离开卡片：过了离开宽限（800ms）播放器必须卸掉——否则「悬停过的卡」一张张攒着解码器，空闲 <video> = 0 只在没人碰过时成立。
  await s.win.mouse.move(blank.x, blank.y); await sleep(2000)
  const afterLeave = await census(s)
  // 同一张卡再悬停一次，必须还能起播（播放器没被误判成「用户在看」而卡在暂停态）。
  const first = vid(cards[0]); const fr = await nodeRect(s, first)
  const t1 = await beginMeasure(s.win, {})
  await s.win.mouse.move(fr.x + fr.w / 2, fr.y + fr.h / 2, { steps: 3 }); await sleep(holdMs)
  const again = await endMeasure(s.win, t1, { settleMs: 50 })
  // 离开后等过进场停留 / 离开宽限两个计时器，别让它们的收尾重渲算进下一个动作里。
  await s.win.mouse.move(blank.x, blank.y); await sleep(2000)
  return {
    runs, startMs: median(runs.map((r) => r.startMs)), playedAll: runs.every((r) => r.played),
    pair: { maxPlaying: m.video.maxPlaying, plays: m.media.filter((e) => e.type === 'playing').map((e) => e.node) },
    maxPlaying: Math.max(m.video.maxPlaying, again.video.maxPlaying, ...runs.map((r) => r.maxPlaying)),
    videosLeftAfterLeave: afterLeave.videos,
    replayed: again.media.some((e) => e.type === 'playing' && e.node === first),
  }
}

/** 页面内 rAF 轮询：节点数 / 编辑器数 / @ 列表项 / chip / 列表缩略图加载，签名变了就记一笔。 */
export async function installPoll(win) {
  await win.evaluate(() => {
    if (window.__cfhPoll) { window.__cfhPoll.log.length = 0; window.__cfhPoll.last = ''; return }
    const P = { log: [], last: '' }
    const tick = () => {
      const list = document.querySelector('[data-mention-list]')
      const items = list ? list.querySelectorAll('[data-mention-item]').length : -1
      const imgs = list ? Array.from(list.querySelectorAll('img')) : []
      const loaded = imgs.filter((i) => i.complete && i.naturalWidth > 0).length
      const chips = document.querySelectorAll('[data-composer-host] [data-asset-mention]').length
      const nodes = document.querySelectorAll('.react-flow__node').length
      const eds = document.querySelectorAll('[data-composer-host] .ProseMirror[contenteditable="true"]').length
      const sig = `${items}|${loaded}/${imgs.length}|${chips}|${nodes}|${eds}`
      if (sig !== P.last) { P.log.push({ t: performance.now(), items, loaded, imgs: imgs.length, chips, nodes, eds }); P.last = sig }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    window.__cfhPoll = P
  })
}
export const pollLog = (win) => win.evaluate(() => window.__cfhPoll.log.slice())
export const clearPoll = (win) => win.evaluate(() => { window.__cfhPoll.log.length = 0; window.__cfhPoll.last = '' })

/** 右键空白 → 菜单「视频」：点击到节点出现 / 到编辑器出现、最长帧、连带重渲的别的节点。 */
export async function createVideoNode(s, { rounds = 3, withRenders = true } = {}) {
  await installPoll(s.win)
  const runs = []; let renders = null
  const total = rounds + (withRenders ? 1 : 0)
  for (let rep = 0; rep < total; rep++) {
    const counting = withRenders && rep === rounds
    await s.win.keyboard.press('Escape').catch(() => undefined); await sleep(300)
    const before = new Set(await s.win.evaluate(() => window.__nomiCanvasStore.getState().nodes.map((n) => n.id)))
    const blank = await blankPoint(s)
    await s.win.mouse.click(blank.x, blank.y, { button: 'right' })
    const item = s.win.locator('.generation-canvas-v2__context-node-menu [role=menuitem]').filter({ hasText: '视频' }).first()
    await item.waitFor({ timeout: 4000 })
    await sleep(250)
    await clearPoll(s.win)
    const t0 = await beginMeasure(s.win, { renders: counting })
    await item.click()
    const m = await endMeasure(s.win, t0, { settleMs: 1500 })
    const pl = await pollLog(s.win)
    const created = (await s.win.evaluate(() => window.__nomiCanvasStore.getState().nodes.map((n) => n.id))).filter((id) => !before.has(id))
    const down = m.events.find((e) => e.type === 'pointerdown') || m.events.find((e) => e.type === 'click')
    const baseNodes = pl.find((e) => e.t < down.t)?.nodes ?? before.size
    const nodeShown = pl.find((e) => e.t >= down.t && e.nodes > baseNodes)
    const editorShown = pl.find((e) => e.t >= down.t && e.eds > 0)
    const run = { created: created.length, clickToNode: nodeShown ? r1(nodeShown.t - down.t) : null, clickToEditor: editorShown ? r1(editorShown.t - down.t) : null, maxFrame: maxGapIn(m.frames, down.t, down.t + 1200), longtasks: m.longtasks.map(([, d]) => d) }
    if (counting) {
      const sum = renderSummary(m.commits)
      const others = new Set(m.commits.flatMap((c) => c.otherNodeIds).filter((id) => !created.includes(id)))
      renders = { ...sum, otherNodesRerendered: others.size, otherNodeSample: [...others].slice(0, 8) }
    } else runs.push(run)
    for (const id of created) await s.win.evaluate((id) => window.__nomiCanvasStore.getState().deleteNode(id), id)
    await sleep(400)
  }
  await s.win.keyboard.press('Escape').catch(() => undefined)
  return { runs, clickToNode: median(runs.map((r) => r.clickToNode)), clickToEditor: median(runs.map((r) => r.clickToEditor)), maxFrame: median(runs.map((r) => r.maxFrame)), createdEach: runs.every((r) => r.created === 1), renders }
}

/** 拖一个视频节点 40 步：每次移动到节点位移上屏的延迟、起手那一下的最长帧、每步重渲。 */
export async function dragNode(s, { id = vid(10), rounds = 3, withRenders = true } = {}) {
  const runs = []; let renders = null
  const total = rounds + (withRenders ? 1 : 0)
  for (let rep = 0; rep < total; rep++) {
    const counting = withRenders && rep === rounds
    // 拖的是一张没选中的卡：先点空白取消选中（上一轮拖完它是选中的，提示词面板会盖在卡上）。
    const blank = await blankPoint(s)
    await s.win.mouse.click(blank.x, blank.y); await sleep(500)
    const hit = await findNodeHitPoint(s.win, { nodeSelector: `.react-flow__node[data-id="${id}"]` })
    if (!hit) throw new Error(`拖节点：${id} 上找不到露着的一点`)
    const sx = hit.x; const sy = hit.y
    const dir = rep % 2 === 0 ? 1 : -1
    await s.win.mouse.move(sx, sy, { steps: 2 }); await sleep(300)
    const t0 = await beginMeasure(s.win, { watch: `.react-flow__node[data-id="${id}"]`, renders: counting, focusNode: id })
    await s.win.mouse.down()
    for (let i = 1; i <= 40; i++) { await s.win.mouse.move(sx + dir * i * 4, sy + dir * i * 2); await sleep(16) }
    await s.win.mouse.up()
    const m = await endMeasure(s.win, t0, { settleMs: 700 })
    const moves = m.events.filter((e) => e.type === 'pointermove' && e.buttons === 1)
    const lat = moves.map((e) => { const mu = firstAfter(m.mutations, e.t); const p = mu != null ? firstAfter(m.frames, mu) : null; return p != null ? p - e.t : null }).filter((x) => x != null)
    const down = m.events.find((e) => e.type === 'pointerdown') || { t: m.t0 }
    const up = m.events.find((e) => e.type === 'pointerup') || { t: m.t1 }
    const run = { moves: moves.length, latMedian: r1(median(lat)), latMax: r1(maxOf(lat)), startFrame: maxGapIn(m.frames, down.t, down.t + 250), maxFrameDuring: maxGapIn(m.frames, down.t, up.t), afterUpFrame: maxGapIn(m.frames, up.t, up.t + 500), longtasks: m.longtasks.map(([, d]) => d) }
    if (counting) { renders = renderSummary(m.commits); renders.perMove = r1(renders.rendered / Math.max(1, moves.length)) } else runs.push(run)
    await sleep(300)
  }
  const blank = await blankPoint(s)
  await s.win.mouse.click(blank.x, blank.y)
  return { runs, latMedian: median(runs.map((r) => r.latMedian)), latMax: median(runs.map((r) => r.latMax)), startFrame: median(runs.map((r) => r.startFrame)), maxFrameDuring: median(runs.map((r) => r.maxFrameDuring)), renders }
}

/** 选中一张卡按 → 3 次：每次 x 都 +N（N 相同且 > 0），y 不变。 */
export async function arrowKeys(s, { id = vid(12), presses = 3 } = {}) {
  await s.win.keyboard.press('Escape').catch(() => undefined); await sleep(300)
  const r = await nodeRect(s, id)
  await s.win.mouse.click(r.x + r.w / 2, r.y + r.h / 2); await sleep(500)
  const focusInEditor = await s.win.evaluate(() => Boolean(document.activeElement?.closest?.('.ProseMirror, input, textarea')))
  const positions = [(await storeNode(s, id)).position]
  for (let i = 0; i < presses; i++) { await s.win.keyboard.press('ArrowRight'); await sleep(250); positions.push((await storeNode(s, id)).position) }
  const deltas = positions.slice(1).map((p, i) => ({ dx: r1(p.x - positions[i].x), dy: r1(p.y - positions[i].y) }))
  const step = deltas[0]?.dx
  const moved = deltas.every((d) => d.dx > 0 && d.dx === step && d.dy === 0)
  await s.win.keyboard.press('Escape').catch(() => undefined)
  return { deltas, moved, step, focusInEditor }
}

/**
 * 叠放拖出（用户原话「拖动素材粘在我的鼠标上，弄都弄不下来」）：复制 1 张视频卡、原地粘贴 10 份叠在一起，
 * 放大到卡片够大，逐张真实鼠标拖出 / 拖回；松手后再挪鼠标，节点还跟着走 = 粘住。
 */
export async function stackDragOut(s, { rounds = 4, shotDir = null } = {}) {
  const win = s.win
  const ids = () => win.evaluate(() => window.__nomiCanvasStore.getState().nodes.map((n) => n.id))
  const topAt = (x, y) => win.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.react-flow__node')?.getAttribute('data-id') || null, { x, y })
  const dragState = () => win.evaluate(() => ({ dragging: document.querySelectorAll('.react-flow__node.dragging').length }))
  await win.keyboard.press('Escape'); await sleep(300)
  const src = await nodeRect(s, vid(5))
  await win.mouse.click(src.x + src.w / 2, src.y + src.h * 0.3); await sleep(400)
  await win.keyboard.press('Control+C'); await sleep(300)
  const before = new Set(await ids())
  // 粘在第 4 排视频右边那几个空格里（夹具网格留出的空位）：避开底部的批量生成条等浮层，放大后四周也有空地可拖。
  const last = await nodeRect(s, vid(32))
  const scale = last.w / 384
  const pastePoint = { x: last.x + (420 + 40) * scale, y: last.y + 20 * scale }
  await win.mouse.move(pastePoint.x, pastePoint.y); await sleep(200)
  for (let i = 0; i < 10; i++) { await win.keyboard.press('Control+V'); await sleep(350) }
  const pasted = (await ids()).filter((id) => !before.has(id))
  if (pasted.length < 2) return { pasted: pasted.length, trials: [], stuck: null, error: '粘贴没有产出叠放节点' }
  const clear = await findCanvasBlankPoint(win, { preference: 'top-left' })
  await win.mouse.click(clear.x, clear.y); await sleep(300)
  let sr = await nodeRect(s, pasted[0])
  for (let i = 0; i < 16 && sr && sr.w < 125; i++) {
    await win.mouse.move(sr.x + sr.w / 2, sr.y + sr.h / 2)
    await win.keyboard.down('Control'); await win.mouse.wheel(0, -120); await win.keyboard.up('Control'); await sleep(160)
    sr = await nodeRect(s, pasted[0])
  }
  await sleep(1200)
  sr = await nodeRect(s, pasted[0])
  if (!sr || sr.w < 100) return { pasted: pasted.length, trials: [], stuck: null, drags: 0, notMoved: 0, error: `放大到叠放处失败（卡宽 ${sr?.w}）` }
  const stage = await win.locator(STAGE).first().boundingBox()
  const stackPoint = { x: sr.x + sr.w / 2, y: sr.y + sr.h * 0.4 }
  // 拖出去的落点：舞台里一格一格排开，避开叠放处，彼此不重叠（否则后面的卡被前面的盖住，人也按不到）。
  // 离舞台边 ≥ 80px：贴边拖动会触发画布自动平移，改前构建一粘住就被平移带走，后面的卡全在视口外（整轮作废）。
  const slots = []
  for (let y = stage.y + 80; y + sr.h * 1.3 < stage.y + stage.height - 80 && slots.length < 40; y += sr.h * 1.3) {
    for (let x = stage.x + 90; x + sr.w < stage.x + stage.width - 80; x += sr.w * 1.06) {
      const clearOfStack = x + sr.w < sr.x - 20 || x > sr.x + sr.w + 20 || y + sr.h * 1.3 < sr.y - 20 || y > sr.y + sr.h + 20
      if (clearOfStack) slots.push({ x, y })
    }
  }
  const trials = []
  const outSet = new Set()
  // 人按的是卡上还露着的那一块（刚拖出去的那张被选中，它的提示词面板可能盖住叠放处）。
  const pressPoint = async (id) => {
    const sel = `.react-flow__node[data-id="${id}"]`
    let p = await findNodeHitPoint(win, { nodeSelector: sel })
    if (!p) {
      // 被刚选中那张卡的提示词面板盖住了：像人一样先点一下空白处取消选中，再找露着的那一块。
      const blank = await findCanvasBlankPoint(win).catch(() => null)
      if (blank) await win.mouse.click(blank.x, blank.y); else await win.keyboard.press('Escape')
      await sleep(300)
      p = await findNodeHitPoint(win, { nodeSelector: sel })
    }
    return p
  }
  // 抓哪儿：每三次里有一次抓卡片上方的标题签（「镜头 N · 视频」），其余抓卡面露着的地方——两种人都会这么拖。
  const headerPoint = async (id) => win.evaluate((id) => {
    const node = document.querySelector(`.react-flow__node[data-id="${id}"]`)
    const r = node?.getBoundingClientRect()
    if (!r) return null
    for (const [dx, dy] of [[30, -8], [20, -6], [40, -10]]) {
      const hit = document.elementFromPoint(r.x + dx, r.y + dy)
      if (hit && node.contains(hit) && !hit.closest('button, a, input, textarea, [role="button"]')) return { x: r.x + dx, y: r.y + dy }
    }
    return null
  }, id)
  // 「松手丢了」：用户现场事件里始终没有 pointerup / mouseup（原生拖放吞掉、系统光标插队）。合成输入复现不出那一刻，
  // 就直接造出它的样子——按着拖到位后不发松手，接着来「没按键的移动」（CDP 直发 buttons=0 的 mouseMoved）。
  const cdp = await win.context().newCDPSession(win)
  const buttonlessMove = (x, y) => cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 })
  const dragOne = async (id, dest, round) => {
    const grab = ['body', 'body', 'header', 'lost-release'][trials.length % 4]
    const p = (grab === 'header' ? await headerPoint(id) : null) || await pressPoint(id)
    if (!p) {
      const blocker = await win.evaluate((id) => { const r = document.querySelector(`.react-flow__node[data-id="${id}"]`)?.getBoundingClientRect(); if (!r) return 'no-node'; const el = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}@${el.closest('.react-flow__node')?.getAttribute('data-id')?.slice(-6) || '-'} rect=${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}` : 'offscreen' }, id)
      if (shotDir && trials.filter((t) => t.unreachable).length < 2) await win.screenshot({ path: `${shotDir}/stack-unreachable-${trials.length}.png` })
      trials.push({ round, id, grab, unreachable: true, blocker, moved: 0, stuck: false }); return
    }
    const px = p.x; const py = p.y
    const r0 = await nodeRect(s, id)
    // dest 是卡片左上角要去的位置（回叠放处时直接给按点）。
    const tx = dest.press ? dest.x : dest.x + (px - r0.x); const ty = dest.press ? dest.y : dest.y + (py - r0.y)
    const start = (await storeNode(s, id)).position
    await win.mouse.move(px, py, { steps: 4 }); await sleep(200)
    await win.mouse.down()
    for (let i = 1; i <= 20; i++) { await win.mouse.move(px + ((tx - px) * i) / 20, py + ((ty - py) * i) / 20); await sleep(16) }
    if (grab === 'lost-release') await buttonlessMove(tx + 1, ty + 1)
    else await win.mouse.up()
    await sleep(250)
    const upRect = await nodeRect(s, id); const afterUp = (await storeNode(s, id)).position
    for (let i = 1; i <= 6; i++) {
      if (grab === 'lost-release') await buttonlessMove(tx + i * 15, ty + i * 10)
      else await win.mouse.move(tx + i * 15, ty + i * 10)
      await sleep(20)
    }
    await sleep(300)
    const laterRect = await nodeRect(s, id); const st = await dragState()
    // Playwright 还以为键按着：补一次松手把它的状态复位（改前构建里这一下也顺带结束了粘住的拖动）。
    if (grab === 'lost-release') { await win.mouse.up(); await sleep(250) }
    const followed = upRect && laterRect ? Math.hypot(laterRect.x - upRect.x, laterRect.y - upRect.y) : null
    const moved = Math.hypot(afterUp.x - start.x, afterUp.y - start.y)
    const stuck = (followed != null && followed > 5) || st.dragging > 0
    trials.push({ round, id, grab, moved: Math.round(moved), followedAfterUp: followed == null ? null : Math.round(followed), stuck })
    if (stuck) { await win.mouse.click(tx + 150, ty + 150); await win.keyboard.press('Escape'); await sleep(400) }
  }
  const stackWorld = (await storeNode(s, pasted[0])).position
  for (let round = 0; round < rounds; round++) {
    if (round % 2 === 0) {
      if (round > 0) {
        // 拖回来的卡落点有几像素偏差，叠得不齐时下面的卡会被上一轮拖出的卡盖住（人也按不到）。
        // 再拖出之前把它们重新码齐（准备动作，不计入测量）。
        await win.evaluate(({ ids, pos }) => { const st = window.__nomiCanvasStore.getState(); for (const id of ids) st.updateNode(id, { position: { ...pos } }) }, { ids: pasted, pos: stackWorld })
        const blank = await findCanvasBlankPoint(win).catch(() => null)
        if (blank) await win.mouse.click(blank.x, blank.y)
        await sleep(600)
      }
      for (let k = 0; k < pasted.length; k++) {
        const inStack = pasted.filter((p) => !outSet.has(p))
        const top = await topAt(stackPoint.x, stackPoint.y)
        let id = top && inStack.includes(top) ? top : null
        for (const cand of inStack) { if (id) break; if (await findNodeHitPoint(win, { nodeSelector: `.react-flow__node[data-id="${cand}"]` })) id = cand }
        if (!id) {
          const blank = await findCanvasBlankPoint(win).catch(() => null)
          if (blank) { await win.mouse.click(blank.x, blank.y); await sleep(300) }
          for (const cand of inStack) { if (id) break; if (await findNodeHitPoint(win, { nodeSelector: `.react-flow__node[data-id="${cand}"]` })) id = cand }
        }
        id = id || inStack[0]
        if (!id) break
        await dragOne(id, slots[k % slots.length], round); outSet.add(id)
      }
    } else {
      for (const id of pasted) { await dragOne(id, { ...stackPoint, press: true }, round); outSet.delete(id) }
    }
    if (shotDir) await win.screenshot({ path: `${shotDir}/stack-round-${round + 1}.png` })
  }
  for (const id of pasted) await win.evaluate((id) => window.__nomiCanvasStore.getState().deleteNode(id), id)
  await fitAll(s)
  await cdp.detach().catch(() => undefined)
  const normal = trials.filter((t) => t.grab !== 'lost-release'); const lost = trials.filter((t) => t.grab === 'lost-release')
  return {
    pasted: pasted.length, slots: slots.length, cardWidth: Math.round(sr.w), drags: trials.length, unreachable: trials.filter((t) => t.unreachable).length,
    stuck: normal.filter((t) => t.stuck).length, notMoved: normal.filter((t) => t.moved < 3).length, normalDrags: normal.length,
    lostRelease: { drags: lost.length, stuck: lost.filter((t) => t.stuck).length, moved: lost.filter((t) => t.moved >= 3 || (t.followedAfterUp ?? 0) > 5).length },
    trials,
  }
}

/**
 * 截图用：缩放回 100%，拍一张卡平时（封面）与悬停 2.5 秒后（起播）。
 * 挑一张前面没被悬停 / 拖过、且在 100% 视图里整张露着的卡（被碰过的卡带着别的状态，拍出来不代表「平时」）。
 */
export async function posterAndPlayShots(s, dir, { candidates = [1, 2, 3, 4, 6, 7, 8, 18, 19, 25, 26, 27, 28] } = {}) {
  await s.win.locator('button[aria-label="重置视图"]').first().click(); await sleep(1200)
  const blank = await blankPoint(s)
  await s.win.mouse.move(blank.x, blank.y); await sleep(1500)
  const stage = await s.win.locator(STAGE).first().boundingBox()
  // 露出程度按命中测试算（小地图、底部停靠条、右侧 Agent 面板都会盖住卡）：卡面 5×5 个点里有几个点最顶层是这张卡。
  const visibleFraction = (id) => s.win.evaluate((id) => {
    const node = document.querySelector(`.react-flow__node[data-id="${id}"]`)
    const r = node?.getBoundingClientRect()
    if (!r || !r.width) return 0
    let hits = 0
    for (let i = 1; i <= 5; i++) for (let j = 1; j <= 5; j++) { const el = document.elementFromPoint(r.x + (r.width * i) / 6, r.y + (r.height * j) / 6); if (el && node.contains(el)) hits++ }
    return hits / 25
  }, id)
  let id = null; let r = null; let best = -1
  for (const n of candidates) {
    const f = await visibleFraction(vid(n))
    if (f > best) { best = f; id = vid(n); r = await nodeRect(s, id) }
    if (f === 1) break
  }
  if (!id || best < 0.6) throw new Error(`100% 视图里没有一张没碰过的视频卡露出来（最好的一张露 ${Math.round(best * 100)}%）`)
  const clip = { x: Math.max(stage.x, r.x - 30), y: Math.max(stage.y, r.y - 40), width: Math.min(r.w + 60, 700), height: Math.min(r.h + 80, 600) }
  const idle = `${dir}/card-idle.png`; const hover = `${dir}/card-hover.png`
  const idleVideos = await s.win.evaluate((id) => document.querySelectorAll(`.react-flow__node[data-id="${id}"] video`).length, id)
  await s.win.screenshot({ path: idle, clip })
  await s.win.mouse.move(r.x + r.w / 2, r.y + r.h / 2, { steps: 3 }); await sleep(2500)
  const state = await s.win.evaluate((id) => { const v = document.querySelector(`.react-flow__node[data-id="${id}"] video`); return v ? { playing: !v.paused, t: Math.round(v.currentTime * 10) / 10, muted: v.muted } : null }, id)
  await s.win.screenshot({ path: hover, clip })
  await s.win.mouse.move(blank.x, blank.y)
  await fitAll(s)
  return { card: id, idle, hover, idleVideosInCard: idleVideos, hoverVideo: state }
}

export { EDITOR }
