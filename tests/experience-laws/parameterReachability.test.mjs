// 铁律 ⑪「能选到」的门：模型档案声明的参数 ⊆ 每个用户入口能选到的参数。
// 清单与入口判据都在 parameterReachability.mjs；登记表在 reachabilityLedger.json。
// 每次跑都重写覆盖表到 artifacts/experience-laws/parameter-reachability.md（产物目录，不进 git）。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  MODE_AXIS,
  NOT_PARAMETER_ENTRIES,
  PARAMETER_RENDERERS,
  REACHABILITY_ENTRIES,
  buildReachabilityMatrix,
  classifyGaps,
  gapClassKey,
  gapsOf,
  publishedModelRows,
  renderCoverageTable,
} from './parameterReachability.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '../..')
const ledger = JSON.parse(fs.readFileSync(path.join(here, 'reachabilityLedger.json'), 'utf8'))
const escapeLedger = JSON.parse(fs.readFileSync(path.join(repoRoot, 'tests/ux/full-walk/escapeLedger.json'), 'utf8'))

const rows = publishedModelRows()
const cells = buildReachabilityMatrix(rows)
const gapClasses = classifyGaps(gapsOf(cells))
const waived = new Map(ledger.waivers.map((entry) => [entry.class, entry]))
const known = new Map(ledger.knownGaps.map((entry) => [entry.class, entry]))

describe('铁律 ⑪ 能选到', () => {
  it('清单是从内置目录与档案生成的，不是空的（生成器坏了不许假绿）', () => {
    // 下限只防「生成器读空了」：内置目录目前一百多个认得档案的发布行，三类入口都必须有格子。
    expect(rows.length).toBeGreaterThan(50)
    for (const entry of REACHABILITY_ENTRIES) {
      expect(cells.filter((cell) => cell.entry === entry.id).length, `${entry.id} 一格都没有`).toBeGreaterThan(100)
    }
    expect(new Set(rows.map((row) => row.kind))).toEqual(new Set(['image', 'video', 'audio', 'model3d']))
  })

  it('每一个缺口类要么豁免（写了理由），要么是登记过的已知缺口；表外不许冒新的', () => {
    const unexplained = gapClasses.filter((gap) => !waived.has(gap.key) && !known.has(gap.key))
    const detail = unexplained.map((gap) => `${gap.key}（${gap.models.size} 个模型，例如 ${[...gap.models].slice(0, 3).join('、')}）`)
    expect(detail, '新出现的「选不到」：修掉，或者写进 reachabilityLedger.json（豁免要理由，缺口要账本 candidate）').toEqual([])
  })

  it('登记表里的类都还真实存在（修好了就删那一行——棘轮只减不增）', () => {
    const live = new Set(gapClasses.map((gap) => gap.key))
    const stale = [...waived.keys(), ...known.keys()].filter((key) => !live.has(key))
    expect(stale, '这些缺口已经不存在了：从 reachabilityLedger.json 删掉，并在逃逸账本那条写 completionCommits').toEqual([])
  })

  it('豁免必须写理由；已知缺口必须指向逃逸账本里的 ⑪ 条目', () => {
    for (const waiver of ledger.waivers) expect(String(waiver.reason ?? '').trim().length, `${waiver.class} 没写豁免理由`).toBeGreaterThan(10)
    const ledgerIds = new Map(escapeLedger.entries.map((entry) => [entry.id, entry]))
    for (const gap of ledger.knownGaps) {
      const entry = ledgerIds.get(gap.ledgerId)
      expect(entry, `${gap.class} 指向的账本条目 ${gap.ledgerId} 不存在`).toBeTruthy()
      expect(entry.ironLaws).toContain('⑪')
    }
  })

  it('「跨镜头一致」参考卡的可选项来自它真实的源码：它一旦开始渲染参数 / 模式，这里的 anchorCardReach 必须跟着改', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'src/workbench/creation/storyboard/anchorZone/StoryboardAnchorRow.tsx'), 'utf8')
    const used = PARAMETER_RENDERERS.filter((name) => new RegExp(`\b${name}\b`).test(source))
    expect(used, 'StoryboardAnchorRow 开始用控件解析了：把 parameterReachability.mjs 的 anchorCardReach 改成调同一个函数').toEqual([])
    expect(source).toMatch(/useDedupedModelSelect/)
  })

  it('碰到模型的其它界面都点过名，且文件都还在（数漏了或改名了就红）', () => {
    for (const item of NOT_PARAMETER_ENTRIES) {
      expect(fs.existsSync(path.join(repoRoot, item.owner)), `${item.owner} 不存在了，清单要跟着改`).toBe(true)
      expect(item.why.length).toBeGreaterThan(10)
    }
  })

  it('判据会咬人：入口少给一个参数，就算成缺口', () => {
    const declaredSomewhere = cells.find((cell) => cell.reached && cell.param !== MODE_AXIS && cell.type === 'select')
    expect(declaredSomewhere).toBeTruthy()
    const broken = { ...declaredSomewhere, reached: false, missingOptions: [] }
    expect(gapsOf([broken]).map(gapClassKey)).toEqual([`${broken.entry}|${broken.param}|param:select`])
    const narrowed = { ...declaredSomewhere, missingOptions: ['only-in-archetype'] }
    expect(gapsOf([narrowed]).map((gap) => gap.gap)).toEqual(['options'])
  })

  it('写出覆盖表（artifacts/experience-laws/parameter-reachability.md）', () => {
    const annotated = gapClasses.map((gap) => ({
      ...gap,
      status: waived.has(gap.key) ? `豁免：${waived.get(gap.key).reason}` : `待定：${known.get(gap.key)?.ledgerId ?? '未登记'}`,
    }))
    const table = renderCoverageTable({ cells, gapClasses: annotated, waived: waived.size, known: known.size })
    const out = path.join(repoRoot, 'artifacts', 'experience-laws', 'parameter-reachability.md')
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, table)
    expect(table).toContain('铁律 ⑪')
  })
})
