// 目录 curated 种子的**身份与分档表**：跨供应商同一逻辑模型的 canonical id，
// 以及「旗舰 / 性价比 / 陪跑 / 退役」四档的显式名单。
//
// 为什么从 `seedBuiltins.ts` 分出来：那个文件做的是**对账**（把 curated 声明 reconcile 进
// 用户目录），而这里是一张**查找表**——两者变更的理由完全不同。表随每次模型雷达增删，
// 对账逻辑几乎不动；混在一个文件里，读对账那 60 行要先翻过 200 行模型名。
// 分档判据本身没变一个字：`curatedCatalogLifecycle` 仍是这三张 Set 的唯一读取者。

/** curated 模型的产品分档。明确的产品决定，**不是**从版本号或名字猜出来的。 */
export type CatalogLifecycle = "flagship" | "value" | "companion" | "legacy";

/**
 * 跨供应商同一逻辑模型的**版本级** canonical 身份（modelKey → canonicalModelId，全局无键冲突）。
 * 消费方：src/config/modelIdentity.deriveCanonicalModelId（priority-1 去重键）——填了它，节点模型
 * 下拉的「同模型多家合并成一条 + N 家」不再赌 labelZh 字符串（label 漂移=不合并、撞名=错合并的根因）。
 * 纪律：
 *  - **版本级**（seedream 4.5 ≠ 5.0 ≠ 4.0），绝不用 archetype 家族级；
 *  - 单家独有的模型（happyhorse/agnes/imagen…）不填——无叠加可治，缺省走 label 归一化回退；
 *  - **值刻意 = normalizeModelLabel(labelZh) 的产物**（小写、空格分隔）：没进表的同名模型
 *    （静态表条目 / 未来新家）走 label 回退会得到同一个键 → 永不把现有合并组拆开；
 *    显式填表的价值只在「对抗 label 改名/漂移」，不在换一套 id 风格。
 */
export const CANONICAL_MODEL_IDS: Record<string, string> = {
  // Seedream 4.5（kie / apimart / 火山 / RunningHub 四家）
  "seedream": "seedream 4.5",
  "doubao-seedream-4.5": "seedream 4.5",
  "doubao-seedream-4-5-251128": "seedream 4.5",
  "seedream-v4.5": "seedream 4.5",
  // Seedance 2.0（kie / apimart / 火山 / RunningHub；即梦 label 为「即梦 Seedance 2.0（会员）」本就独立，不填）
  "bytedance/seedance-2": "seedance 2.0",
  "doubao-seedance-2.0": "seedance 2.0",
  "doubao-seedance-2-0-260128": "seedance 2.0",
  "bytedance/seedance-2.0-global": "seedance 2.0",
  // Nano Banana（kie / apimart / RunningHub；静态 gemini 表同名条目走 label 回退同键）
  "nano-banana": "nano banana",
  "gemini-2.5-flash-image-preview": "nano banana",
  "rhart-image-v1": "nano banana",
  // Nano Banana 2（kie 主款 / apimart；**版本级**故与上面 2.5 代的 "nano banana" 分键，绝不合并）
  // Lite 是独立档次（更快更便宜、参考图上限 10 而非 14）→ 自己一个键，不与主款合并成一条。
  "nano-banana-2": "nano banana 2",
  "gemini-3.1-flash-image-preview": "nano banana 2",
  "nano-banana-2-lite": "nano banana 2 lite",
  // Seedream 5.0（kie 的 pro / lite 两档 + apimart pro + 火山 pro；lite 与 pro 是不同档次故分键）
  "seedream/5-pro-text-to-image": "seedream 5.0 pro",
  "doubao-seedream-5-0-pro": "seedream 5.0 pro",
  "doubao-seedream-5-0-pro-260628": "seedream 5.0 pro",
  "seedream/5-lite-text-to-image": "seedream 5.0 lite",
  // GPT Image 2（kie 拆「· 文生图 / · 图生图」两行 / apimart / RunningHub → 同一 canonical 合并成一条）
  "gpt-image-2-text-to-image": "gpt image 2",
  "gpt-image-2-image-to-image": "gpt image 2",
  "gpt-image-2": "gpt image 2",
  "rhart-image-g-2-official": "gpt image 2",
  // 可灵 3.0（kie / apimart / RunningHub）
  "kling-3.0": "可灵 3.0",
  "kling-v3": "可灵 3.0",
  "kling-v3.0-pro": "可灵 3.0",
  // Qwen-Image 2.0（apimart / RunningHub）
  "qwen-image-2.0": "qwen-image 2.0",
  "rh-qwen-image-2.0": "qwen-image 2.0",
  // Qwen-Image 3.0（apimart 独家；**版本级**故与 2.0 分键）
  "qwen-image-3.0": "qwen-image 3.0",
  // Veo 3.1（apimart / RunningHub）
  "veo3.1-fast": "veo 3.1",
  "rhart-video-v3.1-pro-official": "veo 3.1",
  // Sora 2（apimart / RunningHub）
  "sora-2": "sora 2",
  "rhart-video-s-official": "sora 2",
  // Wan 2.7（apimart / RunningHub）
  "wan2.7": "wan 2.7",
  "rh-wan-2.7": "wan 2.7",
  // Hailuo 2.3（apimart / RunningHub）
  "MiniMax-Hailuo-2.3": "hailuo 2.3",
  "rh-hailuo-2.3": "hailuo 2.3",
  "suno-v5-5": "suno v5.5",
  "suno-v5.5": "suno v5.5",
  "suno-sounds-v5-5": "suno sounds v5.5",
  "suno-sounds-v5.5": "suno sounds v5.5",
};

/**
 * Curated lifecycle is an explicit product decision, never a version/name heuristic.
 * Models omitted from these reviewed sets remain useful companion routes. Keeping the
 * table keyed by exact upstream model id also makes a future radar update auditable.
 */
const FLAGSHIP_MODEL_KEYS = new Set([
  // Current text and multimodal leaders.
  "deepseek-v4-pro",
  "gemini-3.5-flash",
  // Current image leaders.
  "gpt-image-2-text-to-image",
  "gpt-image-2-image-to-image",
  "gpt-image-2",
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
  "suno-v5.5",
  "suno-sounds-v5.5",
  "suno-sounds-v5-5",
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
  "bytedance/seedance-2.5",
  "fal-ai/kling-video/v3/pro",
  "google/gemini-omni-flash/v1.1",
  "minimax/music-3",
  "fal-ai/elevenlabs/sound-effects/v2",
  "hitem3d/hi3d/v3.0",
  // Runway Dev official catalog (video + image families; exact ids are from
  // the 2024-11-06 OpenAPI discriminator, not name heuristics).
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
  "seedream5_lite",
  "gen4_image",
  "gen4_image_turbo",
  "gemini_image3_pro",
  "gemini_image3.1_flash",
  "gpt_image_2",
  "gemini_2.5_flash",
]);

const VALUE_MODEL_KEYS = new Set([
  "deepseek-v4-flash",
  "nano-banana-2-lite",
  "seedream/5-lite-text-to-image",
  "doubao-seedream-5-0-260128",
  "z-image-turbo",
  "Tongyi-MAI/Z-Image-Turbo",
  "Qwen/Qwen3-Next-80B-A3B-Instruct",
  "Qwen/Qwen3-30B-A3B",
  "Qwen/Qwen3-8B",
  "agnes-2.5-flash",
  "agnes-video-2.5-flash",
  "speech-2.8-turbo",
]);

const LEGACY_MODEL_KEYS = new Set([
  "happyhorse",
  "seedream",
  "doubao-seedream-4.5",
  "doubao-seedream-4-5-251128",
  "doubao-seedream-4-0-250828",
  "seedream-v4.5",
  "nano-banana",
  "gemini-2.5-flash-image-preview",
  "rhart-image-v1",
  "bytedance/seedance-2",
  "doubao-seedance-2.0",
  "doubao-seedance-2-0-260128",
  "bytedance/seedance-2.0-global",
  "agnes-2.0-flash",
  "agnes-image-2.0-flash",
  "agnes-video-v2.0",
  "meshy6",
  "deepseek-v3.2",
  "deepseek-v3.1-terminus",
  "qwen-image-2.0",
  "rh-qwen-image-2.0",
  "wan2.7",
  "rh-wan-2.7",
  "Omni-Flash-Ext",
  "nomi-audio",
]);

export function curatedCatalogLifecycle(modelKey: string): CatalogLifecycle {
  if (FLAGSHIP_MODEL_KEYS.has(modelKey)) return "flagship";
  if (VALUE_MODEL_KEYS.has(modelKey)) return "value";
  if (LEGACY_MODEL_KEYS.has(modelKey)) return "legacy";
  return "companion";
}
