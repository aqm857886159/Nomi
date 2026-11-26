// Walks open the real screen in its normal state and pass its Playwright Page here.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { randomUUID } from 'node:crypto'
import { readCandidatePositions, VIEWPORT } from './board-extract.mjs'
import { hashBoardSource } from './board-source-hash.mjs'
import { buildDiffReport, comparisonText, validRevision } from './board-diff-report.mjs'
import { readSurface } from './board-diff-page.mjs'
export { buildDiffReport }
const tokenCSS = fs.readFileSync(new URL('../src/theme/nomi-tokens.css', import.meta.url), 'utf8')
const folded = text => comparisonText(text.normalize('NFKC')).toLowerCase()
const unique = items => items.length === 1 ? items[0] : null

function indexSurface(rows) {
  const nodes = new Map(rows.map(row => [row.index, row]))
  const ancestors = row => {
    const result = []
    for (let p = nodes.get(row.parent); p && p !== row && !result.includes(p); p = nodes.get(p.parent)) result.push(p)
    return result
  }
  const chains = new Map(rows.map(row => [row, ancestors(row)]))
  return { nodes, ancestors: row => chains.get(row), inside: (row, root) => row === root || chains.get(row).includes(root) }
}

export function pairCandidates(claims, boardRows, screenRows) {
  const design = indexSurface(boardRows)
  const live = indexSurface(screenRows)
  const matches = new Map()
  const used = new Set()
  const anchor = (claim, options) => {
    const target = unique(options)
    if (target && !used.has(target)) { matches.set(claim, target); used.add(target) }
  }
  // An element marker scopes its multiple claims. A candidate marker identifies one node.
  const pool = claim => {
    const scope = screenRows.filter(row => row.mark === claim.element)
    if (scope.length > 1) return []
    const parents = design.ancestors(claim.row)
    const parent = parents.map(p => [...matches.keys()].find(c => c.row === p)).find(Boolean)
    return screenRows.filter(row => (!scope.length || live.inside(row, scope[0])) &&
      (!parent || live.inside(row, matches.get(parent))))
  }
  const auto = claims.filter(claim => {
    const marked = screenRows.filter(row => row.mark === claim.candidate)
    if (marked.length) { anchor(claim, marked.filter(r => pool(claim).includes(r))); return false }
    const owner = screenRows.filter(row => row.mark === claim.element)
    if (owner.length && claims.filter(c => c.element === claim.element).length === 1) { anchor(claim, owner); return false }
    return true
  })
  for (const claim of auto) {
    const { row } = claim
    if (!row.own && !row.label) continue
    const expected = folded(row.own || row.label)
    const options = pool(claim).filter(r => (r.role ?? null) === (row.role ?? null))
    // Prefer printed text over an ancestor control repeating the same aria-label.
    const exact = options.filter(r => r.own && folded(r.own) === expected)
    anchor(claim, exact.length ? exact : options.filter(r => (r.label && folded(r.label) === expected) || folded(r.printed ?? r.values.text) === expected))
  }
  // A box containing distinct matched text anchors corresponds to their lowest common
  // ancestor. Equal-content wrappers are ambiguous; use a candidate marker to disambiguate.
  for (const claim of auto.toReversed()) {
    if (matches.has(claim) || claim.row.tag === 'svg' || claim.row.own || claim.row.label) continue
    const descendants = [...matches].filter(([c]) => design.inside(c.row, claim.row)).map(([, r]) => r)
    if (descendants.length < 2) continue
    const container = [descendants[0], ...live.ancestors(descendants[0])].find(parent => descendants.every(r => live.inside(r, parent)))
    if (container && (container.role ?? null) === (claim.row.role ?? null) && pool(claim).includes(container)) anchor(claim, [container])
  }
  for (const claim of auto) {
    if (matches.has(claim) || claim.row.tag !== 'svg') continue
    const owners = design.ancestors(claim.row)
    const owner = owners.map(row => [...matches.keys()].find(c => c.row === row)).find(Boolean)
    if (!owner) continue
    const localIcons = boardRows.filter(r => r.tag === 'svg' && design.inside(r, owner.row))
    const actual = pool(claim).filter(r => r.tag === 'svg' && live.inside(r, matches.get(owner)))
    if (actual.length === localIcons.length) anchor(claim, [actual[localIcons.indexOf(claim.row)]])
  }
  const claimed = new Set(claims.map(c => c.row))
  const byRow = new Map(claims.map(c => [c.row, c]))
  function readings(row, surface, occupied) {
    // An unclaimed inline formatting span can split a directly owned phrase on one
    // surface. Keep its place in that phrase without copying another measured label.
    const inlineText = r => r.content.map(item => {
      if (typeof item === 'string') return item
      const child = surface.nodes.get(item)
      return child?.inline && !occupied.has(child) ? inlineText(child) : ''
    }).join('')
    if (!row.own || !row.content) return row.values
    return { ...row.values, text: inlineText(row).replace(/\s+/g, ' ').trim() }
  }
  const pad = r => Object.fromEntries(['Top','Right','Bottom','Left'].map(side => ['padding' + side, r.values['padding' + side]]))
  function insets(inner, outer) {
    const i = inner.values, o = outer.values
    const px = n => Math.round(n * 1000) / 1000
    return { Top: px(i.y - o.y), Left: px(i.x - o.x), Right: px(o.x + o.width - i.x - i.width),
      Bottom: px(o.y + o.height - i.y - i.height) }
  }
  return claims.map(({ candidate, element, row }) => {
    const target = matches.get(byRow.get(row))
    const sample = { candidate, element, board: readings(row, design, claimed),
      screen: target ? readings(target, live, used) : null }
    if (!target) return sample
    const enclosing = design.ancestors(row).find(p => matches.has(byRow.get(p)))
    if (enclosing) {
      const parent = byRow.get(enclosing)
      sample.edges = { relativeTo: parent.candidate, board: insets(row, enclosing), screen: insets(target, matches.get(parent)) }
    }
    // The published census can omit a padded layout cell. Match its own box once
    // within its claimed parent using descendant candidate identities, never by ordinal.
    const cells = boardRows.filter(r => r.parent === row.index && !claimed.has(r))
      .map(cell => ({ cell, labels: claims.filter(c => design.inside(c.row, cell)) }))
      .filter(({ labels }) => labels.length)
    const actualCells = screenRows.filter(r => r.parent === target.index && !used.has(r))
    const parts = cells.flatMap(({ cell, labels }) => {
      const anchors = labels.map(c => matches.get(c)).filter(Boolean)
      const box = anchors.length ? unique(actualCells.filter(r => anchors.every(a => live.inside(a, r)))) : null
      // Repeated cells also own zero padding: newly added padding is a regression.
      if (cells.length === 1 && !Object.values(pad(cell)).some(Boolean) && !(box && Object.values(pad(box)).some(Boolean))) return []
      return [{ anchor: labels[0].candidate, cell, box }]
    })
    if (parts.length) sample.parts = parts.map(({ anchor, cell, box }) => ({
      anchor, board: pad(cell), screen: box && parts.filter(p => p.box === box).length === 1 ? pad(box) : null,
    }))
    return sample
  })
}

export async function measureBoardDiff({ boardPage, screenPage, boardDir, board, boardRoot, screenRoot,
  locale, theme, boardTheme = theme, elements, output, screenRevision }) {
  if (!locale || !['dark', 'light'].includes(theme) || !['dark', 'light'].includes(boardTheme)) throw new Error('需要 locale 和明确的明暗主题')
  if (!validRevision(screenRevision)) throw new Error('需要真屏提交 screenRevision（7–40 位 Git SHA）')
  const read = suffix => JSON.parse(fs.readFileSync(path.join(boardDir, board + suffix), 'utf8'))
  const manifest = read('.board.json')
  const census = read('.candidates.json')
  const sourceSha256 = hashBoardSource(boardDir, board)
  if (sourceSha256 !== census.sourceSha256) throw new Error('板源哈希已变化，请重新抽取候选')
  const preview = new URL(boardPage.url())
  preview.search = ''
  preview.hash = ''
  const sources = [board + '.html', board + '-dark.html'].map(name => pathToFileURL(path.resolve(boardDir, 'preview', name)).href)
  if (!sources.includes(preview.href)) throw new Error('请打开本次板源指纹对应的本地预览')
  const positions = await readCandidatePositions(boardPage)
  if (positions.length !== census.candidates.length || positions.some((p, i) => p.id !== census.candidates[i].id)) {
    throw new Error('当前板页候选与已提交的全板顺序不同，请打开已抽取的预览')
  }
  const collect = async (page, rootSelector, mode) => {
    await page.evaluate(() => document.fonts.ready.then(() => true))
    return page.evaluate(readSurface, { rootSelector, tokenCSS, theme: mode })
  }
  const [boardRows, screenRows] = await Promise.all([collect(boardPage, boardRoot, boardTheme), collect(screenPage, screenRoot, theme)])
  const byIndex = new Map(positions.map(p => [p.index, p.id]))
  const owners = new Map()
  for (const el of manifest.elements) {
    if (elements ? !elements.includes(el.id) : ['dropped', 'deferred'].includes(el.status)) continue
    for (const id of el.candidates ?? []) owners.set(id, el.id)
  }
  const claims = boardRows.flatMap(row => {
    const candidate = byIndex.get(row.index)
    const element = owners.get(candidate)
    return element ? [{ candidate, element, row }] : []
  })
  if (!claims.length) throw new Error('板区域内没有认领候选，不能出具空收据')
  const result = buildDiffReport({ board, sourceSha256, locale, theme, boardTheme, boardRoot, screenRoot, screenRevision },
    pairCandidates(claims, boardRows, screenRows))
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    const temporary = output + '.' + randomUUID()
    try { fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n'); fs.renameSync(temporary, output) }
    finally { fs.rmSync(temporary, { force: true }) }
  }
  return result
}

// For a live Electron Page use the exported function. CLI also accepts a local HTML screen.
async function main() {
  const { values: args } = parseArgs({ options: Object.fromEntries(
    ['dir', 'board', 'screen', 'board-root', 'screen-root', 'locale', 'theme', 'board-theme', 'screen-revision', 'out'].map(key => [key, { type: 'string' }])) })
  for (const k of ['dir', 'board', 'screen', 'locale', 'theme', 'screen-revision', 'out']) if (!args[k]) throw new Error('缺参数 --' + k)
  const { chromium } = await import('playwright')
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ viewport: VIEWPORT, locale: args.locale, colorScheme: args.theme })
    await ctx.route(/^https?:/, route => route.abort())
    const boardPage = await ctx.newPage()
    const screenPage = await ctx.newPage()
    await boardPage.goto(pathToFileURL(path.resolve(args.dir, 'preview', args.board + '.html')).href)
    await screenPage.goto(pathToFileURL(path.resolve(args.screen)).href)
    const r = await measureBoardDiff({ boardDir: args.dir, board: args.board, boardPage, screenPage,
      boardRoot: args['board-root'], screenRoot: args['screen-root'], locale: args.locale, theme: args.theme, screenRevision: args['screen-revision'], boardTheme: args['board-theme'], output: args.out })
    console.log(`${r.samples.length} 个认领候选，${r.differences.length} 条差异 → ${args.out}`)
  } finally { await browser.close() }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err.message); process.exitCode = 1 })
}
