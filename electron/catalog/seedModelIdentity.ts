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
 *  - 中转站单家独有的模型（agnes/imagen…）不填——无叠加可治，缺省走 label 归一化回退（渠道行例外，见下）；
 *  - **值刻意 = normalizeModelLabel(labelZh) 的产物**（小写、空格分隔）：没进表的同名模型
 *    （静态表条目 / 未来新家）走 label 回退会得到同一个键 → 永不把现有合并组拆开；
 *    显式填表的价值只在「对抗 label 改名/漂移」，不在换一套 id 风格。
 *  - **渠道行必须填**（2026-09-28 用户拍板「合并」）：fal 的 labelZh 带「· fal」、Runway 的带「Runway 」前缀，
 *    走 label 回退会把**渠道名**算进身份——同一个模型在下拉里按渠道列两三次（Seedance 2.5 / · fal / Runway …）。
 *    所以 fal / Runway 转售的**别家模型**一律在这里写模型本身的身份（单家独有的也写：以后别家接同一模型能自动并上）；
 *    Runway 自家出品的（Gen-4.5 / Gen-4 Turbo / Gen-4 Image / Gen-4 Image Turbo）「Runway」就是模型名的一部分，不填。
 *    一个组只要含渠道行，组里**每一行**都显式填（labelZh 是用户可改的，靠 label 回退的那一行一改名就会从组里掉出去）。
 *  - **暂不合并**（对照 modelIdentity.channelMerge.test.ts 的待定名单，改这里之前先看那里写的理由）：
 *    ① Runway 把变体拆成多行的（seedance2 / _fast / _mini、veo3.1 / _fast）——选择器按供应商折叠，
 *       并进来后同一家只剩一行可选，用户选的变体与真正发出去的 modelKey 会对不上；
 *    ② fal 的 GPT Image 2、Kling V3 Pro（2026-09-29 协调会话裁决 B：不并，各留一行）：并进来会让部分用户的默认渠道换家
 *       （同档里「fal.ai」字母序排在 RunningHub 前）。要保住默认家就得在 vendorTier 里给 fal / Runway 单开第 3 档，
 *       而那把尺同时排着 Agent 读的模型清单（laneModelRead 的 list_models 原样交给模型）——Agent 在没人看见的情况下
 *       换家花钱，比下拉里多两行糟得多。
 *    ③ 出品方查不清的（Runway 的 seed_audio）。
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
  // Runway 的 `gemini_2.5_flash` = Gemini 2.5 Flash Image = Nano Banana（第一代）：nano-banana 档案
  // 的 identifierPatterns 早已收它，这里补上身份，下拉不再多出一条「Runway Gemini 2.5 Flash Image」。
  "gemini_2.5_flash": "nano banana",
  // Nano Banana 2（kie 主款 / apimart / fal / Runway；**版本级**故与上面 2.5 代的 "nano banana" 分键，绝不合并）
  // Lite 是独立档次（更快更便宜、参考图上限 10 而非 14）→ 自己一个键，不与主款合并成一条。
  "nano-banana-2": "nano banana 2",
  "gemini-3.1-flash-image-preview": "nano banana 2",
  "fal-ai/nano-banana-2": "nano banana 2",
  // Runway 的 `gemini_image3.1_flash` = Gemini 3.1 Flash Image = Nano Banana 2（同一模型两个名字；
  // apimart 文档把 gemini-3.1-flash-image-preview 的别名写作 nano-banana-2，见 nanoBanana2.ts sources）。
  "gemini_image3.1_flash": "nano banana 2",
  "nano-banana-2-lite": "nano banana 2 lite",
  // Seedream 5.0（kie 的 pro / lite 两档 + apimart pro + 火山 pro / lite + fal pro + Runway pro / lite；
  // lite 与 pro 是不同档次故分键）
  "seedream/5-pro-text-to-image": "seedream 5.0 pro",
  "doubao-seedream-5-0-pro": "seedream 5.0 pro",
  "doubao-seedream-5-0-pro-260628": "seedream 5.0 pro",
  "bytedance/seedream/v5/pro": "seedream 5.0 pro",
  "seedream5_pro": "seedream 5.0 pro",
  "seedream/5-lite-text-to-image": "seedream 5.0 lite",
  "doubao-seedream-5-0-260128": "seedream 5.0 lite",
  "seedream5_lite": "seedream 5.0 lite",
  // GPT Image 2（kie 拆「· 文生图 / · 图生图」两行 / apimart / RunningHub / Runway → 同一 canonical 合并成一条）
  // fal 的 `openai/gpt-image-2` 暂不并：见文件头「暂不合并 ②」。
  "gpt-image-2-text-to-image": "gpt image 2",
  "gpt-image-2-image-to-image": "gpt image 2",
  "gpt-image-2": "gpt image 2",
  "rhart-image-g-2-official": "gpt image 2",
  "gpt_image_2": "gpt image 2",
  // GPT Image 2.5（kie 把「档次 × 模式」拆成 4 个 id / apimart 每档次一个 id）——**档次级**分键：
  // Flare 与 Sunburst 是并列产品（快 vs 精修）不是同一款的快慢档，合并成一条会让用户选不到精修那款。
  "gpt-image-2-5-flare-text-to-image": "gpt image 2.5 flare",
  "gpt-image-2-5-flare-image-to-image": "gpt image 2.5 flare",
  "gpt-image-2.5-flare": "gpt image 2.5 flare",
  "gpt-image-2-5-sunburst-text-to-image": "gpt image 2.5 sunburst",
  "gpt-image-2-5-sunburst-image-to-image": "gpt image 2.5 sunburst",
  "gpt-image-2.5-sunburst": "gpt image 2.5 sunburst",
  // Gemini Image 3 Pro（Runway / apimart 两家同一模型 → 模型框合并成一条 + 2 家）
  "gemini_image3_pro": "gemini image 3 pro",
  "gemini-3-pro-image-preview": "gemini image 3 pro",
  // Grok Imagine Image 2（Runway / apimart；apimart 侧只有文生图，合并不受影响——合并的是模型不是模式）
  "grok_imagine_image_2": "grok imagine image 2",
  "grok-imagine-2.0-ext": "grok imagine image 2",
  // 可灵 3.0（kie / apimart / RunningHub）。fal 的 `fal-ai/kling-video/v3/pro` 不并：见文件头「暂不合并 ②」。
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
  // Wan 2.7（apimart / RunningHub）
  "wan2.7": "wan 2.7",
  "rh-wan-2.7": "wan 2.7",
  // Hailuo 2.3（apimart / RunningHub）
  "MiniMax-Hailuo-2.3": "hailuo 2.3",
  "rh-hailuo-2.3": "hailuo 2.3",
  // Seedance 2.5（kie / apimart / 火山 / fal / Runway）
  "bytedance/seedance-2-5": "seedance 2.5",
  "doubao-seedance-2.5": "seedance 2.5",
  "doubao-seedance-2-5-260628": "seedance 2.5",
  "bytedance/seedance-2.5": "seedance 2.5",
  "seedance2_5": "seedance 2.5",
  // MiniMax H3（kie / apimart / MiniMax 官方 / Runway）。Runway 叫它 `hailuo3`：minimax-h3 档案注明
  // 「MiniMax H3（Hailuo 03）」并收了这个判别串。apimart 与 MiniMax 官方的 modelKey 同为 `MiniMax-H3`。
  "minimax-h3": "minimax h3",
  "MiniMax-H3": "minimax h3",
  "hailuo3": "minimax h3",
  // H3-Max 是另一个档次（独立档案 minimax-h3-max），目前只有 fal 一家；写模型身份而不是「· fal」。
  "minimax/h3-max": "minimax h3-max",
  // Wan 3.0（kie / apimart / Runway `wan3`，同一个 wan-3.0 档案）
  "wan/3-0-video": "wan 3.0",
  "wan3.0-video": "wan 3.0",
  "wan3": "wan 3.0",
  // Grok Imagine 1.5 视频（apimart / Runway，同一个 grok-imagine-1.5-video 档案）
  "grok-imagine-1.5-video-apimart": "grok imagine 1.5",
  "grok_imagine_1_5": "grok imagine 1.5",
  // Gemini Omni 1.1 Flash（kie / fal / Runway `gemini_omni_flash`，同一个 gemini-omni-1.1 档案）
  "google/gemini-omni-flash-1-1": "gemini omni 1.1 flash",
  "google/gemini-omni-flash/v1.1": "gemini omni 1.1 flash",
  "gemini_omni_flash": "gemini omni 1.1 flash",
  // HappyHorse 1.0（kie / Runway，同一个 happyhorse 档案；apimart 的 HappyHorse 1.1 是另一版本，不并）
  "happyhorse": "happyhorse 1.0",
  "happyhorse_1_0": "happyhorse 1.0",
  // 音频：ElevenLabs 官方与 Runway 转售用**同一个** modelKey（eleven_v3 / eleven_text_to_sound_v2），fal 另有一条。
  "eleven_v3": "eleven v3",
  "eleven_text_to_sound_v2": "eleven sound effects v2",
  "fal-ai/elevenlabs/sound-effects/v2": "eleven sound effects v2",
  "eleven_multilingual_v2": "eleven multilingual v2",
  "minimax/music-3": "minimax music 3",
  // 3D：fal 的 Hi3D v3.0（RunningHub 的 HiTem3D v21 是另一版本，不并）。
  "hitem3d/hi3d/v3.0": "hi3d v3.0",
  // Muse Image 是 Meta 的模型（Meta Superintelligence Labs，2026-07-07 发布，出处见 runwayNativeImage.ts），
  // Runway 只是转售渠道 → 写模型本身的身份，不写「runway muse image」。
  "muse_image": "muse image",
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
  "gpt-image-2-5-flare-text-to-image",
  "gpt-image-2-5-sunburst-text-to-image",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
  // 与已在旗舰名单里的 Runway 行 `gemini_image3_pro` / `grok_imagine_image_2` 是同一个模型的另一条接入线，
  // 不跟着标就会出现「同一款经 Runway 是旗舰、经 APIMart 是陪跑」的自相矛盾分档。
  "gemini-3-pro-image-preview",
  "grok-imagine-2.0-ext",
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

const LEGACY_MODEL_KEYS = new Set([
  "happyhorse",
  "happyhorse_1_0",
  "seedream",
  "doubao-seedream-4.5",
  "doubao-seedream-4-5-251128",
  "doubao-seedream-4-0-250828",
  "seedream-v4.5",
  "nano-banana",
  "gemini-2.5-flash-image-preview",
  "rhart-image-v1",
  "gemini_2.5_flash",
  "bytedance/seedance-2",
  "doubao-seedance-2.0",
  "doubao-seedance-2-0-260128",
  "bytedance/seedance-2.0-global",
  "agnes-2.0-flash",
  "agnes-image-2.0-flash",
  "agnes-video-v2.0",
  "meshy6",
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
