import { describe, expect, it } from 'vitest'
import type { CustomCallScriptMode } from './customCallScriptModes'
import { buildCustomCallTestFixture } from './customCallTestFixture'

function mode(patch: Partial<CustomCallScriptMode> = {}): CustomCallScriptMode {
  return {
    id: 'future-mode',
    label: 'Future mode',
    hint: 'A future model-defined mode',
    taskKind: 'image_to_video',
    promptRequired: true,
    slots: [],
    parameters: [],
    fixedParams: {},
    ...patch,
  }
}

describe('custom call test fixture', () => {
  it('uses declared slots rather than interpreting a mode name', () => {
    const selected = mode({
      id: 'future_motion_reference',
      slots: [
        { kind: 'image_ref', label: '人物参考', min: 2, max: 8 },
        { kind: 'video_ref', label: '动作参考', min: 1, max: 3 },
        { kind: 'audio_ref', label: '声音参考', min: 1, max: 2 },
      ],
    })

    const fixture = buildCustomCallTestFixture({
      modelKind: 'video',
      mode: selected,
      references: {
        image_ref: ['https://assets.test/person-1.png', 'https://assets.test/person-2.png'],
        video_ref: ['https://assets.test/motion.mp4'],
        audio_ref: ['https://assets.test/voice.wav'],
      },
    })

    expect(fixture.ready).toBe(true)
    expect(fixture.missing).toEqual([])
    expect(fixture.params).toMatchObject({
      reference_image_urls: ['https://assets.test/person-1.png', 'https://assets.test/person-2.png'],
      reference_images: ['https://assets.test/person-1.png', 'https://assets.test/person-2.png'],
      reference_video_urls: ['https://assets.test/motion.mp4'],
      reference_audio_urls: ['https://assets.test/voice.wav'],
    })
  })

  it('keeps first and last frame as one possible slot combination, not a global schema', () => {
    const fixture = buildCustomCallTestFixture({
      modelKind: 'video',
      mode: mode({
        id: 'frames',
        slots: [
          { kind: 'first_frame', label: '开场画面', min: 1, max: 1 },
          { kind: 'last_frame', label: '结束画面', min: 1, max: 1 },
        ],
      }),
      references: {
        first_frame: ['https://assets.test/first.png'],
        last_frame: ['https://assets.test/last.png'],
      },
    })

    expect(fixture.params).toMatchObject({
      first_frame_url: 'https://assets.test/first.png',
      last_frame_url: 'https://assets.test/last.png',
    })
    expect(fixture.params).not.toHaveProperty('reference_image_urls')
  })

  it('reports every missing required slot without blocking modes that need no media', () => {
    const missing = buildCustomCallTestFixture({
      modelKind: 'video',
      mode: mode({
        slots: [
          { kind: 'image_ref', label: '参考图', min: 3, max: 6 },
          { kind: 'source_video', label: '源视频', min: 1, max: 1 },
        ],
      }),
      references: { image_ref: ['https://assets.test/one.png'] },
    })

    expect(missing.ready).toBe(false)
    expect(missing.missing).toEqual([
      { kind: 'image_ref', label: '参考图', required: 3, provided: 1 },
      { kind: 'source_video', label: '源视频', required: 1, provided: 0 },
    ])

    const textOnly = buildCustomCallTestFixture({ modelKind: 'video', mode: mode(), references: {} })
    expect(textOnly.ready).toBe(true)
  })

  it('uses mode parameter defaults and fixed values for the real trial', () => {
    const fixture = buildCustomCallTestFixture({
      modelKind: 'video',
      mode: mode({
        parameters: [
          { key: 'duration', label: '时长', type: 'number', options: [], defaultValue: 6 },
          {
            key: 'aspect_ratio',
            label: '比例',
            type: 'select',
            options: [{ value: 'adaptive', label: '自适应' }],
          },
        ],
        fixedParams: { generation_type: 'reference' },
      }),
      references: {},
    })

    expect(fixture.params).toMatchObject({
      duration: 6,
      aspect_ratio: 'adaptive',
      generation_type: 'reference',
    })
  })

  it('supports the model-level fallback without inventing reference requirements', () => {
    const fixture = buildCustomCallTestFixture({ modelKind: 'image', mode: null, references: {} })
    expect(fixture.ready).toBe(true)
    expect(fixture.slots).toEqual([])
    expect(fixture.params).toMatchObject({ n: 1 })
  })
})
