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
 * 「缺必填参考」只有一份判据（exec.missingSlots）——0.22.0 误报的第二半。
 *
 * APIMart Seedance 2.0 图生视频只有一个 image_ref 槽（min 1）。开了首帧的行在生成时把首帧图发进这个槽：
 * 生成前、生成后都**不算缺**；视觉列的参考条里最前面是一格只读的「本镜首帧」（出图前是虚线占位，出图后就是那张图）。
 * 2026-10-06 起参考在视觉列（`ShotReferenceStrip`），「缺」的红只在预览框（`missing-required`）上说一次。
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
    shot, anchors: [], modelOptions: OPTIONS, exec,
    aspect: '16:9', frameBox: { width: 240, height: 135 },
    onChangeAspect: () => {}, onUpdate: () => {}, onRemove: () => {},
  })))
}

/** 视觉列里的参考条（从 data-storyboard-refs 起到内容列开始）。 */
function referenceStrip(html: string): string {
  const start = html.indexOf('data-storyboard-refs=')
  expect(start, 'row renders the reference strip').toBeGreaterThan(-1)
  const end = html.indexOf('data-storyboard-content-column', start)
  return html.slice(start, end === -1 ? undefined : end)
}
const missingFrame = (html: string): boolean => html.includes('data-storyboard-frame="missing-required"')

describe('分镜行视觉列 × 计划首帧（APIMart Seedance 2.0 图生视频）', () => {
  it('生成前：不算缺（预览框不红），参考条最前面是「本镜首帧」占位', () => {
    const html = renderRow(shotOf())
    expect(missingFrame(html)).toBe(false)
    expect(referenceStrip(html)).toContain('data-storyboard-ref-planned="first-frame"')
  })

  it('首帧图出来之后：参考条里那一格就是那张首帧图', () => {
    const html = renderRow(shotOf(), [keyframeNode('nomi-local://asset/kf-1.png')])
    expect(missingFrame(html)).toBe(false)
    expect(referenceStrip(html)).toContain('src="nomi-local://asset/kf-1.png"')
  })

  it('整镜生成完之后：仍不红（此前生成后照样画成红色必填）', () => {
    const html = renderRow(shotOf(), [keyframeNode('nomi-local://asset/kf-1.png'), videoNode()])
    expect(missingFrame(html)).toBe(false)
    expect(referenceStrip(html)).toContain('src="nomi-local://asset/kf-1.png"')
  })

  it('对照：没开首帧 → 这一镜确实缺，预览框红，参考条里没有计划首帧', () => {
    const html = renderRow(shotOf({ keyframe: { enabled: false } }))
    expect(missingFrame(html)).toBe(true)
    expect(html).not.toContain('data-storyboard-ref-planned')
  })
})
