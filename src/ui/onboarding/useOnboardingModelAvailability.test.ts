import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { APIMART_AUDIO_MODELS } from '../../../electron/catalog/apimartAudios'
import { APIMART_IMAGE_MODELS } from '../../../electron/catalog/apimartImages'
import { APIMART_TEXT_MODELS } from '../../../electron/catalog/apimartTexts'
import { APIMART_VIDEO_MODELS } from '../../../electron/catalog/apimartVideos'
import {
  countApimartCatalogModels,
  deriveOnboardingConnectionAvailability,
} from './useOnboardingModelAvailability'

const REAL_APIMART_SEED_ROWS: Array<Record<string, unknown>> = [
  ...APIMART_IMAGE_MODELS.map((m) => ({ ...m, vendorKey: 'apimart', kind: 'image' })),
  ...APIMART_VIDEO_MODELS.map((m) => ({ ...m, vendorKey: 'apimart', kind: 'video' })),
  ...APIMART_AUDIO_MODELS.map((m) => ({ ...m, vendorKey: 'apimart', kind: 'audio' })),
  ...APIMART_TEXT_MODELS.map((m) => ({ ...m, vendorKey: 'apimart', kind: 'text' })),
]

describe('T-5 E0+S7b 连接可用性与实时模型数投影', () => {
  it('C3：APIMart 模型数从内置目录实时统计（排除 legacy 与 promptRefineOnly），绝不写死 85', () => {
    const counts = countApimartCatalogModels(REAL_APIMART_SEED_ROWS)
    expect(counts.image).toBeGreaterThanOrEqual(24)
    expect(counts.video).toBeGreaterThanOrEqual(28)
    expect(counts.audio).toBeGreaterThanOrEqual(9)
    expect(counts.text).toBeGreaterThanOrEqual(24)
    expect(counts.total).toBe(counts.image + counts.video + counts.audio + counts.text)

    // 新增活跃模型立即反映到总数；退役（legacy）或仅润色（promptRefineOnly）不计入
    const withExtras = countApimartCatalogModels([
      ...REAL_APIMART_SEED_ROWS,
      { vendorKey: 'apimart', modelKey: 'future-img-1', kind: 'image', meta: {} },
      { vendorKey: 'apimart', modelKey: 'retired-vid-1', kind: 'video', meta: { catalogLifecycle: 'legacy' } },
      { vendorKey: 'apimart', modelKey: 'internal-refine', kind: 'text', meta: { promptRefineOnly: true } },
    ])
    expect(withExtras.total).toBe(counts.total + 1)
    expect(withExtras.image).toBe(counts.image + 1)
  })

  it('C1：全新空装机虽有 authType=none 的未配置内置种子（火山语音 / 未登录即梦 / 本地语音转写），仍判为无可用连接（主卡必出）', () => {
    const freshVendors = [
      { key: 'apimart', name: 'APIMart', enabled: false, hasApiKey: false, authType: 'bearer' },
      { key: 'volcengine-speech', name: '火山语音', enabled: true, hasApiKey: false, authType: 'none' },
      { key: 'dreamina', name: '即梦', enabled: true, hasApiKey: false, authType: 'none' },
      { key: 'local-speech', name: '本地转写', enabled: true, hasApiKey: false, authType: 'none' },
      { key: 'comfyui', name: 'ComfyUI', enabled: false, hasApiKey: false, authType: 'none' },
      { key: 'local-text', name: 'LocalText', enabled: false, hasApiKey: false, authType: 'none' },
    ]
    const freshModels = [
      ...REAL_APIMART_SEED_ROWS.map((row) => ({
        ...row,
        enabled: false,
        availability: { usable: false, status: 'missing_credentials' },
      })),
      // 这三行在未填凭据的全新装机上 raw availability.usable 为 true，决不能把新用户误判成老用户
      {
        vendorKey: 'volcengine-speech',
        modelKey: 'seed-tts-2',
        labelZh: '火山语音',
        kind: 'audio',
        enabled: true,
        availability: { usable: true, status: 'ready' },
      },
      {
        vendorKey: 'dreamina',
        modelKey: 'dreamina-image',
        labelZh: '即梦图片',
        kind: 'image',
        enabled: true,
        availability: { usable: true, status: 'ready' },
      },
      {
        vendorKey: 'local-speech',
        modelKey: 'sensevoice-small',
        labelZh: '本地语音识别',
        kind: 'audio',
        enabled: true,
        availability: { usable: true, status: 'ready' },
      },
    ]

    const result = deriveOnboardingConnectionAvailability({
      storedModels: freshModels,
      storedVendors: freshVendors,
      dreaminaStatus: { installed: false, loggedIn: false, totalCredit: null, vipLevel: '', notMaestroVip: false },
    })

    expect(result.hasUsableModelConnection).toBe(false)
    expect(result.apimartConnected).toBe(false)
    expect(result.apimartCounts.total).toBeGreaterThan(80)
  })

  it('C2：老用户已有任一可用连接（别家已知供应商 / 自定义中转 / ComfyUI / 本地模型 / 已登录即梦 / APIMart）时均判为已连接（主卡出现 0 次）', () => {
    // 1) 别家已知供应商（OpenRouter）
    expect(
      deriveOnboardingConnectionAvailability({
        storedVendors: [{ key: 'openrouter', name: 'OpenRouter', enabled: true, hasApiKey: true, authType: 'bearer' }],
        storedModels: [
          {
            vendorKey: 'openrouter',
            modelKey: 'anthropic/claude-sonnet-4',
            labelZh: 'Claude Sonnet 4',
            kind: 'text',
            enabled: true,
            availability: { usable: true, status: 'ready' },
          },
        ],
      }),
    ).toMatchObject({ hasUsableModelConnection: true, apimartConnected: false })

    // 2) 自定义中转站（仅配了图片模型，无文本模型）
    expect(
      deriveOnboardingConnectionAvailability({
        storedVendors: [{ key: 'my-relay', name: '自建中转', enabled: true, hasApiKey: true, authType: 'bearer' }],
        storedModels: [
          {
            vendorKey: 'my-relay',
            modelKey: 'flux-pro',
            labelZh: 'Flux Pro',
            kind: 'image',
            enabled: true,
            availability: { usable: true, status: 'ready' },
          },
        ],
      }),
    ).toMatchObject({ hasUsableModelConnection: true, apimartConnected: false })

    // 3) ComfyUI 本地连接
    expect(
      deriveOnboardingConnectionAvailability({
        storedVendors: [{ key: 'comfyui', name: 'ComfyUI', enabled: true, hasApiKey: false, authType: 'none' }],
        storedModels: [
          {
            vendorKey: 'comfyui',
            modelKey: 'sdxl-workflow',
            labelZh: 'SDXL 工作流',
            kind: 'image',
            enabled: true,
            availability: { usable: true, status: 'ready' },
          },
        ],
      }),
    ).toMatchObject({ hasUsableModelConnection: true, apimartConnected: false })

    // 4) 本地文本模型（Ollama / LM Studio）
    expect(
      deriveOnboardingConnectionAvailability({
        storedVendors: [{ key: 'local-text', name: 'LocalText', enabled: true, hasApiKey: false, authType: 'none' }],
        storedModels: [
          {
            vendorKey: 'local-text',
            modelKey: 'qwen3:8b',
            labelZh: 'Qwen3 8B',
            kind: 'text',
            enabled: true,
            availability: { usable: true, status: 'ready' },
          },
        ],
      }),
    ).toMatchObject({ hasUsableModelConnection: true, apimartConnected: false })

    // 5) 即梦已安装且已登录
    expect(
      deriveOnboardingConnectionAvailability({
        storedVendors: [],
        storedModels: [],
        dreaminaStatus: { installed: true, loggedIn: true, totalCredit: 100, vipLevel: 'pro', notMaestroVip: false },
      }),
    ).toMatchObject({ hasUsableModelConnection: true, apimartConnected: false })

    // 6) APIMart 已接入
    expect(
      deriveOnboardingConnectionAvailability({
        storedVendors: [{ key: 'apimart', name: 'APIMart', enabled: true, hasApiKey: true, authType: 'bearer' }],
        storedModels: [
          {
            vendorKey: 'apimart',
            modelKey: 'gpt-image-2',
            labelZh: 'GPT Image 2',
            kind: 'image',
            enabled: true,
            availability: { usable: true, status: 'ready' },
          },
        ],
      }),
    ).toMatchObject({ hasUsableModelConnection: true, apimartConnected: true })
  })

  it('Q18：SplashIntro 组件与设置关于页重看开屏入口已彻底删除', () => {
    const repoRoot = process.cwd()
    expect(fs.existsSync(path.join(repoRoot, 'src/workbench/onboarding/SplashIntro.tsx'))).toBe(false)
    const aboutSource = fs.readFileSync(path.join(repoRoot, 'src/workbench/settings/AboutSection.tsx'), 'utf8')
    expect(aboutSource).not.toContain('onReplaySplash')
    expect(aboutSource).not.toContain('replaySplash')
    const studioSource = fs.readFileSync(path.join(repoRoot, 'src/workbench/NomiStudioApp.tsx'), 'utf8')
    expect(studioSource).not.toContain('SplashIntro')
    expect(studioSource).not.toContain('splashDone')
  })
})
