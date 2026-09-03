// 抠图进度文案的类级不变量。
//
// 背景：启动期不再预热抠图模型（src/main.tsx 曾无条件 preloadRemoveBackground），
// ~50MB 的模型+运行时改为首次真正抠图时下载。这把一次「看不见的启动开销」换成了
// 一次「用户当场要等的 50MB」——那段等待期间屏幕上说什么，就成了唯一的体验保障。
//
// 钉住的是「每个 @imgly 阶段 key 都翻成一句非兜底的话」，不是耗时。
import { describe, expect, it } from 'vitest'
import { removeBackgroundProgressMessage } from './localImageOpPhase'
import i18n from '../../../i18n'

const matte = (step: string): string =>
  i18n.t(`generationCommon.imageToolbar.matteProgress.${step}` as 'generationCommon.imageToolbar.matteProgress.decode')

// @imgly/background-removal 1.7.0 真实发出的全部 key。
// 下载族来自 loadAsBlob/loadAsUrl（index.mjs:979 `fetch:${key}`），资源路径见
// index.mjs:5286 `/models/${model}` 与 index.mjs:1014 `/onnxruntime-web/ort-wasm-simd-threaded{,.jsep}`。
// 推理族来自 api/v1.ts 的 compute:decode / inference / mask / encode。
const IMGLY_FETCH_KEYS = [
  'fetch:/models/isnet_quint8',
  'fetch:/models/isnet',
  'fetch:/models/isnet_fp16',
  'fetch:/onnxruntime-web/ort-wasm-simd-threaded.wasm',
  'fetch:/onnxruntime-web/ort-wasm-simd-threaded.mjs',
  'fetch:/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm',
  'fetch:/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs',
]

const IMGLY_COMPUTE_KEYS = ['compute:decode', 'compute:inference', 'compute:mask', 'compute:encode']

describe('removeBackgroundProgressMessage', () => {
  it('把每一条下载 key 都说成「正在下载模型」，而不是兜底的「抠图中」', () => {
    // 这是本次改动的核心不变量：删掉启动预热后，下载阶段必须自报家门。
    // 回归形态一：wasm 那两条不含 "decode/inference/mask/encode/model"，
    // 一旦 fetch: 分支消失，它们会静默掉进 fallback「抠图中」——用户看不出在下载。
    for (const key of IMGLY_FETCH_KEYS) {
      expect(removeBackgroundProgressMessage(key), key).toBe(matte('download'))
    }
  })

  it('模型下载 key 含 "model" 但仍归下载，不被 model 分支截胡', () => {
    // 回归形态二：`fetch:/models/isnet_quint8` 同时匹配 fetch: 与 includes('model')。
    // 若判定顺序被调换，这条会说成「加载抠图模型」——把 44MB 下载说成本地加载。
    expect(removeBackgroundProgressMessage('fetch:/models/isnet_quint8')).not.toBe(matte('model'))
    expect(removeBackgroundProgressMessage('fetch:/models/isnet_quint8')).toBe(matte('download'))
  })

  it('推理各步各自成句，互不串味', () => {
    expect(removeBackgroundProgressMessage('compute:decode')).toBe(matte('decode'))
    expect(removeBackgroundProgressMessage('compute:inference')).toBe(matte('inference'))
    expect(removeBackgroundProgressMessage('compute:mask')).toBe(matte('mask'))
    expect(removeBackgroundProgressMessage('compute:encode')).toBe(matte('encode'))
  })

  it('@imgly 已知 key 无一落进兜底', () => {
    // 类级断言：兜底句只该留给「将来 @imgly 新增的、我们还没见过的 key」。
    // 任何一条已知 key 落进 fallback，都是一次用户看不懂等待的回归。
    for (const key of [...IMGLY_FETCH_KEYS, ...IMGLY_COMPUTE_KEYS]) {
      expect(removeBackgroundProgressMessage(key), key).not.toBe(matte('fallback'))
    }
  })

  it('未知 key 仍安全兜底，不抛不留空', () => {
    const message = removeBackgroundProgressMessage('compute:something-new-in-a-future-version')
    expect(message).toBe(matte('fallback'))
    expect(message.length).toBeGreaterThan(0)
  })
})
