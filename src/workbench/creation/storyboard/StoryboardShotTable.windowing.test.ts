import fs from 'node:fs'
import path from 'node:path'
import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelOption } from '../../../config/models'
import type { PlanShot, StoryboardPlan } from '../../generationCanvas/agent/storyboardPlan'
import { deriveStoryboardRowRuntimes } from './exec/storyboardRowStatus'

/**
 * 打开一份分镜方案时，挂多少东西——用**数得清的计数**钉住，不靠毫秒（性能波次 10-16 的打法）。
 *
 * 根因（C-trace storyboard-plan-open，320 镜 18.2 秒）：表把每一镜都挂成完整的行——322 个提示词编辑器、
 * 每行各量一次自己的宽度、每行各起一份素材池（每份一次项目文件扫描）。成本随镜头总数线性涨，
 * 打开期间整个应用不响应。
 *
 * 不变量：
 *   ① 挂载的行数 / 编辑器数 ≤ 首屏 + 缓冲，**不随镜头总数增长**（320 镜与 1000 镜挂的一样多）；
 *   ② 行宽测量次数是常数（行容器量一次，经 context 递给每一行），不是每行一次；
 *   ③ 素材池（@ 候选的数据源，挂载即扫一次项目文件）整张表一份，不是每行一份。
 *
 * 用服务端渲染数：没有 DOM 也能跑，窗口化的首屏范围由 `initialRect` 决定，与真机首帧同一条代码路径。
 */

const counters = vi.hoisted(() => ({ widthMeasures: 0, assetPools: 0 }))

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../../../design/media', () => ({
  NomiImage: ({ src }: { src: string }) => React.createElement('img', { src, alt: '' }),
}))
vi.mock('../../generationCanvas/nodes/DeferredNodeMedia', () => ({
  DeferredNodeVideo: ({ src }: { src: string }) => React.createElement('video', { src }),
}))
vi.mock('./shotRow/useElementWidth', () => ({
  useElementWidth: () => { counters.widthMeasures += 1; return null },
}))
vi.mock('../../assets/useAssetPool', () => {
  const pool = { assets: [], canvasAssets: [], projectAssets: [], loading: false, refresh: () => {} }
  return { useAssetPool: () => { counters.assetPools += 1; return pool } }
})

const { default: StoryboardShotTable } = await import('./StoryboardShotTable')

const VIDEO_MODELS = [
  { value: 'veo-3-1', label: 'Veo 3.1', vendor: 'kie', vendorName: 'kie', modelKey: 'veo-3.1', kind: 'video' },
] as ModelOption[]

function planOf(count: number): StoryboardPlan {
  const shots: PlanShot[] = Array.from({ length: count }, (_, i) => ({
    index: i + 1, shotId: `shot-${i + 1}`, shotKind: 'video', durationSec: 5, anchorIds: [],
    prompt: `镜头 ${i + 1}：人物穿过雨夜的街道，镜头跟拍。`, modelKey: 'veo-3.1', modelVendor: 'kie',
  }))
  return { title: 'perf', anchors: [], shots }
}

const NOOP = (): void => {}

function renderTable(count: number): { rows: number; editors: number } {
  const plan = planOf(count)
  const rows = deriveStoryboardRowRuntimes({ plan, designId: 'design-1', imageModelOptions: [], videoModelOptions: VIDEO_MODELS, nodes: [] })
  const html = renderToStaticMarkup(React.createElement(MantineProvider, null, React.createElement(StoryboardShotTable, {
    plan, rows, anchorCards: [], imageModelOptions: [], videoModelOptions: VIDEO_MODELS,
    emptyPromptShots: new Set<number>(), onChange: NOOP,
    onGenerateRow: NOOP, onRegenerateRow: NOOP, onToggleLockRow: NOOP, onOpenPreviewRow: NOOP, onRerunFreshRefsRow: NOOP,
    onDeleteSelected: NOOP,
  })))
  return {
    rows: html.match(/data-storyboard-row="\d+"/g)?.length ?? 0,
    editors: html.match(/data-prompt-box="true"/g)?.length ?? 0,
  }
}

beforeEach(() => {
  counters.widthMeasures = 0
  counters.assetPools = 0
})

describe('打开分镜方案：挂载量只随视口，不随镜头总数', () => {
  it('320 镜：只挂首屏 + 缓冲的行与编辑器', () => {
    const { rows, editors } = renderTable(320)
    expect(rows).toBeGreaterThan(0)
    expect(rows).toBeLessThanOrEqual(16)
    expect(editors).toBeLessThanOrEqual(rows)
  })

  it('320 镜与 1000 镜挂的行数一样多（挂载量与总数无关）', () => {
    expect(renderTable(1000).rows).toBe(renderTable(320).rows)
  })

  it('镜头少于一屏时全部挂上（窗口化不吞行）', () => {
    expect(renderTable(3).rows).toBe(3)
  })

  it('行宽测量：整张表一次，与镜头数无关', () => {
    renderTable(20)
    const at20 = counters.widthMeasures
    counters.widthMeasures = 0
    renderTable(320)
    expect(counters.widthMeasures).toBe(at20)
    expect(counters.widthMeasures).toBeLessThanOrEqual(1)
  })

  it('素材池（挂载即扫一次项目文件）：整张表一份，不是每行一份', () => {
    renderTable(320)
    expect(counters.assetPools).toBe(1)
  })
})

/**
 * 类级不变量（同一类成本不许从另一扇门回来）：
 *   - 分镜目录里只有「行容器」量宽度（`storyboardRowDensity`），任何行级组件都不 import `useElementWidth`；
 *   - 素材池只在 `useShotMentionPool` 里取一次，行级 hook 不直接调 `useAssetPool`；
 *   - 表不靠 DOM 找某一镜（`document.querySelector` / `scrollIntoView` 只能找到挂着的行，窗口化后找不到视口外的）。
 */
describe('结构：行不量自己、不各取素材池、不靠 DOM 找行', () => {
  const read = (relative: string): string => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
  const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const STORYBOARD_DIR = 'src/workbench/creation/storyboard'
  const sourcesUnder = (dir: string): string[] => fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`
    if (entry.isDirectory()) return sourcesUnder(relative)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [relative] : []
  })

  it('useElementWidth 在分镜目录里只有行容器那一处调用', () => {
    const callers = sourcesUnder(STORYBOARD_DIR).filter((file) => !file.endsWith('/useElementWidth.ts') && /\buseElementWidth\(/.test(stripComments(read(file))))
    expect(callers).toEqual([`${STORYBOARD_DIR}/shotRow/storyboardRowDensity.ts`])
  })

  it('useAssetPool 在分镜目录里只有整表那一份（useShotMentionPool）', () => {
    const callers = sourcesUnder(STORYBOARD_DIR).filter((file) => /\buseAssetPool\(/.test(stripComments(read(file))))
    expect(callers).toEqual([`${STORYBOARD_DIR}/shotRow/useShotMentionSource.ts`])
    const source = stripComments(read(`${STORYBOARD_DIR}/shotRow/useShotMentionSource.ts`))
    const poolHook = source.slice(source.indexOf('export function useShotMentionPool'), source.indexOf('export function useShotMentionSource'))
    expect(poolHook).toContain('useAssetPool(')
    expect(source.slice(source.indexOf('export function useShotMentionSource'))).not.toContain('useAssetPool(')
  })

  it('镜头表用仓库现成的虚拟列表，不靠 DOM 找行', () => {
    const table = stripComments(read(`${STORYBOARD_DIR}/StoryboardShotTable.tsx`))
    expect(table).toContain("from '@tanstack/react-virtual'")
    expect(table).toContain('virtualizer.scrollToIndex(')
    expect(table).not.toContain('document.querySelector')
    expect(table).not.toContain('scrollIntoView')
  })
})
