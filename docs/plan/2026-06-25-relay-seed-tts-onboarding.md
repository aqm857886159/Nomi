# 中转 seed-tts-2.0 配音接入（2026-06-25）

> 起因：同事审昨晚的语音代码 + 给了 SeedTTS-2.0 接入文档。昨晚接的是**火山原生路**
> （openspeech 三头鉴权 + NDJSON，要用户自己的火山 APP_ID:ACCESS_KEY → 用户没有=用不了）。
> 文档指出 `seed-tts-2.0` 可经 **Xcode.hk 中转（= 用户已在用的 code-newcli-com）** 走标准
> **OpenAI 兼容 `/v1/audio/speech`**（Bearer + JSON + 直接回 mp3 二进制），用现有 key 即接即用。
> 用户拍板：**中转为主 + 保留原生**。

## 根因 / 缺口

通用 TTS runner（audioTaskRunner.runTextToSpeech）**早已支持** OpenAI `/v1/audio/speech`（Bearer→读
arrayBuffer→落盘）。缺口全在「**中转加音频模型**」这条接入链路：

1. `newapiTransport.newapiTransportFor(kind)` 只有 `image|video`，**无 audio** → 中转音频模型拿不到 create op。
2. `catalogCommit.draftShapeForKind(kind)` 只有 `text|image|video`，**无 audio** → commit 时无 mappingCreate。
3. `commitManualOpenAiCompatibleModels` 的 `models[].kind` 类型只到 `video`，**无 audio**。
4. 手动加模型向导 `OnboardingWizard` 的 `ModelKind` 只有 `text|image|video`，**UI 选不到「配音」**。
5. 通用 TTS 路 `response_format` 默认写死 `"wav"`（audioTaskRunner:56/77），但 seed-tts-2.0 回 **mp3**
   → 会把 mp3 存成 `.wav`（播放/导出坑）。
6. `seed-tts-2.0` 匹配不到任何档案（火山音色档案 id 是 `doubao-seed-tts-2.0`）→ 加进来音色选项是错的。

## 方案（中性、不写死供应商；P4）

- **新增 `NEWAPI_AUDIO_TTS_OP`**（newapiTransport）：`POST /v1/audio/speech`，Bearer，body
  `{ model, input:{{prompt}}, voice, response_format:"mp3", speed }`，`audioResponse` 缺省=binary。
  `newapiTransportFor("audio")` 返回它 + `text_to_audio` + 通用 speech 参数。
- **catalogCommit**：`draftShapeForKind` 加 audio 分支；`commitManualOpenAiCompatibleModels` 的 kind 联合类型加 `audio`。
- **OnboardingWizard**：`ModelKind` + 选项加「配音」(audio)。
- **新增中转配音档案 `seed-tts`**（OpenAI 兼容传输、**火山音色**、mp3、**无情感字段**——中转协议没有）：
  identifierPatterns `["seed-tts-2.0","seed-tts"]` → 用户在中转加 `seed-tts-2.0` 时 UI 显示火山音色。
  与原生 `volcengine-doubao-tts`（情感、NDJSON、要火山 key）**并存**：两条不同 vendor 能力，非并行版。
- **audioTaskRunner**：`response_format` 默认/扩展名以 op body 为准（op 已给 mp3）；裸 fmt 兜底由 wav 改读 op。

## 不动项
- 原生火山路（volcengineAudios / doubaoTtsArchetype / runDoubaoUnidirectionalTts）保留不删（用户拍板保留）。
- apimart 的 nomi-audio（gpt-4o-mini-tts / whisper）不动。
- 转写（whisper）链路不动。

## 验收门
- 五门绿；新增/改档案过 token/lint。
- 单测：newapiTransportFor("audio") 形状；seed-tts 档案 identifier 命中。
- 真机：在 code-newcli-com 中转加 `seed-tts-2.0`(配音) → 生成节点出火山音色 → 真出 mp3 音频可播放
  （用用户现有 key，额度极小，评测授权）。回退：无 key 时跳过真生成只验 catalog 形状。

## 回滚
- 纯新增分支 + 新档案；出问题 revert 本次 commit，原生路与现有音频不受影响。
</content>
