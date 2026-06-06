/**
 * Provider presets for the manual model-add form.
 *
 * Picking a preset auto-fills BaseURL + 接口类型 + 供应商名称 so users don't have to
 * remember endpoint URLs. Relays/中转站 have their own arbitrary address (a preset
 * can't know it) → the "自定义 / 中转站" entry clears the address for the user to paste,
 * and they lean on 拉取可用模型 (GET /models) to fill in the model ids.
 *
 * `baseUrl: ''` means: anthropic uses its hosted default; custom waits for user input.
 */
import type { ProviderKind } from '../../desktop/providerKind'

export type ProviderPreset = {
  id: string
  label: string
  providerKind: ProviderKind
  baseUrl: string
  /** Provider's API-key console — shown as a "go get your key →" link so users
   *  (the #1 drop-off point) don't have to hunt for where to obtain the key. */
  keyUrl?: string
  /** The catch-all entry: clear the address, let the user paste their own (relays). */
  custom?: boolean
}

// 具名预设已内置正确协议（providerKind），用户选名字即用、不必判断接口格式。
// foxcode 起的 baseUrl/格式参考 CC Switch（farion1231/cc-switch，MIT）的供应商清单 +
// 各家官方 OpenAI-compatible 文档。providerKind 决定走 chat / responses / anthropic。
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', label: 'OpenAI', providerKind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'claude', label: 'Claude', providerKind: 'anthropic', baseUrl: '', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Gemini', providerKind: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey' },
  // foxcode codex 渠道 wire_api=responses，只认 /responses（2026-06-06 实测 502 根因）。
  { id: 'foxcode', label: 'foxcode codex', providerKind: 'openai-responses', baseUrl: 'https://api.fox-code.com/v1', keyUrl: 'https://www.fox-code.com' },
  { id: 'openrouter', label: 'OpenRouter', providerKind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'siliconflow', label: 'SiliconFlow', providerKind: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1', keyUrl: 'https://cloud.siliconflow.cn/account/ak' },
  { id: 'kimi', label: 'Kimi', providerKind: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', keyUrl: 'https://platform.moonshot.cn/console/api-keys' },
  { id: 'zhipu', label: '智谱 GLM', providerKind: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
  { id: 'deepseek', label: 'DeepSeek', providerKind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'volcengine', label: '火山 / Doubao', providerKind: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', keyUrl: 'https://console.volcengine.com/ark' },
  { id: 'dashscope', label: '阿里百炼', providerKind: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://bailian.console.aliyun.com' },
  { id: 'groq', label: 'Groq', providerKind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  { id: 'custom', label: '自定义 / 中转站', providerKind: 'openai-compatible', baseUrl: '', custom: true },
]
