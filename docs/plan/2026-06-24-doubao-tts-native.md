# 原生火山豆包 TTS 2.0 配音接入

> 日期 2026-06-24 · 触发：用户「建议开个原生火山，doubao 配音很实用，火山走 openai 兼容不咋的，研究一下」。
> 拍板范围：**只接豆包 TTS 配音**（不接 ASR / 不接原生 Seedance 视频，那两条另起）。凭证：先写代码骨架，`APP_ID`/`ACCESS_KEY`/音色用户后补 → 真机真生成验证标「未真机验」。

## 为什么要做（根因，不是功能堆）

OpenAI 兼容协议（`/v1/audio/speech`）只能传 `voice` + `speed` 两个旋钮。豆包 2.0 的招牌能力——**用自然语言描述情感**（往 `additions.context_texts` 塞「用撒娇甜蜜的语气」，模型真听懂）——在兼容层里**没有字段位置**，被压扁成普通朗读机，2.0 白买。所以「火山走 openai 兼容不咋的」的根因是**协议丢了差异化能力**，必须原生接才能喂 `context_texts` + `resource-id` 路由。

## 现状（已实查 file:line）

- 原生火山 vendor **已存在**（出图用）：`electron/catalog/volcengineVendor.ts`（`ark.cn-beijing.volces.com` + bearer）。**但豆包 TTS 不在这条线上**——它是火山「语音技术」独立产品线，域名 `openspeech.bytedance.com`、鉴权三头、返回 NDJSON，全不一样，蹭不上。
- 音频第四路：`electron/runtime.ts:567` 识别 `wantedKind==='audio'` → `runAudioTask`（`electron/audioTaskRunner.ts:42`），同步收口不进 admit/poll。
- 现有 TTS 引擎 `runTextToSpeech`（`audioTaskRunner.ts:48`）**死写 OpenAI 形状**：`fetch → response.arrayBuffer()`（裸音频字节）。豆包返回 NDJSON+base64，套不进。
- 请求模板系统 `electron/ai/requestPipeline.ts`：每 vendor **只有一个 `{{user_api_key}}`**（单 secret）。豆包要两个 secret（APP_ID + ACCESS_KEY）。
- vendor `authType` 只支持 `bearer`/`x-api-key`/`query` + 单 header（`types.ts:127`），表达不了豆包的三头。
- 接入/对账唯一缝：`electron/catalog/seedBuiltins.ts:283/294/316`（seed vendor / reconcileModels / reconcileMappings）。

## 豆包 TTS 2.0 真实契约（实查，非记忆）

- 端点：`POST https://openspeech.bytedance.com/api/v3/tts/unidirectional`（单向流式；2.0 音色必须 V3，V1 不支持）。
- 头：`X-Api-App-Id` / `X-Api-Access-Key` / `X-Api-Resource-Id`（**非 bearer**）。2.0 官方音色 → `X-Api-Resource-Id: seed-tts-2.0`，不匹配报 `55000000`。
- body：`{ user:{uid}, req_params:{ text, speaker, audio_params:{format,sample_rate}, additions } }`；`additions` 必须是**序列化 JSON 字符串**，承载 `context_texts`（自然语言情感）+ 可选 `model:"seed-tts-2.0-expressive"`（情感增强，实测 +26% 表现力）。
- 响应：**NDJSON**（按 `\n` 分行），逐行 `{code,data}`，`code===0` 时 `data` 是 base64 音频块，`code===20000000` 收尾，其余 code = 错误。`response.json()` 直接炸。
- 真实 2.0 音色（实查确认）：`zh_female_vv_uranus_bigtts`(Vivi·女·默认) / `zh_male_liufei_uranus_bigtts`(刘飞·男) / `zh_male_m191_uranus_bigtts`(云舟·男)。（灿灿实测几乎无变化，不收。）

## 设计决策（关键取舍）

1. **两 secret 怎么存**：复用 Nomi 单 apiKey 字段，存成 `APP_ID:ACCESS_KEY`，runner 内 split。理由：不动 secrets 存储/schema（P1 不加并行存储路径），solo 范围最窄。代价：用户接入时要在一个框里粘 `APP_ID:ACCESS_KEY`——接入卡需明确提示（本切片标 honest gap，连同凭证一起后补）。
2. **NDJSON 分支怎么路由**：在 `HttpOperation` 加可选声明字段 `audioResponse?: "binary" | "ndjson-base64"`，runner 按 op 声明分流，**不 hardcode `vendor.key==="volcengine"`**（P4：声明驱动，未来任何 NDJSON vendor 同样声明即可）。缺省/未声明 = `binary`（现有行为零回归）。
3. **三头 + body 组装**：豆包 body 的 `additions` 是「构造对象再 JSON.stringify 成字符串」+ 用户情感文本要安全转义（裸模板插值会被引号注入破坏 JSON），故 Doubao 分支**在 runner 里手搓请求**（先例：`runTranscribe` 也手搓 multipart，不走 buildProfileHttpRequest）。op 仅承载 path + `audioResponse` 声明 + resource-id。
4. **resource-id 钉死 `seed-tts-2.0`**：本切片只发官方 2.0 音色，无克隆（`S_`→seed-icl-2.0）→ 无需动态路由。克隆音色留后续切片。
5. **新 archetype 而非复用 nomi-audio**：豆包音色集不同、多一个「情感/语气」文本参、无 transcribe 模式（本切片只 TTS）→ 新 `volcengine-doubao-tts` archetype（P4 通用系统填槽，仍走现有通用 NodeParams 渲染，不写专属 UI）。

## 改动清单（文件级）

| 文件 | 改动 |
|---|---|
| `electron/catalog/types.ts` | `HttpOperation` 加可选 `audioResponse?: "binary" \| "ndjson-base64"` |
| `electron/catalog/volcengineAudios.ts`（新） | 豆包 TTS 模型 + mapping（path/headers 占位/resource-id/`audioResponse:"ndjson-base64"`）；3 个 2.0 音色 |
| `electron/audioTaskRunner.ts` | `runTextToSpeech` 按 `op.audioResponse` 分流；新增 `runDoubaoUnidirectionalTts`（split key → 三头 → 组装 body+additions → NDJSON+base64 解码 → 落盘） |
| `src/config/modelArchetypes/doubaoTtsArchetype.ts`（新） | `volcengine-doubao-tts` archetype（speech 模式：音色 select + 情感文本参 + 语速）|
| `src/config/modelArchetypes/index.ts` | 注册新 archetype |
| `electron/catalog/seedBuiltins.ts` | `VOLCENGINE_AUDIO_MODELS` 接进 reconcileModels/reconcileMappings（kind:"audio"）|
| `electron/catalog/volcengine.test.ts` 或新 test | 单测：NDJSON 解码 + body 组装 + key split（mock，不需真凭证）|

## 非目标（明确不做）

- 不接豆包 ASR（语音识别）——whisper 仍走 apimart。
- 不接原生 Seedance 视频（仍 deferred）。
- 不做声音克隆（`S_` / seed-icl-2.0）。
- 不做接入卡的「APP_ID:ACCESS_KEY 双字段」UI 改造——本切片用单字段 + 提示文案，凭证 UX 优化随真凭证一起后补。

## 回滚

全部新增 + 一处类型加可选字段 + 一处 runner 分支（缺省走原路）。回滚 = 删新文件 + 还原 seedBuiltins 那两行 + runner 分支。对现有 apimart 音频零影响（`audioResponse` 缺省=binary）。

## 验收门

- 五门全过（filesize→tokens→lint→typecheck→test→build）。
- 单测覆盖：NDJSON 多行解码（含收尾哨兵 + 错误 code）、`additions` 情感转义、`APP_ID:ACCESS_KEY` split。
- **真机真生成 = 阻塞于用户凭证**：诚实标「未真机验」，拿到 `APP_ID`/`ACCESS_KEY`/音色后补一次真生成 + R13 走查（节点渲染新参 + 出音可播）。
- 可先做的真机：节点 UI 渲染新 archetype 的音色/情感参（不花额度，截图人眼判断）。
