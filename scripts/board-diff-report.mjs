// Measured values are preserved in the receipt. R4 derives the differences again on read.
import fs from 'node:fs'

// PR-body validation runs without npm dependencies. Read the four literal px scales in
// nomiDesignTokens without evaluating the theme (which also imports Mantine / React).
let dimensions
function designScales() {
  if (dimensions) return dimensions
  const theme = fs.readFileSync(new URL('../src/theme/nomiTheme.ts', import.meta.url), 'utf8')
  const block = theme.split('export const nomiDesignTokens = {')[1]?.split('} as const')[0] ?? ''
  const scales = {}
  for (const group of ['radius', 'spacing', 'fontSize', 'lineHeight']) {
    const body = block.match(new RegExp('\\b' + group + ': \\{([^}]+)\\}'))?.[1]
    const scale = new Map()
    for (const entry of (body ?? '').trim().split(',').filter(s => s.trim())) {
      const match = /^\s*(\w+):\s*['"](\d+(?:\.\d+)?)px['"]\s*$/.exec(entry)
      if (!match) throw new Error('无法读取 nomiDesignTokens.' + group + ' 的 px 令牌')
      scale.set(Number(match[2]), group + '.' + match[1])
    }
    if (!scale.size) throw new Error('缺少 nomiDesignTokens.' + group)
    scales[group] = scale
  }
  // §2.3 also defines the display size outside Mantine's heading scale.
  const system = fs.readFileSync(new URL('../docs/design/nomi-design-system.md', import.meta.url), 'utf8')
  for (const [, token, px] of system.split('### 2.3 字号 token')[1].split('### 2.4')[0].matchAll(/^\| `([\w]+)` \| .*?`text-[^|]+`.*? \| (\d+) \|/gm)) {
    scales.fontSize.set(Number(px), 'fontSize.' + token)
  }
  scales.spacing.set(0, 'spacing.0')
  dimensions = scales
  return scales
}
const sides = ['Top', 'Right', 'Bottom', 'Left']
const properties = [
  'fontSize', 'lineHeight', 'fontWeight', 'monospace', 'color', 'backgroundColor', 'fontVariantNumeric',
  'text', 'width', 'height', 'gapBefore', 'gapAfter', 'iconPath',
  ...['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map(s => 'radius' + s),
  ...sides.flatMap(s => ['border' + s + 'Width', 'border' + s + 'Color', 'padding' + s]),
]
const nullable = new Set(['gapBefore', 'gapAfter', 'iconPath', ...sides.map(s => 'border' + s + 'Color')])
const strings = new Set(['text', 'iconPath', 'color', 'backgroundColor', 'fontVariantNumeric', ...sides.map(s => 'border' + s + 'Color')])
function valid(property, value) {
  if (value === null) return nullable.has(property)
  if (property === 'monospace') return typeof value === 'boolean'
  if (property === 'lineHeight' && value === 'normal') return true
  if (property === 'lineHeight') return Number.isFinite(value)
  if (strings.has(property)) return typeof value === 'string' && (property === 'text' || value.length > 0)
  if (property.startsWith('radius') && typeof value === 'string') return value.trim().length > 0
  return Number.isFinite(value)
}

function snapped(property, value) {
  if (value === null) return { value }
  if (property === 'text') return { value: comparisonText(value) }
  let group
  if (property === 'fontSize' || property === 'lineHeight') group = property
  else if (property.startsWith('radius')) group = 'radius'
  else if (/padding|^gap/i.test(property)) group = 'spacing'
  if (group) {
    const token = group === 'radius' && value >= 999 ? 'radius.pill' : designScales()[group].get(value)
    return { value: token ?? value, offScale: !token }
  }
  // Colors are resolved in the browser against the actual light/dark token palette.
  if (/color/i.test(property)) return { value, offScale: value.startsWith('#') }
  return { value }
}

// Folding preserves words, punctuation, currency signs and case. Only displayed example
// digits and the variable prefix/suffix of a visibly masked credential are placeholders.
export function comparisonText(text) {
  return text.replace(/(?:[a-zA-Z0-9_-]*[-_])?[•●]{2,}[a-zA-Z0-9_-]*/gu, '••••')
    .replace(/\p{Nd}+/gu, '#').replace(/\s+/g, ' ').trim()
}

const typeProperties = new Set(['fontSize', 'lineHeight', 'monospace', 'fontWeight', 'fontVariantNumeric', 'color'])
const padProperties = sides.map(side => 'padding' + side)
const rawProperties = ['x', 'y', ...properties]

function validateSurface(candidate, v) {
  for (const flag of ['ownsText', 'intrinsicWidth', 'fixedHeight']) {
    if (typeof v?.[flag] !== 'boolean') throw new Error(`差异清单 ${candidate} 缺测量意图 ${flag}`)
  }
  for (const property of rawProperties) {
    if (!valid(property, v[property])) throw new Error(`差异清单 ${candidate} 缺有效读数 ${property}`)
  }
  if (v.ownsText !== Boolean(v.text.trim())) throw new Error(`差异清单 ${candidate} 直接文字归属不符`)
}

export function differencesOf(samples) {
  const differences = []
  for (const { candidate, element, board, screen, parts = [], edges = null } of samples) {
    if (!candidate || !element || !board) throw new Error('差异清单缺候选、元素或板值')
    validateSurface(candidate, board)
    if (screen === null) {
      differences.push({ candidate, element, property: 'pair', board: board.text, screen: null, reason: 'unmatched' })
      continue
    }
    validateSurface(candidate, screen)
    const compare = (property, b, s, part) => {
      const expected = snapped(property, b), actual = snapped(property, s)
      if (expected.offScale || expected.value !== actual.value) differences.push({
        candidate, element, ...(part ? { part } : {}), property, board: b, screen: s,
        boardToken: expected.value, screenToken: actual.value, reason: expected.offScale ? 'off-scale' : 'different',
      })
    }
    for (const property of properties) {
      if (property === 'width' && !board.intrinsicWidth) continue
      if (property === 'height' && !board.fixedHeight) continue
      if (typeProperties.has(property) && !(board.ownsText && screen.ownsText)) continue
      compare(property, board[property], screen[property])
    }
    for (const { anchor, board: cell, screen: actual } of parts) {
      if (!anchor || !padProperties.every(p => valid(p, cell?.[p]))) throw new Error(`差异清单 ${candidate} 格读数不全`)
      if (actual === null) {
        differences.push({ candidate, element, part: anchor, property: 'pair', board: anchor, screen: null, reason: 'unmatched' })
        continue
      }
      for (const p of padProperties) {
        if (!valid(p, actual?.[p])) throw new Error(`差异清单 ${candidate} 格读数不全`)
        compare(p, cell[p], actual[p], anchor)
      }
    }
    // Measure a ruled box's flush edges against the same paired enclosing box on both
    // surfaces. A viewport resize alone moves neither edge away from that enclosure.
    if (edges) {
      const horizontal = Boolean(board.borderTopWidth) !== Boolean(board.borderBottomWidth)
      const vertical = Boolean(board.borderLeftWidth) !== Boolean(board.borderRightWidth)
      for (const side of sides) {
        if (!Number.isFinite(edges.board[side]) || !Number.isFinite(edges.screen[side])) throw new Error('差异清单缺分隔线读数')
        const ruled = ['Left', 'Right'].includes(side) ? horizontal : vertical || (horizontal && parts.length > 1)
        if (ruled && edges.board[side] === 0) compare('inset' + side, 0, edges.screen[side])
      }
    }
  }
  return differences
}

export const validRevision = sha => typeof sha === 'string' && /^[0-9a-f]{7,40}$/i.test(sha)
export function buildDiffReport(context, samples) {
  return { ...context, version: 2, samples, differences: differencesOf(samples) }
}
