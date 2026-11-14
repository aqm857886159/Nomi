import React from 'react'
import type { LabState } from '../../labScreen'
import type { ModelOption } from '../../../../config/models'
import type { PlanAnchor } from '../../../../workbench/generationCanvas/agent/storyboardPlan'
import { MODEL_ARCHETYPES } from '../../../../../electron/shared/modelArchetypes'
import { labAnchorRuntime, labShot } from '../../storyboard/storyboardFixtures'
import { LabLocaleGate } from '../../labLocaleGate'
import { LayoutAnchors, LayoutRows } from '../storyboardLayoutLabKit'
import { layoutPlan } from '../storyboardLayoutFixtures'
import { STORYBOARD_ROW_COMPACT_BELOW } from '../../../../workbench/creation/storyboard/shotRow/storyboardRowDensity'

/**
 * 底栏「谁先让、让到哪」在分镜行 / 参考卡上的量具（2026-11-14 参数面板验收条件 1 + 边界表）：
 * 目录 = 每个档案一行（名字读档案本身），一格只摆一镜 / 一张卡，换档案 × 方式 × 宽度由走查经 `window.__sblYield.set` 来。
 * 宽度是**取景框宽**（664 = 最小窗口的分镜表；NARROWEST = 行内宽正好 520、不换行的最窄一档，再窄整颗换行、不走让法；
 * 取景框带 1px 边框，所以框宽 = 520 + 2）。
 */
export const NARROWEST_ROW_FRAME = STORYBOARD_ROW_COMPACT_BELOW + 2

const SOURCE = 'docs/design/boards/2026-11-14-composer-params/ComposerParams.board.json（便签「边界表」：最窄容器 × 最长名字）'
const ROW = 'src/workbench/generationCanvas/nodes/composerBarYield.ts'

const catalog = (kind: 'video' | 'image'): ModelOption[] => MODEL_ARCHETYPES.filter((archetype) => archetype.kind === kind).map((archetype) => ({
  value: archetype.id, modelKey: archetype.id, vendor: 'apimart', vendorName: 'APIMart', label: archetype.label, kind, meta: { archetypeId: archetype.id },
}))
const MODELS = { video: catalog('video'), image: catalog('image') }

type YieldCombo = { host: 'shot' | 'anchor'; archetypeId: string; modeId: string; width: number }

const PROMPT = '林薇冲进后巷，镜头跟拍，雨水溅起，霓虹在积水里晃'

function YieldCell({ combo }: { combo: YieldCombo }): React.JSX.Element {
  const archetype = MODEL_ARCHETYPES.find((candidate) => candidate.id === combo.archetypeId)!
  if (combo.host === 'anchor') {
    const anchor: PlanAnchor = { id: 'a-yield', kind: 'character', name: '林薇', description: '短发，深色风衣，眼神冷', carrier: 'visual', modelKey: archetype.id, modelVendor: 'apimart', params: {} }
    return <LayoutAnchors cards={[labAnchorRuntime(anchor)]} aspect="16:9" width={combo.width} imageModels={MODELS.image} />
  }
  const shot = labShot({
    index: 1, shotKind: archetype.kind === 'image' ? 'image' : 'video', modelKey: archetype.id, modelVendor: 'apimart', modeId: combo.modeId,
    anchorIds: [], prompt: PROMPT, referenceBindings: {}, ...(archetype.kind === 'image' ? { durationSec: 3 } : {}),
  })
  return <LayoutRows plan={layoutPlan('16:9', [shot])} width={combo.width} models={MODELS} />
}

declare global {
  interface Window { __sblYield?: { combos: (width: number) => YieldCombo[]; set: (combo: YieldCombo) => void } }
}

function combosAt(width: number): YieldCombo[] {
  return MODEL_ARCHETYPES.flatMap((archetype): YieldCombo[] => {
    if (archetype.kind === 'video') return archetype.modes.map((mode) => ({ host: 'shot', archetypeId: archetype.id, modeId: mode.id, width }))
    if (archetype.kind === 'image') {
      const modeId = archetype.defaultModeId ?? archetype.modes[0]!.id
      return [{ host: 'shot', archetypeId: archetype.id, modeId, width }, { host: 'anchor', archetypeId: archetype.id, modeId, width }]
    }
    return []
  })
}

function MatrixStage(): React.JSX.Element {
  const [combo, setCombo] = React.useState<YieldCombo>(() => combosAt(664)[0]!)
  React.useEffect(() => {
    window.__sblYield = { combos: combosAt, set: setCombo }
    return () => { delete window.__sblYield }
  }, [])
  const id = `${combo.host}:${combo.archetypeId}/${combo.modeId}@${combo.width}`
  return <div data-sbl-yield={id}><YieldCell key={id} combo={combo} /></div>
}

/** 边界表格子：最窄不换行的分镜行（行内宽 520）× 名字最长的视频档案 × 它名字最长的方式。 */
function longestVideoCombo(): YieldCombo {
  const archetype = MODEL_ARCHETYPES.filter((candidate) => candidate.kind === 'video').sort((a, b) => b.label.length - a.label.length)[0]!
  const mode = [...archetype.modes].sort((a, b) => b.vendorTerm.length - a.vendorTerm.length)[0]!
  return { host: 'shot', archetypeId: archetype.id, modeId: mode.id, width: NARROWEST_ROW_FRAME }
}

export const YIELD_STATES: readonly LabState[] = [
  {
    id: 'sbl-yield-matrix',
    name: '让法量具（走查用）：window.__sblYield.set(宿主, 档案, 方式, 行宽) 换组合，目录是每个档案一行',
    source: SOURCE, mirrors: ROW, coverage: 'component-only',
    render: () => <MatrixStage />,
  },
  {
    id: 'sbl-yield-narrowest-longest-zh',
    name: '边界 · 最窄不换行的分镜行（行内宽 520）× 名字最长的视频模型 × 最长方式名（中文浅色）',
    source: SOURCE, mirrors: ROW, coverage: 'component-only',
    render: () => <YieldCell combo={longestVideoCombo()} />,
  },
  {
    id: 'sbl-yield-narrowest-longest-en',
    name: '边界 · 最窄不换行的分镜行（行内宽 520）× 名字最长的视频模型 × 最长方式名（英文深色）',
    source: SOURCE, mirrors: ROW, coverage: 'component-only', scheme: 'dark',
    render: () => <LabLocaleGate locale="en"><YieldCell combo={longestVideoCombo()} /></LabLocaleGate>,
  },
]
