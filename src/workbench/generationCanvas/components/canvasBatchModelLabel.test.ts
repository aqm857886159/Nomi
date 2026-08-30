import { describe, expect, it } from 'vitest'
import { resolveCanvasBulkModelLabelKey } from './canvasBatchModelLabel'
import type { CanvasGenerationExecutionGroup } from './canvasProductionScope'

const group = (
  executionKind: CanvasGenerationExecutionGroup['executionKind'],
  requiredMode: CanvasGenerationExecutionGroup['requiredMode'],
  nodeId: string,
): CanvasGenerationExecutionGroup => ({ executionKind, requiredMode, nodeIds: [nodeId], representativeKind: executionKind })

describe('resolveCanvasBulkModelLabelKey', () => {
  it('keeps the compact kind label when that kind has one execution mode', () => {
    const image = group('image', 'text_to_image', 'image')

    expect(resolveCanvasBulkModelLabelKey(image, [image])).toBe('generationCommon.production.modelGroup.image')
  })

  it('uses distinct required-mode labels for every same-kind actionable group', () => {
    const textToImage = group('image', 'text_to_image', 'source')
    const imageEdit = group('image', 'image_edit', 'target')
    const textToVideo = group('video', 'text_to_video', 'video')
    const groups = [textToImage, imageEdit, textToVideo]

    expect(resolveCanvasBulkModelLabelKey(textToImage, groups)).toBe(
      'generationCommon.production.modeModelGroup.text_to_image',
    )
    expect(resolveCanvasBulkModelLabelKey(imageEdit, groups)).toBe(
      'generationCommon.production.modeModelGroup.image_edit',
    )
    expect(resolveCanvasBulkModelLabelKey(textToVideo, groups)).toBe(
      'generationCommon.production.modelGroup.video',
    )
  })
})
