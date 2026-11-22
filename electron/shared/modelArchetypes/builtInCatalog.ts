// 内置档案表（全部档、未按供应商 / 型号名 / 档收窄）。**只给 index.ts、本目录内的并集问题、脚本和测试读**：
// 生产代码拿某个模型的档案只走 index.ts 的 resolveModelArchetype（结构测试 archetypeSingleEntry.structure.test.ts 守）。
// Video archetypes are defined in electron/shared/videoCapabilities (canonical home,
// shared with main-process planning). The renderer takes the whole video set from that
// single barrel's registry (sourceBackedVideoProfiles) instead of naming each profile —
// adding a video model touches the electron side only (profile file + registry line);
// this file does not change (二期档案归一：清双登记，35 个 video 档案不再手列第二份).
import { sourceBackedVideoProfiles } from "../videoCapabilities/registry";
import { HUNYUAN3D_ARCHETYPE } from "./hunyuan3d";
import { HITEM3D_ARCHETYPE } from "./hitem3d";
import { MESHY6_ARCHETYPE } from "./meshy6";
import { RUNNINGHUB_IMAGE_ARCHETYPES } from "./runninghubImageArchetypes";
import { GPT_IMAGE_2_ARCHETYPE } from "./gptImage2";
import { GPT_IMAGE_25_FLARE_ARCHETYPE, GPT_IMAGE_25_SUNBURST_ARCHETYPE } from "./gptImage25";
import { GPT_IMAGE_26_FLARE_ARCHETYPE, GPT_IMAGE_26_SUNBURST_ARCHETYPE } from "./gptImage26";
import { NANO_BANANA_21_ARCHETYPE, NANO_BANANA_21_EXT_ARCHETYPE } from "./nanoBanana21";
import { NANO_BANANA_LITE_ARCHETYPE, NANO_BANANA_LITE_EXT_ARCHETYPE } from "./nanoBananaLite";
import { FLUX_3_IMAGE_ARCHETYPE, FLUX_3_IMAGE_KLEIN_ARCHETYPE } from "./flux3";
import { GROK_IMAGINE_IMAGE_20_OFFICIAL_ARCHETYPE } from "./grokImageOfficial";
import { HY_IMAGE_V35_ARCHETYPE } from "./hunyuanImage35";
import { MUSE_IMAGE_EXT_ARCHETYPE } from "./museImage";
import { WAN_27_IMAGE_ARCHETYPE, WAN_27_IMAGE_PRO_ARCHETYPE } from "./wan27Image";
import { SEEDREAM_ARCHETYPE } from "./seedream";
import { NANO_BANANA_ARCHETYPE } from "./nanoBanana";
import { NANO_BANANA_2_ARCHETYPE, NANO_BANANA_2_LITE_ARCHETYPE } from "./nanoBanana2";
import { KIE_SEEDREAM_5_LITE_ARCHETYPE, KIE_SEEDREAM_5_PRO_ARCHETYPE } from "./kieSeedream5";
import { FLUX_2_PRO_ARCHETYPE } from "./flux2Pro";
import { QWEN_IMAGE_ARCHETYPE } from "./qwenImage";
import { QWEN_IMAGE_3_ARCHETYPE } from "./qwenImage3";
import { IMAGEN_4_ARCHETYPE } from "./imagen4";
import { IMAGEN_4_FAST_ARCHETYPE, IMAGEN_4_ULTRA_ARCHETYPE } from "./imagen4Kie";
import { Z_IMAGE_ARCHETYPE } from "./zImage";
import { SEEDREAM_5_PRO_ARCHETYPE } from "./seedream5Pro";
import { SEEDREAM_55_ARCHETYPE } from "./seedream55";
import { AUDIO_ARCHETYPE } from "./audioArchetype";
import { LOCAL_SPEECH_ARCHETYPE } from "./localSpeech";
import { DOUBAO_TTS_ARCHETYPE } from "./doubaoTtsArchetype";
import { SEED_TTS_ARCHETYPE } from "./seedTtsArchetype";
import { MODELSCOPE_IMAGE_ARCHETYPE, MODELSCOPE_IMAGE_EDIT_ARCHETYPE } from "./modelscopeImage";
import { SEEDREAM_VOLCENGINE_ARCHETYPE } from "./seedreamVolcengine";
import { SEEDREAM_VOLCENGINE_5_PRO_ARCHETYPE } from "./seedreamVolcengine5Pro";
import { DREAMINA_IMAGE_ARCHETYPE } from "./dreaminaImage";
import { DREAMINA_UPSCALE_ARCHETYPE } from "./dreaminaUpscale";
import { RECRAFT_CRISP_UPSCALE_ARCHETYPE, TOPAZ_IMAGE_UPSCALE_ARCHETYPE } from "./imageUpscale";
import { AGNES_IMAGE_ARCHETYPE, AGNES_IMAGE_21_ARCHETYPE } from "./agnesImage";
import { HIGGSFIELD_SOUL_2_ARCHETYPE, HIGGSFIELD_SOUL_CINEMA_ARCHETYPE } from "./higgsfieldSoul";
import { ANTIGRAVITY_IMAGE_ARCHETYPE } from "./antigravityImage";
import { CODEX_IMAGEGEN_ARCHETYPE } from "./codexImagegen";
import { SUNO_V55_ARCHETYPE, SUNO_SFX_V55_ARCHETYPE, SUNO_V6_ARCHETYPES } from "./sunoAudio";
import { LYRIA_35_ARCHETYPE } from "./lyria35";
import { MINIMAX_SPEECH_28_ARCHETYPE } from "./minimaxSpeech28";
import { ELEVEN_MULTILINGUAL_V2_ARCHETYPE, ELEVEN_MUSIC_V2_ARCHETYPE, ELEVEN_SCRIBE_V2_ARCHETYPE, ELEVEN_SFX_V2_ARCHETYPE, ELEVEN_V3_ARCHETYPE } from "./elevenAudio";
import { MESHY_7_ARCHETYPE } from "./meshy7";
import { MINIMAX_MUSIC_3_ARCHETYPE } from "./minimaxMusic3";
import { RUNWAY_NATIVE_IMAGE_ARCHETYPES } from "./runwayNativeImage";
import { RUNWAY_SEED_AUDIO_ARCHETYPE } from "./runwaySeedAudio";
import type { ModelArchetype } from "./types";
/**
 * 内置档案注册表。登记处按 kind 分家（一功能一个家）：
 * - video → electron/shared/videoCapabilities/registry.ts 的 SOURCE_BACKED_PROFILES（唯一登记点，
 *   渲染层整块派生，不再手列第二份——接一个 video 模型只碰 electron 侧：档案文件 + registry 一行）；
 * - image / audio / 3D → 本文件下方的非 video 列表登记一条。
 * ⚠️ 顺序还有**第二个后果**：新用户没配默认时，分镜兜底阶梯（availableModels.pickStoryboardDefaultModel）
 * 按候选顺序取第一个匹配 /gpt[\s-]?image/ 的模型。故 GPT Image 2.5 两档**刻意排在 2 之后**——
 * 接一批新档案不该顺带改掉新用户的默认图片模型（那是产品决定，要单独拍板，不该由 import 顺序偷偷决定）。
 * storyboardDefaults.snapshot.test.ts 就是拦这件事的哨兵：它 2026-09-18 当场抓到过一次。
 *
 * 顺序即三趟身份匹配的同趟决胜顺序（见 resolveBaseArchetype）；video 块的顺序就是 registry
 * 声明序——渲染层与 registry 平局判据共用同一份决胜序，同一身份串两侧永远同一个赢家
 * （2026-09-02 修复 "veo3.1" 同串双身份后不再有任何 legacy pin）。跨档案同串的赢家由
 * resolutionOrder.test.ts 锁死，重排/新增若翻转任何赢家该测试即红。
 */
export const MODEL_ARCHETYPES: readonly ModelArchetype[] = [
  ...sourceBackedVideoProfiles(),
  MINIMAX_MUSIC_3_ARCHETYPE, MINIMAX_SPEECH_28_ARCHETYPE, ELEVEN_V3_ARCHETYPE, ELEVEN_MULTILINGUAL_V2_ARCHETYPE, ELEVEN_MUSIC_V2_ARCHETYPE, ELEVEN_SFX_V2_ARCHETYPE, ELEVEN_SCRIBE_V2_ARCHETYPE, MESHY_7_ARCHETYPE, ...RUNWAY_NATIVE_IMAGE_ARCHETYPES, RUNWAY_SEED_AUDIO_ARCHETYPE, GPT_IMAGE_2_ARCHETYPE, SEEDREAM_ARCHETYPE, KIE_SEEDREAM_5_PRO_ARCHETYPE, KIE_SEEDREAM_5_LITE_ARCHETYPE, NANO_BANANA_2_ARCHETYPE, NANO_BANANA_2_LITE_ARCHETYPE, NANO_BANANA_ARCHETYPE, FLUX_2_PRO_ARCHETYPE, QWEN_IMAGE_3_ARCHETYPE, QWEN_IMAGE_ARCHETYPE, IMAGEN_4_ARCHETYPE, Z_IMAGE_ARCHETYPE, SEEDREAM_5_PRO_ARCHETYPE, SEEDREAM_55_ARCHETYPE, AUDIO_ARCHETYPE, SUNO_V55_ARCHETYPE, SUNO_SFX_V55_ARCHETYPE, ...SUNO_V6_ARCHETYPES, LYRIA_35_ARCHETYPE, DOUBAO_TTS_ARCHETYPE, SEED_TTS_ARCHETYPE, MODELSCOPE_IMAGE_ARCHETYPE, MODELSCOPE_IMAGE_EDIT_ARCHETYPE, SEEDREAM_VOLCENGINE_ARCHETYPE, SEEDREAM_VOLCENGINE_5_PRO_ARCHETYPE, DREAMINA_IMAGE_ARCHETYPE, DREAMINA_UPSCALE_ARCHETYPE, TOPAZ_IMAGE_UPSCALE_ARCHETYPE, RECRAFT_CRISP_UPSCALE_ARCHETYPE, CODEX_IMAGEGEN_ARCHETYPE, ANTIGRAVITY_IMAGE_ARCHETYPE, HUNYUAN3D_ARCHETYPE, HITEM3D_ARCHETYPE, MESHY6_ARCHETYPE, ...RUNNINGHUB_IMAGE_ARCHETYPES, AGNES_IMAGE_ARCHETYPE, AGNES_IMAGE_21_ARCHETYPE, LOCAL_SPEECH_ARCHETYPE, HIGGSFIELD_SOUL_2_ARCHETYPE, HIGGSFIELD_SOUL_CINEMA_ARCHETYPE, GPT_IMAGE_25_FLARE_ARCHETYPE, GPT_IMAGE_25_SUNBURST_ARCHETYPE, GPT_IMAGE_26_FLARE_ARCHETYPE, GPT_IMAGE_26_SUNBURST_ARCHETYPE, NANO_BANANA_21_ARCHETYPE, NANO_BANANA_21_EXT_ARCHETYPE, NANO_BANANA_LITE_ARCHETYPE, NANO_BANANA_LITE_EXT_ARCHETYPE, FLUX_3_IMAGE_ARCHETYPE, FLUX_3_IMAGE_KLEIN_ARCHETYPE, GROK_IMAGINE_IMAGE_20_OFFICIAL_ARCHETYPE, HY_IMAGE_V35_ARCHETYPE, MUSE_IMAGE_EXT_ARCHETYPE, WAN_27_IMAGE_ARCHETYPE, WAN_27_IMAGE_PRO_ARCHETYPE, IMAGEN_4_FAST_ARCHETYPE, IMAGEN_4_ULTRA_ARCHETYPE,
];

/** 按 id 取档案。 */
export function getArchetypeById(id: string | null | undefined): ModelArchetype | null {
  if (!id) return null;
  return MODEL_ARCHETYPES.find((a) => a.id === id) || null;
}
