// New drag scenarios for eval v2 (U1). These are action runners layered on the
// existing benchmark harness: they reuse its mouse-driven drag mechanic but add
// the coverage the 2026-09-01 investigation showed was missing —
//   • variable-speed gesture (accelerate → fling → pause) instead of a too-clean
//     constant-velocity line (leg-b noted the straight line reads "too clean")
//   • multi-node-drag (N=8 selected) to expose the per-N amplification of the
//     off-canvas re-render + store-write cost (suspect #1/#7 scale with N)
//   • drag-at-low-zoom to measure the drag path under lightweight LOD, whose
//     trigger is nodeCount>80 AND zoom<0.55 (canvasNodeLevelOfDetail.ts:29-31)
//   • drag-over-dense-edges to drag a node through a high-edge-density band so
//     the per-move edge-path recompute is in the hot path
//
// Every runner returns actionDetails including { moves } and { firstFeedbackMs }
// so the advisory metrics module can amortize per move and compute action
// latency. `moves` is the count of pointer-move steps actually dispatched.

/**
 * Number of selected nodes for multi-node-drag. Fixed at 8 so the sample is
 * comparable across runs and the slope-vs-N story is legible next to the N=1
 * node-drag-image baseline.
 */
export const MULTI_DRAG_NODE_COUNT = 8

/** LOD trigger constants mirrored from canvasNodeLevelOfDetail.ts (kept in sync
 * by the guard test dragScenarios.test.mjs, which imports the source values). */
export const LIGHTWEIGHT_ZOOM_CEILING = 0.55

function sleep(page, ms) {
  return page.waitForTimeout(ms)
}

/**
 * Variable-speed drag: three phases over `totalSteps` — slow accelerate, fast
 * fling, then a held pause at the end (no movement, cursor down). Interval per
 * step is short during the fling and longer during accel/pause, so the harness
 * exercises burst-rate mousemoves (where合帧 would matter most) rather than an
 * even cadence. Returns the number of move events dispatched.
 *
 * @param {import('playwright').Page} page
 * @param {{x:number,y:number}} start
 * @param {{x:number,y:number}} end
 */
export async function variableSpeedDragPath(page, start, end) {
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  let moves = 0
  const dx = end.x - start.x
  const dy = end.y - start.y
  // Phase weights: how far along the path each phase reaches, and cadence (ms).
  const phases = [
    { toRatio: 0.25, steps: 12, interval: 24 }, // slow accelerate
    { toRatio: 1.0, steps: 10, interval: 6 }, // fast fling (burst)
  ]
  let fromRatio = 0
  for (const phase of phases) {
    for (let i = 1; i <= phase.steps; i += 1) {
      const local = i / phase.steps
      const ratio = fromRatio + (phase.toRatio - fromRatio) * local
      await page.mouse.move(start.x + dx * ratio, start.y + dy * ratio, { steps: 1 })
      moves += 1
      if (phase.interval > 0) await sleep(page, phase.interval)
    }
    fromRatio = phase.toRatio
  }
  // Held pause at the end: cursor stays down, no movement, ~180ms — reproduces
  // the "stop dead at the drop point" beat where a late commit shows as a hitch.
  await sleep(page, 180)
  await page.mouse.up()
  return moves
}

/**
 * Find the first mounted node of a kind with a usable bounding box.
 * @param {import('playwright').Page} page
 */
async function firstNodeBox(page, kind) {
  const candidates = page.locator(`.generation-canvas-v2-node[data-kind="${kind}"]`)
  const count = await candidates.count()
  for (let index = 0; index < count; index += 1) {
    const box = await candidates.nth(index).boundingBox().catch(() => null)
    if (box && box.width > 20 && box.height > 20) return { locator: candidates.nth(index), box }
  }
  return null
}

/**
 * Read the first stage/edge mutation timestamp captured by the benchmark probe,
 * relative to when the probe was started. When the probe is started immediately
 * before the drag, this is the pointerdown→first-visual-feedback latency.
 * Returns null if the probe reported no mutation.
 * @param {import('playwright').Page} page
 */
async function readFirstFeedbackMs(page) {
  return page.evaluate(() => {
    const probe = window.__canvasPerformanceProbe
    const rec = probe && probe._record
    return rec && rec.firstMutationMs != null ? rec.firstMutationMs : null
  })
}

/**
 * Is a node box safely clickable for selection: fully inside the stage and clear
 * of the minimap (bottom-right) so the shift-click lands on the card, not an
 * overlay. Probed ground truth: nodes hugging the right stage edge (x≈1454 in a
 * 1600px stage) or under the minimap don't register the click.
 */
function isSafelyClickable(box, stage) {
  const margin = 8
  const insideStage =
    box.x >= stage.x + margin &&
    box.y >= stage.y + margin &&
    box.x + box.width * 0.5 <= stage.x + stage.width - margin &&
    box.y + 20 <= stage.y + stage.height - margin
  // Keep clear of the bottom-right minimap zone (~220x160 inset).
  const clickX = box.x + box.width * 0.45
  const clickY = box.y + 14
  const nearMinimap = clickX > stage.x + stage.width - 240 && clickY > stage.y + stage.height - 180
  return insideStage && !nearMinimap
}

/**
 * multi-node-drag: shift-click N safely-clickable nodes to select them, then
 * drag the primary. React Flow emits a position change per selected node each
 * tick → N store writes/tick (leg-b §9 "multi-select path"). Uses the proven
 * selection coordinates (x*0.45, y+14) that the click-select scenario relies on,
 * and skips nodes off the stage edge / under the minimap that would silently not
 * select. Returns actionDetails with the realized selection count and move count.
 * @param {import('playwright').Page} page
 */
export async function runMultiNodeDrag(page) {
  const stage = await page.locator('.generation-canvas-v2__stage').boundingBox()
  if (!stage) throw new Error('画布 stage 不存在')
  const nodes = page.locator('.generation-canvas-v2-node')
  const total = await nodes.count()
  const picks = []
  for (let index = 0; index < total && picks.length < MULTI_DRAG_NODE_COUNT; index += 1) {
    const box = await nodes.nth(index).boundingBox().catch(() => null)
    if (box && box.width > 20 && box.height > 20 && isSafelyClickable(box, stage)) {
      picks.push({ locator: nodes.nth(index), box })
    }
  }
  if (picks.length < 2) throw new Error(`multi-node-drag 需要至少 2 个可安全点击的节点，仅有 ${picks.length}`)
  await page.keyboard.down('Shift')
  try {
    for (const pick of picks) {
      // x*0.45,y+14 = the click-select scenario's proven selection target;
      // shiftKey propagates to the card pointerdown → additive selection.
      await page.mouse.click(pick.box.x + pick.box.width * 0.45, pick.box.y + 14)
      await sleep(page, 40)
    }
  } finally {
    await page.keyboard.up('Shift')
  }
  await sleep(page, 120)
  const selected = await page.locator('.generation-canvas-v2-node[data-selected="true"]').count()
  // Drag the primary (first pick) with a variable-speed gesture; the rest follow.
  const primary = picks[0]
  const start = { x: primary.box.x + primary.box.width * 0.45, y: primary.box.y + 14 }
  const moves = await variableSpeedDragPath(page, start, { x: start.x + 150, y: start.y + 80 })
  return {
    selected,
    requested: picks.length,
    moves,
    firstFeedbackMs: await readFirstFeedbackMs(page),
    nodeId: await primary.locator.getAttribute('data-node-id'),
  }
}

/**
 * drag-at-low-zoom: assumes the caller has already zoomed the canvas below the
 * lightweight ceiling AND the fixture has >80 nodes (only then does LOD engage;
 * S=48 will NOT — see note in the harness wiring, which pairs this scenario with
 * a scale that crosses the threshold). We drag a lightweight (non-selected)
 * node and record whether lightweight rendering was actually in effect so the
 * result is self-describing rather than silently measuring full-content drag.
 * @param {import('playwright').Page} page
 */
export async function runDragAtLowZoom(page) {
  const zoom = await page.evaluate(
    () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.generation-canvas-v2__canvas')).transform).a,
  )
  const lightweightMounted = await page.locator('.generation-canvas-v2-node[data-render-mode="lightweight"]').count()
  const node = (await firstNodeBox(page, 'image')) || (await firstNodeBox(page, 'video'))
  if (!node) throw new Error('drag-at-low-zoom 没有可见节点可拖')
  const start = { x: node.box.x + node.box.width * 0.5, y: node.box.y + 10 }
  const moves = await variableSpeedDragPath(page, start, { x: start.x + 120, y: start.y + 70 })
  return {
    zoom: Math.round(zoom * 1000) / 1000,
    lightweightMounted,
    lightweightActive: lightweightMounted > 0 && zoom < LIGHTWEIGHT_ZOOM_CEILING,
    moves,
    firstFeedbackMs: await readFirstFeedbackMs(page),
    nodeId: await node.locator.getAttribute('data-node-id'),
  }
}

/**
 * Rank node ids by edge degree from a fixture edge list. RF edge DOM only
 * carries data-testid="rf__edge-<edgeId>" (endpoints are not on the DOM), so we
 * derive degree from the fixture the harness already passes into runAction
 * rather than trying to read it back from the page.
 * @param {ReadonlyArray<{source:string,target:string}>} edges
 * @returns {Array<[string, number]>} [nodeId, degree] sorted desc
 */
export function rankNodesByDegree(edges) {
  const degree = new Map()
  for (const edge of edges || []) {
    if (edge?.source) degree.set(edge.source, (degree.get(edge.source) || 0) + 1)
    if (edge?.target) degree.set(edge.target, (degree.get(edge.target) || 0) + 1)
  }
  return [...degree.entries()].sort((a, b) => b[1] - a[1])
}

/**
 * drag-over-dense-edges: drag the highest edge-degree node that is currently
 * mounted, so every tick recomputes the path of the maximum number of connected
 * edges (adapter resolveHandleIds by geometry). Degree comes from the fixture
 * edge list; density actually exercised is recorded on the sample.
 * @param {import('playwright').Page} page
 * @param {ReadonlyArray<{source:string,target:string}>} fixtureEdges
 */
export async function runDragOverDenseEdges(page, fixtureEdges) {
  const ranked = rankNodesByDegree(fixtureEdges)
  if (!ranked.length) throw new Error('drag-over-dense-edges 夹具没有边')
  const renderedEdges = await page.locator('.react-flow__edge').count()
  // Walk from highest degree down to the first node that is mounted with a box.
  for (const [nodeId, degree] of ranked) {
    const box = await page
      .locator(`.react-flow__node[data-id="${nodeId}"]`)
      .boundingBox()
      .catch(() => null)
    if (box && box.width > 20 && box.height > 20) {
      const start = { x: box.x + box.width * 0.45, y: box.y + 14 }
      const moves = await variableSpeedDragPath(page, start, { x: start.x + 150, y: start.y + 85 })
      return { nodeId, connectedEdges: degree, renderedEdges, moves, firstFeedbackMs: await readFirstFeedbackMs(page) }
    }
  }
  throw new Error('drag-over-dense-edges 高连边节点都未挂载，无法拖动')
}

/**
 * Zoom the canvas out toward a target zoom by wheeling at stage center, so a
 * low-zoom drag scenario can engage lightweight LOD. Mirrors the harness's own
 * prepareScenario wheel loop. Returns the achieved zoom.
 * @param {import('playwright').Page} page
 * @param {number} targetZoom
 */
export async function zoomOutTo(page, targetZoom) {
  const stage = await page.locator('.generation-canvas-v2__stage').boundingBox()
  if (!stage) throw new Error('画布 stage 不存在')
  await page.mouse.move(stage.x + stage.width * 0.5, stage.y + stage.height * 0.5)
  for (let index = 0; index < 30; index += 1) {
    const zoom = await page.evaluate(
      () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.generation-canvas-v2__canvas')).transform).a,
    )
    if (zoom <= targetZoom) break
    await page.mouse.wheel(0, 120)
    await sleep(page, 40)
  }
  await sleep(page, 400)
  return page.evaluate(
    () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.generation-canvas-v2__canvas')).transform).a,
  )
}
