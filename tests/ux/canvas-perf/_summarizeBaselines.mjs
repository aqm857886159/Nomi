// TEMP: summarize the three eval-v2 baseline JSONs into a compact table + U4
// positive-control readout. Not a committed artifact; deleted in U6.
import fs from 'node:fs'
import path from 'node:path'

const dir = 'tests/ux/perf-results'
const legs = {
  prod: 'canvas-eval-v2-baseline-prod-darwin.json',
  dev: 'canvas-eval-v2-baseline-dev.json',
  throttle: 'canvas-eval-v2-baseline-throttle-4x.json',
}

function median(xs) {
  const s = xs.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (!s.length) return null
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const round = (v, p = 2) => (Number.isFinite(v) ? Math.round(v * 10 ** p) / 10 ** p : null)

// Aggregate per scenario across sample runs (skip warmups — harness already
// excludes them from results[]). Returns median of each metric.
function agg(d) {
  const byScenario = {}
  for (const r of d.results) {
    if (r.error) continue
    const s = (byScenario[r.scenario] ||= { fps: [], gapP95: [], maxGap: [], script: [], layout: [], moves: [], recalc: [], offTotal: [], offCommits: [], edgeMut: [] })
    const p = r.probe || {}
    const c = r.cdpDelta || {}
    const a = r.actionDetails || {}
    s.fps.push(p.fps)
    s.gapP95.push(p.frameGapP95Ms)
    s.maxGap.push(p.maxFrameGapMs)
    s.script.push(c.ScriptDurationMs)
    s.layout.push(c.LayoutCount)
    s.recalc.push(c.RecalcStyleCount)
    s.moves.push(a.moves)
    s.edgeMut.push(p.mutations?.edges)
    if (r.offCanvasRender) {
      s.offTotal.push(r.offCanvasRender.total)
      s.offCommits.push(r.offCanvasRender.commits)
    }
  }
  const out = {}
  for (const [sc, m] of Object.entries(byScenario)) {
    const moves = median(m.moves)
    out[sc] = {
      fps: round(median(m.fps), 1),
      gapP95: round(median(m.gapP95), 1),
      maxGap: round(median(m.maxGap), 1),
      scriptMs: round(median(m.script), 1),
      layoutCount: round(median(m.layout), 1),
      moves: round(moves, 1),
      layoutPerMove: moves ? round(median(m.layout) / moves) : null,
      scriptPerMoveMs: moves ? round(median(m.script) / moves) : null,
      edgeMut: round(median(m.edgeMut), 0),
      offCanvasTotal: m.offTotal.length ? round(median(m.offTotal), 0) : null,
      offCanvasCommits: m.offCommits.length ? round(median(m.offCommits), 0) : null,
    }
  }
  return out
}

const data = {}
for (const [leg, file] of Object.entries(legs)) {
  const p = path.join(dir, file)
  if (!fs.existsSync(p)) {
    console.log(`[${leg}] MISSING ${file}`)
    continue
  }
  const d = JSON.parse(fs.readFileSync(p, 'utf8'))
  data[leg] = { kind: d.leg?.kind, runs: d.sampleCount, agg: agg(d) }
}

console.log(JSON.stringify(data, null, 2))

// Focused pan-vs-drag ratios per leg (blank-pan control).
for (const [leg, d] of Object.entries(data)) {
  const pan = d.agg['blank-pan']
  if (!pan) continue
  for (const sc of ['node-drag-image', 'multi-node-drag']) {
    const drag = d.agg[sc]
    if (!drag) continue
    console.log(
      `RATIO [${leg}] ${sc}/blank-pan: script=${round(drag.scriptMs / pan.scriptMs)}x layout=${round(drag.layoutCount / pan.layoutCount)}x | ${sc} layoutPerMove=${drag.layoutPerMove}`,
    )
  }
}
