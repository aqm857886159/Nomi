import type { ComfyGraph } from './comfyuiWorkflowImport'

export type WorkflowFixture = {
  id: string
  api?: ComfyGraph
  ui?: Record<string, unknown>
  mediaKinds: Array<'image' | 'video' | 'audio'>
  outputKind?: 'image' | 'video' | 'model3d'
  unsupportedOutputKinds?: string[]
  expectPrompt: boolean
}

const saveImage = (nodeId: string, sourceId: string): ComfyGraph => ({
  [nodeId]: { class_type: 'SaveImage', inputs: { filename_prefix: 'Nomi', images: [sourceId, 0] } },
})

export const COMFYUI_WORKFLOW_CORPUS: WorkflowFixture[] = [
  {
    id: 'text-only',
    api: {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a red cube', clip: ['4', 1] } },
      '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'author.safetensors' } },
      ...saveImage('9', '1'),
    },
    mediaKinds: [], outputKind: 'image', expectPrompt: true,
  },
  {
    id: 'single-image',
    api: {
      '1': { class_type: 'LoadImage', inputs: { image: 'author-a.png' } },
      '2': { class_type: 'CLIPTextEncode', inputs: { text: 'turn this into a poster', clip: ['4', 1] } },
      ...saveImage('9', '2'),
    },
    mediaKinds: ['image'], outputKind: 'image', expectPrompt: true,
  },
  {
    id: 'first-last',
    api: {
      '1': { class_type: 'LoadImage', inputs: { image: 'start.png' } },
      '2': { class_type: 'LoadImage', inputs: { image: 'end.png' } },
      '3': { class_type: 'CLIPTextEncode', inputs: { text: 'camera move', clip: ['4', 1] } },
      '10': { class_type: 'SaveVideo', inputs: { video: ['3', 0], filename_prefix: 'Nomi' } },
    },
    mediaKinds: ['image', 'image'], outputKind: 'video', expectPrompt: true,
  },
  {
    id: 'multi-reference-3',
    api: {
      '1': { class_type: 'LoadImage', inputs: { image: 'character.png' } },
      '2': { class_type: 'LoadImage', inputs: { image: 'style.png' } },
      '3': { class_type: 'LoadImage', inputs: { image: 'composition.png' } },
      '4': { class_type: 'ReferenceMixer', inputs: { first: ['1', 0], second: ['2', 0], third: ['3', 0] } },
      ...saveImage('9', '4'),
    },
    mediaKinds: ['image', 'image', 'image'], outputKind: 'image', expectPrompt: false,
  },
  {
    id: 'image-video',
    api: {
      '1': { class_type: 'LoadImage', inputs: { image: 'reference.png' } },
      '2': { class_type: 'LoadVideo', inputs: { file: 'source.mp4' } },
      '3': { class_type: 'VideoConditioning', inputs: { image: ['1', 0], video: ['2', 0] } },
      '10': { class_type: 'SaveVideo', inputs: { video: ['3', 0], filename_prefix: 'Nomi' } },
    },
    mediaKinds: ['image', 'video'], outputKind: 'video', expectPrompt: false,
  },
  {
    id: 'video-only',
    api: {
      '1': { class_type: 'LoadVideo', inputs: { file: 'source.mp4' } },
      '2': { class_type: 'VideoUpscale', inputs: { video: ['1', 0], scale: 2 } },
      '10': { class_type: 'SaveWEBM', inputs: { video: ['2', 0], filename_prefix: 'Nomi' } },
    },
    mediaKinds: ['video'], outputKind: 'video', expectPrompt: false,
  },
  {
    id: 'inline-prompt',
    api: {
      '1': { class_type: 'ByteDanceImageNode', inputs: { prompt: 'a cinematic orange cat', image: 'reference.png' } },
      ...saveImage('9', '1'),
    },
    mediaKinds: [], outputKind: 'image', expectPrompt: true,
  },
  {
    id: 'subgraph-link',
    api: {
      'subgraph-uuid': { class_type: '123e4567-e89b-42d3-a456-426614174000', _meta: { title: 'Prompt subgraph' }, inputs: { prompt: 'subgraph prompt' } },
      '2': { class_type: 'LoadImage', inputs: { image: 'subgraph-ref.png' } },
      ...saveImage('9', 'subgraph-uuid'),
    },
    mediaKinds: ['image'], outputKind: 'image', expectPrompt: true,
  },
  {
    id: 'ui-export',
    ui: { version: 1, nodes: [{ id: 1, type: 'LoadImage' }], links: [] },
    mediaKinds: [], expectPrompt: false,
  },
  {
    id: 'unsupported-output',
    api: {
      '1': { class_type: 'LoadAudio', inputs: { audio: 'voice.wav' } },
      '2': { class_type: 'SaveAudioMP3', inputs: { audio: ['1', 0], filename_prefix: 'Nomi' } },
    },
    // 这条真实语料的**输出**仍不支持（Nomi 存不下 SaveAudioMP3 的产物，unsupportedOutputKinds
    // 照旧）；但它的**输入**——LoadAudio.audio——用户报的根因之一「ComfyUI 音频输入用不了」
    // 在这份真实语料上实锤：根因修复前 mediaKinds 是 []（音频输入完全隐形，识别不出来），
    // 修复后正确识别成 ['audio']。别把这条改回 []，那就是把根因又焊死回去。
    mediaKinds: ['audio'], unsupportedOutputKinds: ['unsupported'], expectPrompt: false,
  },
]
