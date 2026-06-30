// 从模型 id 猜「图片/视频/配音/文本」类型（Issue #8 中转拉取式接入用）。
//
// 为什么需要：从中转 `/v1/models` 拉到的只有模型 id 字符串，不带类型。要把它们分门别类
// 落进 catalog（image/video/audio/text），得先判断每个 id 是哪类。判断是**启发式**（按关键词），
// 必然有猜错的——所以 UI 给用户一个下拉随手改（onboarding 不写死、judgement 可纠正）。
//
// 单一真相源：关键词表只在这里。新增模型族（如某新视频模型）在对应表加一行即可。

export type GuessableModelKind = "image" | "video" | "audio" | "text";

// 视频模型族（命中即判 video）。放最前——有些 id 同时含 image 词根但其实是视频（少见，保守起见
// 视频词优先级最高，因为视频更"重"、判错代价大）。
const VIDEO_PATTERNS = [
  "video", "kling", "sora", "veo", "runway", "gen-3", "gen3", "luma", "ray",
  "cogvideo", "hailuo", "minimax-hailuo", "seedance", "wan2", "wanx", "mochi",
  "pika", "vidu", "ltx", "hunyuan-video", "jimeng-video", "i2v", "t2v",
];

// 图片模型族（命中即判 image）。
const IMAGE_PATTERNS = [
  "image", "dall-e", "dalle", "gpt-image", "flux", "midjourney", "mj-", "sd-", "sdxl",
  "stable-diffusion", "stable-image", "seedream", "nano-banana", "qwen-image",
  "imagen", "ideogram", "recraft", "kolors", "playground", "z-image", "hidream",
  "jimeng", "irag", "cogview", "t2i",
];

// 配音/音频模型族（命中即判 audio）。覆盖 TTS / 语音合成 / 语音对话 / 转写 / 音乐生成——
// 这些经中转接进来做配音/音轨的越来越多（豆包 TTS、CosyVoice、gpt-realtime、ElevenLabs…），
// 不再像旧实现那样塞进 text 桶（那样它们会被当文本大脑，判错代价高）。
const AUDIO_PATTERNS = [
  "tts", "text-to-speech", "speech", "voice", "audio", "whisper", "realtime",
  "cosyvoice", "sovits", "gpt-sovits", "fish-speech", "f5-tts", "elevenlabs",
  "vocal", "musicgen", "suno", "udio", "lyria", "mmaudio", "stable-audio",
  "doubao-speech", "seed-tts", "minimax-speech", "qwen-audio", "qwen-tts",
];

function idContains(id: string, patterns: string[]): boolean {
  return patterns.some((p) => id.includes(p));
}

/** 从模型 id 猜类型。默认 text（最安全：文本模型不需要 mapping，判错也只是多一个能聊天的条目）。
 *  判定顺序 video → audio → image → text：视频最重、判错代价最大优先；音频独立词表先于 image/text
 *  命中，避免「speech/voice」类被吞进文本。 */
export function guessModelKind(modelId: string): GuessableModelKind {
  const id = String(modelId || "").toLowerCase().trim();
  if (!id) return "text";
  if (idContains(id, VIDEO_PATTERNS)) return "video";
  if (idContains(id, AUDIO_PATTERNS)) return "audio";
  if (idContains(id, IMAGE_PATTERNS)) return "image";
  return "text";
}
