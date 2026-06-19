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
  /** 分组（Issue #8 可发现性）：'relay' = 中转站（文本/图片/视频，用户填自己地址）；
   *  'official' = 官方厂商（文本，地址内置）。把中转拎成一等公民，不混在 LLM chip 里。 */
  group?: 'relay' | 'official'
}

// 具名预设已内置正确协议（providerKind），用户选名字即用、不必判断接口格式。
// baseUrl/格式取各家官方 OpenAI-compatible 文档（host 均经 DNS+端点实测，见
// tests/ux 协议指纹扫描）。providerKind 决定走 chat / responses / anthropic。
// 注：openai-responses 协议的中转（如 foxcode codex，wire_api=responses）暂不放预设——
// 其 host 未经核实；用户走「自定义」即可，主进程 auto-probe 会自动探测出 Responses 协议。
export const PROVIDER_PRESETS: ProviderPreset[] = [
  // 中转站组（一等公民，最上）：用户填自己地址；图片/视频/文本都能接。
  { id: 'newapi', label: 'new-api 中转', providerKind: 'openai-compatible', baseUrl: '', custom: true, group: 'relay' },
  { id: 'custom', label: '自定义', providerKind: 'openai-compatible', baseUrl: '', custom: true, group: 'relay' },
  // 官方厂商组（文本，地址内置）。
  { id: 'openai', label: 'OpenAI', providerKind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', group: 'official' },
  { id: 'claude', label: 'Claude', providerKind: 'anthropic', baseUrl: '', keyUrl: 'https://console.anthropic.com/settings/keys', group: 'official' },
  { id: 'gemini', label: 'Gemini', providerKind: 'openai-compatible', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey', group: 'official' },
  { id: 'openrouter', label: 'OpenRouter', providerKind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', group: 'official' },
  { id: 'siliconflow', label: 'SiliconFlow', providerKind: 'openai-compatible', baseUrl: 'https://api.siliconflow.cn/v1', keyUrl: 'https://cloud.siliconflow.cn/account/ak', group: 'official' },
  { id: 'kimi', label: 'Kimi', providerKind: 'openai-compatible', baseUrl: 'https://api.moonshot.cn/v1', keyUrl: 'https://platform.moonshot.cn/console/api-keys', group: 'official' },
  { id: 'zhipu', label: '智谱 GLM', providerKind: 'openai-compatible', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys', group: 'official' },
  { id: 'deepseek', label: 'DeepSeek', providerKind: 'openai-compatible', baseUrl: 'https://api.deepseek.com/v1', keyUrl: 'https://platform.deepseek.com/api_keys', group: 'official' },
  { id: 'volcengine', label: '火山 / Doubao', providerKind: 'openai-compatible', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', keyUrl: 'https://console.volcengine.com/ark', group: 'official' },
  { id: 'dashscope', label: '阿里百炼', providerKind: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyUrl: 'https://bailian.console.aliyun.com', group: 'official' },
  { id: 'groq', label: 'Groq', providerKind: 'openai-compatible', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', group: 'official' },
]
