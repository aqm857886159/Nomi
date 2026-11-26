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
  'text', 'x', 'y', 'width', 'height', 'gapBefore', 'gapAfter', 'iconPath',
  ...['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].map(s => 'radius' + s),
  ...sides.flatMap(s => ['border' + s + 'Width', 'border' + s + 'Color', 'padding' + s, 'parentPadding' + s]),
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

export function differencesOf(samples) {
  const differences = []
  for (const { candidate, element, board, screen } of samples) {
    if (!candidate || !element || !board) throw new Error('差异清单缺候选、元素或板值')
    for (const property of properties) {
      if (!valid(property, board[property]) || (screen !== null && !valid(property, screen?.[property]))) {
        throw new Error(`差异清单 ${candidate} 缺有效读数 ${property}`)
      }
      if (screen === null) continue
      const expected = snapped(property, board[property])
      const actual = snapped(property, screen[property])
      if (expected.offScale || expected.value !== actual.value) differences.push({
        candidate, element, property, board: board[property], screen: screen[property],
        boardToken: expected.value, screenToken: actual.value,
        reason: expected.offScale ? 'off-scale' : 'different',
      })
    }
    if (screen === null) differences.push({ candidate, element, property: 'pair', board: board.text, screen: null, reason: 'unmatched' })
  }
  return differences
}

export function buildDiffReport(context, samples) {
  return { ...context, version: 1, samples, differences: differencesOf(samples) }
}
