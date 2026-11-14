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

const TOKEN_KINDS = ['mode', 'param', 'slot', 'fixed', 'absent', 'reason', 'pending', 'prompt', 'combine', 'total', 'constrain', 'requires', 'when', 'condition', 'source', 'why']

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
  const claimed = { modes: new Set<string>(), params: new Set<string>(), slots: new Set<string>(), fixed: new Set<string>(), requires: new Set<string>(), when: new Set<string>() }

  for (const row of table.rows) {
    const where = `${table.file} · ${row.item}`
    if (!DISPOSITIONS.includes(row.disposition as Disposition)) problems.push(`${where}：去处「${row.disposition}」不在五种里`)
    if (row.quote.replace(/[`/ ]/g, '').length < 8) problems.push(`${where}：没有文档原文`)
    const kinds = row.tokens.map((t) => t.kind)
    const counts = row.disposition === '露出' || row.disposition === '替创作者定'
    if (row.disposition === '露出' && !kinds.some((k) => ['mode', 'param', 'slot', 'fixed', 'combine', 'total', 'constrain', 'requires', 'when', 'absent'].includes(k))) problems.push(`${where}：「露出」没有任何落点记号`)
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
          const found = control?.optionConstraints?.some((c) => 'key' in c.when && c.when.key === match[3] && String(c.when.value) === match[4] && JSON.stringify(c.values.map(String)) === JSON.stringify(match[5]!.split(',')))
          if (!found) bad(`${mode?.id} 里没有这条选项联动`)
        }
      } else if (kind === 'requires') {
        // requires:<方式>/<槽>=<槽|槽>：这个槽不能单独用，至少还要其中一个（档案 slot.requiresAnyOf）。表格里的 | 写成 \|。
        const match = /^([^/]+)\/([^=]+)=(.+)$/.exec(value)
        if (!match) { bad('写法不对'); continue }
        for (const mode of modesOf(archetype, match[1]!)) {
          const slot = mode?.slots.find((s) => s.kind === match[2])
          if (!mode || !slot) { bad('档案里没有这个输入槽'); continue }
          if (JSON.stringify([...(slot.requiresAnyOf ?? [])].sort()) !== JSON.stringify(match[3]!.split(/\\?\|/).sort())) bad(`${mode.id} 的 requiresAnyOf 与档案不符（档案 ${(slot.requiresAnyOf ?? []).join('|') || '没有'}）`)
          else if (counts) claimed.requires.add(`${mode.id}/${slot.kind}`)
        }
      } else if (kind === 'when') {
        // when:<方式>/<参数>=<值,值>:slotEmpty:<槽>：这个槽没放东西时这些值不能选（档案 optionConstraints 的 slotEmpty 规则，
        // 规则留下的值 = 选项去掉这些值）。
        const match = /^([^/]+)\/([^=]+)=([^:]+):slotEmpty:(.+)$/.exec(value)
        if (!match) { bad('写法不对'); continue }
        const blocked = match[3]!.split(',')
        for (const mode of modesOf(archetype, match[1]!)) {
          const control = mode?.params.find((p) => p.key === match[2])
          const rule = control?.optionConstraints?.find((c) => 'slotEmpty' in c.when && c.when.slotEmpty === match[4])
          const expected = control?.options.map((o) => String(o.value)).filter((v) => !blocked.includes(v))
          if (!mode || !control || !rule) { bad(`${mode?.id} 里没有这条「${match[4]} 空时」的选项约束`); continue }
          if (JSON.stringify(rule.values.map(String)) !== JSON.stringify(expected)) bad(`${mode.id} 的约束留下的值与档案不符（档案 ${rule.values.join(',')}）`)
          else if (counts) claimed.when.add(`${mode.id}/${control.key}/${match[4]}`)
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
    for (const s of mode.slots) if (s.requiresAnyOf?.length && !claimed.requires.has(`${mode.id}/${s.kind}`)) problems.push(`${table.file}：档案有 ${mode.id}/${s.kind} 的 requiresAnyOf，表里没有认领它的 requires 记号`)
    for (const p of mode.params) {
      for (const c of p.optionConstraints ?? []) {
        if ('slotEmpty' in c.when && !claimed.when.has(`${mode.id}/${p.key}/${c.when.slotEmpty}`)) problems.push(`${table.file}：档案有 ${mode.id}/${p.key} 的「${c.when.slotEmpty} 空时」约束，表里没有认领它的 when 记号`)
      }
    }
  }
  return problems
}

/** 一行认领了哪些请求字段：落点记号里的字段名，加上「项」里写出的英文字段名（如 `model`、别名行）。 */
export function fieldsClaimedByRow(row: TableRow): Set<string> {
  const fields = new Set<string>(row.item.match(/[a-z][a-z0-9_]*/g) ?? [])
  for (const { kind, value } of row.tokens) {
    if (kind === 'param' || kind === 'constrain' || kind === 'when') fields.add(value.slice(value.indexOf('/') + 1).split(/[=:]/)[0]!)
    else if (kind === 'prompt') fields.add('prompt')
    else if (kind === 'absent') fields.add(value.includes('/') ? value.split('/')[1]! : value)
    else if (kind === 'slot') { const inputKey = value.split(':')[2]; if (inputKey) fields.add(inputKey) }
    else if (kind === 'fixed') fields.add(value.split('=')[0]!.split('/')[1]!)
    else if (kind === 'combine') fields.add(value.split('=')[1]!)
  }
  return fields
}

/** 文档字段 ↔ 表：官方夹具 `requestFields` 里每个字段（接模型时从文档抄的），表里都要有一行认领（露出 / 不露出 + 原因）。 */
export function checkRequestFields(table: CapabilityTable, requestFields: ReadonlyArray<{ name: string }>): string[] {
  const claimed = new Set(table.rows.flatMap((row) => [...fieldsClaimedByRow(row)]))
  return requestFields.filter((field) => !claimed.has(field.name)).map((field) => `${table.file}：文档字段 ${field.name} 表里没有认领它的行`)
}

// 表 → 官方夹具（tests/fixtures/vendor-official/apimart/<modelKey>.json）。
const FIXTURE_BY_ARCHETYPE: Record<string, string> = {
  'kling-v4-flash': 'kling-v4-flash', 'minimax-h3-max': 'MiniMax-H3-Max', 'seedance-2.5-apimart': 'doubao-seedance-2.5',
  'seedream-5-5': 'seedream-5-5', 'seedream-5-pro': 'doubao-seedream-5-0-pro',
}
type RequestField = { name: string; quote: string; source: string; fetchedAt: string }
function requestFieldsFor(table: CapabilityTable): RequestField[] {
  const modelKey = FIXTURE_BY_ARCHETYPE[table.archetypeId]
  if (!modelKey) throw new Error(`${table.file}：没登记官方夹具`)
  const fixture = JSON.parse(readFileSync(new URL(`../../../tests/fixtures/vendor-official/apimart/${modelKey}.json`, import.meta.url), 'utf8')) as { requestFields?: RequestField[] }
  return fixture.requestFields ?? []
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

  it.each(tables.map((t) => [t.file, t] as const))('%s claims every request field its official fixture lists', (_file, table) => {
    const fields = requestFieldsFor(table)
    expect(fields.length, `${table.file} 的官方夹具没有 requestFields`).toBeGreaterThan(0)
    for (const field of fields) {
      expect(field.quote.trim().length, `${field.name} 没有文档原文`).toBeGreaterThan(0)
      expect(field.source, `${field.name} 出处不是官方文档`).toMatch(/^https:\/\/docs\.apimart\.ai\//)
      expect(field.fetchedAt, `${field.name} 没有抓取日`).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
    expect(checkRequestFields(table, fields)).toEqual([])
  })

  // 反例：表里删掉认领某个文档字段的行 → 红（如可灵删掉 nsfw_check 那一行）。
  it('goes red when a row claiming a documented request field is removed', () => {
    for (const table of tables) {
      const fields = requestFieldsFor(table)
      const victim = table.rows.find((row) => fields.some((f) => fieldsClaimedByRow(row).has(f.name)))!
      const broken = { ...table, rows: table.rows.filter((row) => row !== victim) }
      const lost = fields.filter((f) => fieldsClaimedByRow(victim).has(f.name) && !broken.rows.some((row) => fieldsClaimedByRow(row).has(f.name)))
      if (lost.length) expect(checkRequestFields(broken, fields).length, `${table.file} 删掉「${victim.item}」后应当变红`).toBeGreaterThan(0)
    }
  })

  // 反例：requires / when 两种记号双向——档案拿掉 requiresAnyOf 或 slotEmpty 约束 → 表这边红；表删掉记号 → 档案那边红。
  it('goes red when requiresAnyOf / slotEmpty rules and their table tokens disagree', () => {
    for (const table of tables) {
      const archetype = archetypeFor(table)
      const hasRequires = archetype.modes.some((m) => m.slots.some((s) => s.requiresAnyOf?.length))
      const hasWhen = archetype.modes.some((m) => m.params.some((p) => p.optionConstraints?.some((c) => 'slotEmpty' in c.when)))
      if (!hasRequires && !hasWhen) continue
      const stripped: ModelArchetype = { ...archetype, modes: archetype.modes.map((m) => ({ ...m,
        slots: m.slots.map(({ requiresAnyOf: _drop, ...s }) => s),
        params: m.params.map((p) => ({ ...p, optionConstraints: p.optionConstraints?.filter((c) => !('slotEmpty' in c.when)) })) })) }
      expect(checkTable(table, stripped).some((p) => /requiresAnyOf|空时/.test(p)), `${table.file} 档案拿掉约束后应当变红`).toBe(true)
      const untokened = { ...table, rows: table.rows.map((row) => ({ ...row, tokens: row.tokens.filter((t) => t.kind !== 'requires' && t.kind !== 'when') })) }
      expect(checkTable(untokened, archetype).some((p) => /requires 记号|when 记号/.test(p)), `${table.file} 表删掉记号后应当变红`).toBe(true)
    }
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
