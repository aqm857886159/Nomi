import type { ModelArchetype } from "./types";

/**
 * **本地转写（离线）—— 模型身份档案。**
 *
 * 它与 `eleven-scribe-v2` / `nomi-audio` 的 transcribe 模式是**同一件事的第三个 provider**
 * （同一个 `transcribe` transportTaskKind、同一个音频槽、同一份结果解析），不是新概念（P1）。
 * 档案层面唯一不同的两条，都直接来自用户 2026-09-17 的硬约束：
 *
 *  ① **没有「语言」这个参数**。云端那两家都给了语言下拉（whisper 的 `language`、Scribe 的
 *     `language_code`），本地这条刻意不给——语言必须从音频检测，给一个能被填错的下拉
 *     就等于留了一条「用户选错语言 → 静默出错稿」的路。检测到的语言写进结果里回报。
 *  ② **也没有「质量档位」下拉**。原本打算给的——权重要用户自己下（几百 MB 起），取舍该摆上台面。
 *     但四个候选档实测下来只有一档过得了「中英都能用」那条线（数字与裁决见
 *     `electron/shared/localSpeech/localSpeechAssets.ts` 文件头），摆一个只有一项的下拉
 *     没有任何行动价值（R2）。第二档什么时候有同样规格的实测，什么时候把这个下拉加回来。
 *
 * 于是这个档案的模式里**一个参数都没有**：语言不该给、档位只有一档。这是减法的结果，不是没做完。
 */

export const LOCAL_SPEECH_ARCHETYPE: ModelArchetype = {
  id: "nomi-local-speech",
  family: "nomi-local-speech",
  label: "本地转写（离线）",
  kind: "audio",
  defaultModeId: "transcribe",
  transportTaskKind: "transcribe",
  identifierPatterns: ["whisper-cpp-local", "nomi-local-speech"],
  sources: [
    {
      url: "https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/README.md",
      checkedAt: "2026-09-17",
      vendorKey: "local-speech",
      covers:
        "whisper-server POST /inference multipart: file + language(auto) + response_format(verbose_json) + temperature; 回 {text, segments[{start,end,text}], detected_language, detected_language_probability}。2026-09-17 以 0.0.10 二进制对真素材实跑验证过该请求与响应形状。",
    },
  ],
  modes: [
    {
      id: "transcribe",
      intent: "single",
      vendorTerm: "本地转写",
      hint: "在这台电脑上离线转写，不联网、不花钱；语言自动识别",
      promptRequired: false,
      slots: [{ kind: "audio_ref", label: "音频", min: 1, max: 1 }],
      params: [],
    },
  ],
};
