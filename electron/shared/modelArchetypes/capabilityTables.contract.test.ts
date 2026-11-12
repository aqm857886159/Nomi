// 能力表合同：docs/models/capabilities/*.md 每张表和它对应的档案双向对账。
// 表里标「露出 / 替创作者定」的落点，档案里必须真有；档案里的每个方式 / 参数 / 输入槽 / 固定参数，表里必须有一行认领；
// 标「不露出」的 absent 记号，档案里必须真没有。记号写法见 docs/models/capabilities/README.md。
import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getArchetypeById, specializeArchetypeForVendor } from './index'
import type { ModelArchetype } from './types'

const TABLE_DIR = new URL('../../../docs/models/capabilities/', import.meta.url)

const DISPOSITIONS = ['露出', '替创作者定', '不露出', '待定', '待用户判'] as const
type Disposition = (typeof DISPOSITIONS)[number]
const NOT_EXPOSED_REASONS = ['管道', '同一件事', '文档废弃', '模型无效', '现在做不到']

export type TableRow = { item: string; quote: string; disposition: string; tokens: Array<{ kind: string; value: string }> }
export type CapabilityTable = { file: string; archetypeId: string; vendor: string; rows: TableRow[] }

const TOKEN_KINDS = ['mode', 'param', 'slot', 'fixed', 'absent', 'reason', 'pending', 'prompt', 'combine', 'total', 'constrain', 'condition', 'source', 'why']

export function parseTable(file: string, text: string): CapabilityTable {
  const archetypeId = /^- archetype:\s*(\S+)/m.exec(text)?.[1] ?? ''
  const vendor = /^- vendor:\s*(\S+)/m.exec(text)?.[1] ?? ''
  const rows: TableRow[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim())
    if (cells.length !== 4 || cells[0] === '项' || /^-+$/.test(cells[0]!)) continue
    const tokens: TableRow['tokens'] = []
    for (const match of cells[3]!.matchAll(/`([a-z]+):([^`]*)`/g)) {
      if (TOKEN_KINDS.includes(match[1]!)) tokens.push({ kind: match[1]!, value: match[2]! })
    }
    rows.push({ item: cells[0]!, quote: cells[1]!, disposition: cells[2]!, tokens })
  }
  return { file, archetypeId, vendor, rows }
}

type Mode = ModelArchetype['modes'][number]

function modesOf(archetype: ModelArchetype, spec: string): Mode[] {
  if (spec === '*') return archetype.modes
  return spec.split('+').map((id) => archetype.modes.find((m) => m.id === id) ?? (null as never))
}

/** 逐条核落点，返回问题清单（空 = 一致）。 */
export function checkTable(table: CapabilityTable, archetype: ModelArchetype): string[] {
  const problems: string[] = []
  const claimed = { modes: new Set<string>(), params: new Set<string>(), slots: new Set<string>(), fixed: new Set<string>() }

  for (const row of table.rows) {
    const where = `${table.file} · ${row.item}`
    if (!DISPOSITIONS.includes(row.disposition as Disposition)) problems.push(`${where}：去处「${row.disposition}」不在五种里`)
    if (row.quote.replace(/[`/ ]/g, '').length < 8) problems.push(`${where}：没有文档原文`)
    const kinds = row.tokens.map((t) => t.kind)
    const counts = row.disposition === '露出' || row.disposition === '替创作者定'
    if (row.disposition === '露出' && !kinds.some((k) => ['mode', 'param', 'slot', 'fixed', 'combine', 'total', 'constrain', 'absent'].includes(k))) problems.push(`${where}：「露出」没有任何落点记号`)
    if (row.disposition === '替创作者定' && !kinds.some((k) => k === 'absent' || k === 'fixed')) problems.push(`${where}：「替创作者定」要写固定成什么（fixed）或固定不发（absent）`)
    if (row.disposition === '替创作者定' && !kinds.includes('source')) problems.push(`${where}：「替创作者定」要写出处（source:产品已定·出处 / source:出处未找到）`)
    if (row.disposition === '待用户判' && !row.tokens.some((t) => t.kind === 'why' && t.value.trim())) problems.push(`${where}：「待用户判」要写理由（why）`)
    if (row.disposition === '不露出') {
      const reason = row.tokens.find((t) => t.kind === 'reason')?.value
      if (reason === '现在做不到' && !row.tokens.some((t) => t.kind === 'condition' && t.value.trim())) problems.push(`${where}：「现在做不到」要写什么条件下能露出（condition）`)
      if (!reason || !NOT_EXPOSED_REASONS.includes(reason)) problems.push(`${where}：「不露出」的原因必须是 ${NOT_EXPOSED_REASONS.join(' / ')} 之一，现在是「${reason ?? '没写'}」`)
    }
    if (row.disposition === '待定' && !row.tokens.some((t) => t.kind === 'pending' && t.value.trim())) problems.push(`${where}：「待定」要写缺什么（pending）`)

    for (const { kind, value } of row.tokens) {
      const bad = (message: string) => problems.push(`${where}：${kind}:${value} ${message}`)
      if (kind === 'mode') {
        if (!archetype.modes.some((m) => m.id === value)) bad('档案里没有这个方式')
        else if (counts) claimed.modes.add(value)
      } else if (kind === 'prompt') {
        const [id, want] = value.split('=')
        const mode = archetype.modes.find((m) => m.id === id)
        if (!mode) bad('档案里没有这个方式')
        else if (mode.promptRequired !== (want === 'required')) bad(`提示词必填与档案不符（档案 promptRequired=${mode.promptRequired}）`)
      } else if (kind === 'param') {
        const slash = value.indexOf('/')
        const modeSpec = value.slice(0, slash)
        const rest = value.slice(slash + 1)
        const eq = rest.indexOf('=')
        const key = eq < 0 ? rest : rest.slice(0, eq)
        const spec = eq < 0 ? '' : rest.slice(eq + 1)
        const at = spec.lastIndexOf('@')
        const body = at < 0 ? spec : spec.slice(0, at)
        const dflt = at < 0 ? undefined : spec.slice(at + 1)
        for (const mode of modesOf(archetype, modeSpec)) {
          if (!mode) { bad('档案里没有这个方式'); continue }
          const control = mode.params.find((p) => p.key === key)
          if (!control) { bad(`${mode.id} 里没有这个参数`); continue }
          if (counts) claimed.params.add(`${mode.id}/${key}`)
          if (body === 'bool') {
            if (control.type !== 'boolean') bad(`${mode.id} 里不是开关`)
          } else if (/^-?\d+\.\.-?\d+$/.test(body)) {
            const [min, max] = body.split('..').map(Number)
            if (control.type !== 'number' || control.min !== min || control.max !== max) bad(`${mode.id} 数值范围与档案不符（档案 ${control.min}..${control.max}）`)
          } else if (body) {
            if (JSON.stringify(control.options.map((o) => String(o.value))) !== JSON.stringify(body.split(','))) bad(`${mode.id} 选项与档案不符（档案 ${control.options.map((o) => o.value).join(',')}）`)
          }
          if (dflt !== undefined && String(control.defaultValue) !== dflt) bad(`${mode.id} 默认值与档案不符（档案 ${String(control.defaultValue)}）`)
        }
      } else if (kind === 'slot') {
        const [head, maxText, inputKey] = value.split(':')
        const [id, slotKind] = head!.split('/')
        const mode = archetype.modes.find((m) => m.id === id)
        const slot = mode?.slots.find((s) => s.kind === slotKind)
        if (!mode || !slot) bad('档案里没有这个输入槽')
        else {
          if (counts) claimed.slots.add(`${id}/${slotKind}`)
          if (slot.max !== Number(maxText)) bad(`上限与档案不符（档案 ${slot.max}）`)
          if (inputKey && slot.inputKey !== inputKey) bad(`字段名与档案不符（档案 ${slot.inputKey}）`)
        }
      } else if (kind === 'fixed') {
        const [head, expected] = value.split('=')
        const [id, key] = head!.split('/')
        const mode = archetype.modes.find((m) => m.id === id)
        if (!mode || mode.fixedParams?.[key!] !== expected) bad(`与档案的固定参数不符（档案 ${String(mode?.fixedParams?.[key!])}）`)
        else if (counts) claimed.fixed.add(`${id}/${key}`)
      } else if (kind === 'combine') {
        const [id, key] = value.split('=')
        if (archetype.modes.find((m) => m.id === id)?.combineSlotsInto?.key !== key) bad('档案里这个方式没有合并进这个角色数组')
      } else if (kind === 'total') {
        const [id, n] = value.split('=')
        if (archetype.modes.find((m) => m.id === id)?.maxTotalReferences !== Number(n)) bad('参考总数上限与档案不符')
      } else if (kind === 'constrain') {
        const match = /^([^/]+)\/([^:]+):([^=]+)=([^=]+)=>(.+)$/.exec(value)
        if (!match) { bad('写法不对'); continue }
        for (const mode of modesOf(archetype, match[1]!)) {
          const control = mode?.params.find((p) => p.key === match[2])
          const found = control?.optionConstraints?.some((c) => c.when.key === match[3] && String(c.when.value) === match[4] && JSON.stringify(c.values.map(String)) === JSON.stringify(match[5]!.split(',')))
          if (!found) bad(`${mode?.id} 里没有这条选项联动`)
        }
      } else if (kind === 'absent') {
        const [scope, key] = value.includes('/') ? value.split('/') : [undefined, value]
        const modes = scope ? [archetype.modes.find((m) => m.id === scope)].filter(Boolean) as Mode[] : archetype.modes
        for (const mode of modes) {
          const present =
            mode.params.some((p) => p.key === key) ||
            (mode.fixedParams && key! in mode.fixedParams) ||
            mode.slots.some((s) => s.inputKey === key) ||
            mode.combineSlotsInto?.key === key
          if (present) bad(`${mode.id} 里其实有这个参数 / 字段`)
        }
      }
    }
  }

  // 反向：档案里的每个方式、参数、输入槽、固定参数，表里都要有一行认领。
  for (const mode of archetype.modes) {
    if (!claimed.modes.has(mode.id)) problems.push(`${table.file}：档案有方式 ${mode.id}，表里没有「露出」它的行`)
    for (const p of mode.params) if (!claimed.params.has(`${mode.id}/${p.key}`)) problems.push(`${table.file}：档案有参数 ${mode.id}/${p.key}，表里没有认领它的行`)
    for (const s of mode.slots) if (!claimed.slots.has(`${mode.id}/${s.kind}`)) problems.push(`${table.file}：档案有输入槽 ${mode.id}/${s.kind}，表里没有认领它的行`)
    for (const key of Object.keys(mode.fixedParams ?? {})) if (!claimed.fixed.has(`${mode.id}/${key}`)) problems.push(`${table.file}：档案有固定参数 ${mode.id}/${key}，表里没有认领它的行`)
  }
  return problems
}

function load(): CapabilityTable[] {
  return readdirSync(TABLE_DIR)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort()
    .map((name) => parseTable(name, readFileSync(new URL(name, TABLE_DIR), 'utf8')))
}

function archetypeFor(table: CapabilityTable): ModelArchetype {
  const base = getArchetypeById(table.archetypeId)
  if (!base) throw new Error(`${table.file}：档案 ${table.archetypeId} 不存在`)
  return specializeArchetypeForVendor(base, table.vendor)
}

const tables = load()

describe('capability tables (docs/models/capabilities) vs archetypes', () => {
  it('ships a table for each of the five docs-aligned models', () => {
    expect(tables.map((t) => t.archetypeId).sort()).toEqual(['kling-v4-flash', 'minimax-h3-max', 'seedance-2.5-apimart', 'seedream-5-5', 'seedream-5-pro'])
  })

  it.each(tables.map((t) => [t.file, t] as const))('%s matches its archetype both ways', (_file, table) => {
    expect(checkTable(table, archetypeFor(table))).toEqual([])
  })

  // 反例：表里标「露出」的参数，从档案里拿掉 → 红；档案里多长一个表里没有的参数 → 红。
  it('goes red when an exposed parameter is removed from the archetype', () => {
    for (const table of tables) {
      const archetype = archetypeFor(table)
      const victim = archetype.modes.flatMap((m) => m.params.map((p) => [m, p] as const))[0]!
      const broken: ModelArchetype = { ...archetype, modes: archetype.modes.map((m) => (m === victim[0] ? { ...m, params: m.params.filter((p) => p !== victim[1]) } : m)) }
      expect(checkTable(table, broken).length, `${table.file} 删掉 ${victim[0].id}/${victim[1].key} 后应当变红`).toBeGreaterThan(0)
    }
  })

  it('goes red when the archetype grows a parameter the table does not claim', () => {
    for (const table of tables) {
      const archetype = archetypeFor(table)
      const extra = { key: 'brand_new_knob', label: 'x', type: 'boolean' as const, options: [], defaultValue: false }
      const grown: ModelArchetype = { ...archetype, modes: archetype.modes.map((m, i) => (i === 0 ? { ...m, params: [...m.params, extra] } : m)) }
      expect(checkTable(table, grown).some((p) => p.includes('brand_new_knob'))).toBe(true)
    }
  })

  it('goes red when a not-exposed row gives a reason outside the allowed classes, or a pending row gives none', () => {
    const table = tables[0]!
    const bad = parseTable('bad.md', ['- archetype: x', '- vendor: y', '| 项 | 原文 | 去处 | 落点 |', '| - | - | - | - |',
      '| a | `some doc sentence here` | 不露出 | `reason:先不做` |', '| b | `some doc sentence here` | 待定 | `mode:t2v` |'].join('\n'))
    const problems = checkTable(bad, archetypeFor(table))
    expect(problems.some((p) => p.includes('原因必须是'))).toBe(true)
    expect(problems.some((p) => p.includes('待定'))).toBe(true)
  })

  it('goes red when a cannot-do-now row has no condition, a creator-fixed row has no source, or a user-to-judge row has no why', () => {
    const table = tables[0]!
    const bad = parseTable('bad.md', ['- archetype: x', '- vendor: y', '| 项 | 原文 | 去处 | 落点 |', '| - | - | - | - |',
      '| a | `some doc sentence here` | 不露出 | `reason:现在做不到` |',
      '| b | `some doc sentence here` | 替创作者定 | `fixed:t2v/duration=5` |',
      '| c | `some doc sentence here` | 待用户判 | `mode:t2v` |'].join('\n'))
    const problems = checkTable(bad, archetypeFor(table))
    expect(problems.some((p) => p.includes('condition'))).toBe(true)
    expect(problems.some((p) => p.includes('出处'))).toBe(true)
    expect(problems.some((p) => p.includes('why'))).toBe(true)
  })
})
