import React from 'react'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ModelOption } from '../../../../config/models'
import type { GenerationCanvasNode } from '../../../generationCanvas/model/generationCanvasTypes'
import type { PlanShot, StoryboardPlan } from '../../../generationCanvas/agent/storyboardPlan'
import { SEEDANCE_2_APIMART_ARCHETYPE } from '../../../../../electron/shared/videoCapabilities/seedanceApimart'
import { deriveShotRowExec } from '../exec/storyboardRowStatus'
import StoryboardShotRow from './StoryboardShotRow'

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('../../../../design/media', () => ({
  NomiImage: ({ src }: { src: string }) => React.createElement('img', { src, alt: '' }),
}))
vi.mock('../../../generationCanvas/nodes/DeferredNodeMedia', () => ({
  DeferredNodeVideo: ({ src }: { src: string }) => React.createElement('video', { src }),
}))

/**
 * 分镜行参考列的红态与「缺参考」是**同一份判据**（exec.missingSlots）——0.22.0 误报的第二半。
 *
 * APIMart Seedance 2.0 图生视频只有一个 image_ref 槽（min 1）。开了首帧的行在生成时把首帧图发进这个槽，
 * 参考列却只看 `shot.referenceBindings`：空 + 必填 → 红，生成前、生成后都红。
 */

const DESIGN = 'design-1'
const I2V = SEEDANCE_2_APIMART_ARCHETYPE.modes.find((mode) => mode.id === 'i2v')!
const OPTIONS = [{
  value: 'doubao-seedance-2.0', label: 'Seedance 2.0', modelKey: 'doubao-seedance-2.0', vendor: 'apimart', kind: 'video',
}] as ModelOption[]

const shotOf = (over: Partial<PlanShot> = {}): PlanShot => ({
  index: 1, shotId: 'shot-1', shotKind: 'video', durationSec: 5, anchorIds: [], prompt: '雨夜巷口',
  modelKey: 'doubao-seedance-2.0', modelVendor: 'apimart', modeId: 'i2v', keyframe: { enabled: true }, ...over,
})

const keyframeNode = (url: string): GenerationCanvasNode => ({
  id: 'kf-1', kind: 'image', title: '', position: { x: 0, y: 0 }, status: 'success',
  meta: { storyboardDesignId: DESIGN, shotId: 'shot-1', storyboardKeyframe: true },
  result: { id: 'kf-result', type: 'image', url, createdAt: 1 },
})

const videoNode = (): GenerationCanvasNode => ({
  id: 'video-1', kind: 'video', title: '', position: { x: 0, y: 0 }, status: 'success',
  meta: { storyboardDesignId: DESIGN, shotId: 'shot-1' },
  result: { id: 'video-result', type: 'video', url: 'nomi-local://asset/shot-1.mp4', thumbnailUrl: 'nomi-local://asset/shot-1.jpg', createdAt: 2 },
})

function renderRow(shot: PlanShot, nodes: GenerationCanvasNode[] = []): string {
  const plan: StoryboardPlan = { title: 'fixture', anchors: [], shots: [shot] }
  const exec = deriveShotRowExec({ plan, shot, designId: DESIGN, nodes, mode: I2V })
  return renderToStaticMarkup(React.createElement(MantineProvider, null, React.createElement(StoryboardShotRow, {
    shot, anchors: [], modelOptions: OPTIONS, danglingIds: [], exec,
    aspect: '16:9', frameBox: { width: 136, height: 77 }, aspectOverridden: false, aspectOptions: [],
    onChangeAspect: () => {}, onUpdate: () => {}, onToggleAnchor: () => {}, onRemove: () => {},
  })))
}

/** 参考列里 image_ref 那一格（从 data-storyboard-ref-slot 起到下一格/列尾）。 */
function imageRefSlot(html: string): string {
  const start = html.indexOf('data-storyboard-ref-slot="image_ref"')
  expect(start, 'row renders the image_ref slot').toBeGreaterThan(-1)
  const next = html.indexOf('data-storyboard-ref-slot=', start + 1)
  return html.slice(start, next === -1 ? undefined : next)
}

describe('分镜行参考列 × 计划首帧（APIMart Seedance 2.0 图生视频）', () => {
  it('生成前：image_ref 格不红，格里是「本镜首帧」占位', () => {
    const slot = imageRefSlot(renderRow(shotOf()))
    expect(slot).not.toContain('workbench-danger')
    expect(slot).toContain('data-storyboard-ref-planned="first-frame"')
  })

  it('首帧图出来之后：格里就是那张首帧图', () => {
    const slot = imageRefSlot(renderRow(shotOf(), [keyframeNode('nomi-local://asset/kf-1.png')]))
    expect(slot).not.toContain('workbench-danger')
    expect(slot).toContain('src="nomi-local://asset/kf-1.png"')
  })

  it('整镜生成完之后：仍不红（此前生成后参考列照样把这一格画成红色必填）', () => {
    const html = renderRow(shotOf(), [keyframeNode('nomi-local://asset/kf-1.png'), videoNode()])
    const slot = imageRefSlot(html)
    expect(slot).not.toContain('workbench-danger')
    expect(slot).toContain('src="nomi-local://asset/kf-1.png"')
  })

  it('对照：没开首帧 → 这一格确实缺，照旧红', () => {
    const slot = imageRefSlot(renderRow(shotOf({ keyframe: { enabled: false } })))
    expect(slot).toContain('workbench-danger')
    expect(slot).not.toContain('data-storyboard-ref-planned')
  })
})
