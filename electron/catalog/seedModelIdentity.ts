// 目录 curated 种子的**分档表**：「旗舰 / 性价比 / 陪跑 / 退役」四档的显式名单。
// 跨供应商同一逻辑模型的身份表住中立层 `electron/shared/modelCanonicalIds.ts`（界面层也要读它）。
//
// 为什么从 `seedBuiltins.ts` 分出来：那个文件做的是**对账**（把 curated 声明 reconcile 进
// 用户目录），而这里是一张**查找表**——两者变更的理由完全不同。表随每次模型雷达增删，
// 对账逻辑几乎不动；混在一个文件里，读对账那 60 行要先翻过 200 行模型名。
// 分档判据本身没变一个字：`curatedCatalogLifecycle` 仍是这三张 Set 的唯一读取者。

// 目录内部（`seedBuiltins.ts` 的对账）照旧从这里拿身份表；表本体只有中立层那一份，这里不许再写第二张。
export { CANONICAL_MODEL_IDS } from "../shared/modelCanonicalIds";

/** curated 模型的产品分档。明确的产品决定，**不是**从版本号或名字猜出来的。 */
export type CatalogLifecycle = "flagship" | "value" | "companion" | "legacy";

/**
 * Curated lifecycle is an explicit product decision, never a version/name heuristic.
 * Models omitted from these reviewed sets remain useful companion routes. Keeping the
 * table keyed by exact upstream model id also makes a future radar update auditable.
 */
const FLAGSHIP_MODEL_KEYS = new Set([
  "suno-v6",
  "suno-v6-wild",
  "suno-v6-mini",
  "suno-sounds-v6",
  "suno-sounds-v6-wild",
  "suno-sounds-v6-mini",
  "gpt-6-astra",
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-6-luna",
  "claude-opus-5-5",
  "claude-sonnet-5-5",
  "claude-haiku-5-5",
  "claude-fable-5.1",
  "gemini-4-argon",
  "gemini-3.8-flash",
  "deepseek-v4.1-flash",
  "qwen3.8-max",
  "qwen3.8-flash",
  "qwen3.8-27b",
  "qwen3.8-2.4t-a95b",
  "glm-5.3",
  "glm-5.3-flash",
  "kimi-k3",
  "grok-4.7",
  "minimax-m3",
  "step-3.7-flash",

  // Current text and multimodal leaders.
  "deepseek-v4-pro",
  // Current image leaders.
  "gpt-image-2-text-to-image",
  "gpt-image-2-image-to-image",
  "gpt-image-2",
  "gpt-image-2-5-flare-text-to-image",
  "gpt-image-2-5-sunburst-text-to-image",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
  // 2.6 是这一家最新一代（只有 APIMart 提供）：用户 2026-11-07「最新一代和上一代都给新节点用」，推荐排序不排在上一代后面。
  "gpt-image-2.6-flare",
  "gpt-image-2.6-sunburst",
  // 与已在旗舰名单里的 Runway 行 `gemini_image3_pro` / `grok_imagine_image_2` 是同一个模型的另一条接入线，
  // 不跟着标就会出现「同一款经 Runway 是旗舰、经 APIMart 是陪跑」的自相矛盾分档。
  "gemini-3-pro-image-preview",
  "grok-imagine-2.0-ext",
  "muse-image-ext",
  "nano-banana-2",
  "gemini-3.1-flash-image-preview",
  "seedream/5-pro-text-to-image",
  "doubao-seedream-5-0-pro",
  "doubao-seedream-5-0-pro-260628",
  "flux-2/pro-text-to-image",
  "qwen-image-3.0",
  // Current video leaders.
  "bytedance/seedance-2-5",
  "doubao-seedance-2.5",
  "doubao-seedance-2-5-260628",
  "kling-3.0",
  "kling-3.0-turbo",
  "kling-v3",
  "kling-v3.0-pro",
  "minimax-h3",
  "MiniMax-H3",
  "MiniMax-M3",
  "wan/3-0-video",
  "wan3.0-video",
  "viduq3",
  "grok-imagine-1.5-video-apimart",
  // Current 3D leader already available through the aggregate route.
  "hunyuan3d-v3.1",
  "google/gemini-omni-flash-1-1",
  "flowmusic-lyria-3.5",
  "speech-2.8-hd",
  "eleven_v3",
  "music_v2",
  "eleven_text_to_sound_v2",
  "scribe_v2",
  "meshy-7",
  "fal-ai/nano-banana-2",
  "openai/gpt-image-2",
  "bytedance/seedream/v5/pro",
  "minimax/h3-max",
  "MiniMax-H3-Max",
  "bytedance/seedance-2.5",
  "fal-ai/kling-video/v3/pro",
  "google/gemini-omni-flash/v1.1",
  "minimax/music-3",
  "fal-ai/elevenlabs/sound-effects/v2",
  "hitem3d/hi3d/v3.0",
  // Runway Dev official catalog (video + image families; exact ids are from
  // the 2024-11-06 OpenAPI discriminator, not name heuristics).
  // 分档跟着**模型**走，不跟着渠道走：并进同一个 canonical 身份的 Runway 行与中转站那几行必须同档，
  // 否则「最强线路」规则会让合并后的那一条悄悄换档（Nano Banana 第一代被 Runway 行顶进旗舰区）。
  // 故 gemini_2.5_flash（= Nano Banana）/ happyhorse_1_0 归 LEGACY、seedream5_lite 归 VALUE，与同模型的中转行一致。
  "gen4.5",
  "gen4_turbo",
  "seedance2_5",
  "seedance2",
  "seedance2_fast",
  "seedance2_mini",
  "wan3",
  "grok_imagine_1_5",
  "hailuo3",
  "veo3.1",
  "veo3.1_fast",
  "gemini_omni_flash",
  "muse_image",
  "grok_imagine_image_2",
  "seedream5_pro",
  "gen4_image",
  "gen4_image_turbo",
  "gemini_image3_pro",
  "gemini_image3.1_flash",
  "gpt_image_2",
]);

const VALUE_MODEL_KEYS = new Set([
  "deepseek-v4-flash",
  "nano-banana-2-lite",
  "seedream/5-lite-text-to-image",
  "doubao-seedream-5-0-260128",
  "seedream5_lite",
  "z-image-turbo",
  "Tongyi-MAI/Z-Image-Turbo",
  "Qwen/Qwen3-Next-80B-A3B-Instruct",
  "Qwen/Qwen3-30B-A3B",
  "Qwen/Qwen3-8B",
  "agnes-2.5-flash",
  "agnes-video-2.5-flash",
  "speech-2.8-turbo",
]);

// 分档规则（用户 2026-11-07 拍板：「最新代和旧一代的都可以接」）：每个模型家族的**最新一代**进旗舰 / 性价比，
// **上一代**留在陪跑（或性价比），照常出现在新节点的选择里；只有**比上一代更老**的才进下面这张退役表
// （收进「更多」、排在最后，旧项目里已选的照常显示和执行）。Suno v6 是最新、v5.5 是上一代，
// DeepSeek V4.1 Flash 最新、V4 Flash 上一代，Gemini 3.8 Flash 最新、3.5 Flash 上一代，所以这几个不在表里。
// 契约见 `electron/catalog/apimartLatestContracts.test.ts` 与 `tests/fixtures/apimart/model-generations*.json`。
const LEGACY_MODEL_KEYS = new Set([
  "doubao-seedream-4-0-250828",
  "nano-banana",
  "gemini-2.5-flash-image-preview",
  "rhart-image-v1",
  "gemini_2.5_flash",
  "agnes-2.0-flash",
  "agnes-image-2.0-flash",
  "agnes-video-v2.0",
  "meshy6",
  "nomi-audio",
]);

export function curatedCatalogLifecycle(modelKey: string): CatalogLifecycle {
  if (FLAGSHIP_MODEL_KEYS.has(modelKey)) return "flagship";
  if (VALUE_MODEL_KEYS.has(modelKey)) return "value";
  if (LEGACY_MODEL_KEYS.has(modelKey)) return "legacy";
  return "companion";
}
