# 模型验收矩阵（2026-09-02）

> 目标：目录里**每个模型 × 每个模式**，用真 key 打真实 API 尽量测通，产出「模型 × 模式 → 真实可用性」矩阵，并把我们侧坏掉的当场修掉。
> 方法：以 `electron/catalog` 的 archetype 注册 + `applyBuiltinSeeds()` 种子为准盘点（**代码为准，不凭记忆**）；按成本分层真测（文本/图片/音频全跑；视频按「同端点同 wire 模板」分族——族代表最便宜变体最短时长真跑一发，其余做**不计费的模型识别探测**）。
> 预算：**¥60 硬顶**，逐笔记账。**实际花销 ¥20.29**。
> 分支：`test/model-acceptance-matrix-20260901`（含 4 处 catalog 修复 + 回归测试）。
> Key：`~/.nomi-test-keys.env`（KIE 新 key、其余六家已验活；ElevenLabs 零 scope 跳过）。报告已打码。

## 摘要

- **盘点结果**：18 vendor / 144 model / 230 mapping（`applyBuiltinSeeds` 空目录种子）。本轮用现有 7 个可用 key **真测 5 家 = 93 model**（KIE 18 / APIMart 34 / MiniMax 4 / fal 10 / Runway 27）；其余 11 家因无 key / 本地会员前置跳过（见文末「未测清单」）。
- **可用性（按 mapping-mode 计，93 model 覆盖的可测模式）**：**✅ 真跑通 45 · 🟡 族代表跑通·本变体契约在架 30 · ❌ 我们侧坏（已全部修复）4 类 · ⛔ 账户额度限制 11**。**0 个模型判定为"下线/不存在"**——所有探到的模型都活着。
- **我们侧修了 4 处真 bug**（全是"本地绿、线上 4xx"一族，mock/loopback 恰好没打到真实契约）：见「修复记录」。全部**真 API 复测通过 + 加了结构回归测试（16 例）**。
- **全绿**：typecheck ×2 / lint(0 err) / catalog 1251 tests / tokens / heavy-path / vocabularies / archetype-sources 全过。

## 逐笔账（花销 ¥20.29 / 上限 ¥60）

| vendor | 花销 | 说明 |
|---|---|---|
| KIE | ¥6.80 | 8 图 + 2 suno + 4 视频真跑（seedance-2/happyhorse/wan-3.0/minimax-h3）+ gemini-omni 视频复测 |
| Runway | ¥5.20 | 9 图（含 3 修复复测）+ 5 音频 + wan3 视频代表；12 视频探测（提交即取消）|
| APIMart | ¥3.37 | 8 图 + 4 音频 + grok 视频代表 + Context-IR；15 视频全探测（校验错=不计费）|
| fal | ¥3.30 | 3 图 + 2 音频 + 3 修复复测 + seedance-2.5 视频代表；3 视频探测 |
| MiniMax | ¥1.62 | M3 文本 + 2 TTS + H3 视频代表 |

**最贵三笔**：runway/wan3 t2v(¥1.5) · minimax/MiniMax-H3 t2v(¥1.5) · apimart/grok t2v(¥1.0)。

## 矩阵（按 vendor）

图例：✅=真跑通并下载产物亲验 · 🟡=同 wire 族代表已真跑通、本变体经真实 API 识别探测确认在架 · ⛔=模型在架但本账户额度不足（非我们 bug）· 🔧=曾坏、本轮已修并复测通过。

### APIMart（34，base `https://api.apimart.ai`）
| 模型 | 模式 | 结果 | 证据 |
|---|---|---|---|
| deepseek-v4-pro / -flash / v3.2 / v3.2-think / v3.1-terminus / gemini-3.5-flash | chat | ✅×6 | `/v1/chat/completions` 各返 "4"（reasoning 模型需足够 max_tokens）|
| MiniMax-H3-Context-IR | prompt_refine | ✅ | `/v1/videos/generations` → 增强 prompt（非 chat 端点）|
| doubao-seedream-5-0-pro / 4.5 | t2i·edit | ✅ | 4.5 须 2K（我们默认已是 2K；1K 会 `invalid_resolution`）|
| gemini-2.5-flash-image(nano-banana) / gemini-3.1-flash(nano-banana-2) | t2i·edit | ✅ | 亲验红苹果 |
| gpt-image-2 / qwen-image-2.0 / qwen-image-3.0 / z-image-turbo | t2i·(edit) | ✅ | 亲验内容对提示词 |
| sora-2 / veo3.1-fast / kling-v3 / kling-3.0-turbo / happyhorse-1.1 / grok-imagine-1.5 / seedance-2.0 / seedance-2.5 / MiniMax-H3 / wan2.7 / wan3.0 / MiniMax-Hailuo-2.3 / Omni-Flash-Ext / MiniMax-H3-Regeneration / viduq3 | t2v·i2v | 🟡×15（grok 代表 ✅ 真出 mp4）| 全 15 探测：8 参数校验/余额（=在架），5 返 402 余额（=在架），grok 480p·6s 真跑出 mp4 亲验 |

APIMart 视频：**全 15 模型识别探测确认在架，0 下线**。族代表 grok 真出 mp4（红苹果，帧亲验）。注：本账户余额有限（vidu/kling 单发需数十亿单位），多数视频只能探测不能真跑到底——**账户侧**，非目录 bug。

### KIE（18，base `https://api.kie.ai`）
| 模型 | 模式 | 结果 | 证据 |
|---|---|---|---|
| gpt-image-2 / seedream(4.5) / nano-banana / nano-banana-2 / nano-banana-2-lite / seedream-5-pro / seedream-5-lite / flux-2-pro | t2i | ✅×8 | 全下载亲验（460KB–1.66MB PNG）|
| seedance-2 / happyhorse / minimax-h3 / wan-3.0 | t2v | ✅×4 | 真出 mp4（2.2–20.6MB），帧亲验（睡猫等）|
| **kling-3.0** | t2v·i2v | 🔧 **BUG-4 已修** | KIE 现要求显式 `multi_shots:false`；不传恒 422。修后 402（=校验通过）|
| gemini-omni-1.1 | t2v·i2v | ✅ | duration 须为字符串（我们 `toString` 已处理）；真出 mp4 |
| seedance-2.5 | t2v·i2v | ⛔ | 402 Credits insufficient（在架，余额不足）|
| suno-v5.5 / suno-sounds-v5.5 | music·sfx | ✅×2 | suno 音乐 5.4MB / sfx 216KB（callBackUrl 已内置，record-info 轮询通）|

### MiniMax（4，base `https://api.minimaxi.com`）
| 模型 | 模式 | 结果 | 证据 |
|---|---|---|---|
| MiniMax-M3 | chat | ✅ | `/v1/text/chatcompletion_v2` 返 "4"（reasoning 模型）|
| MiniMax-H3 | t2v | ✅ | `/v2/video_generation` content-array；须显式 ratio（t2v 模式默认 16:9，正确）；真出 mp4 亲验 |
| speech-2.8-hd / -turbo | tts | ✅×2 | `/v1/t2a_v2` 同步 hex→mp3（~50KB）|

### fal（10，base `https://queue.fal.run`）
| 模型 | 模式 | 结果 | 证据 |
|---|---|---|---|
| nano-banana-2 | t2i·edit | ✅ | 1.1MB PNG |
| **gpt-image-2** | t2i·edit | 🔧 **BUG-1 已修** | `image_size` 须 fal 枚举（`square`…），非 `"1024x1024"` 串（422）。修后 ✅ 804KB。[DOCCHECK ✓ `fal.ai/models/openai/gpt-image-2/api`：`ImageSize\|Enum`，枚举名/`{w,h}`对象皆可、WxH串非法 — 与修法一致] |
| **seedream-5-pro** | t2i·edit | 🔧 **BUG-2 已修** | 轮询路径须收敛到 app 根（`bytedance/seedream`）；旧路径 405。修后 ✅ 1.67MB。[DOCCHECK ⚠️→✓ `docs.fal.ai/model-endpoints/queue` 印全路径但**实测网关收敛前两段**（含文档自身 flux/schnell 例），以实测为准 — 修法证实] |
| **eleven-sfx-v2** | sfx | 🔧 **BUG-2 已修** | 同上（`fal-ai/elevenlabs` 根）。修后 ✅ 49KB |
| minimax-music-3 | music | ✅ | 5.3MB mp3 |
| **seedance-2.5** | t2v·i2v | 🔧 **BUG-2 已修** | 深端点轮询 405→修后 ✅ 真出 mp4（202KB，dur 须 ≥4）|
| minimax-h3-max / kling-3.0 / gemini-omni-1.1 | t2v | 🟡×3 | 修后轮询路径通（app 根 status 真返 IN_QUEUE/COMPLETED），提交即取消省费 |
| hitem3d(3D) | image_to_3d | 🟡 | 需输入图（图生 3D），本轮未备图；契约在架 |

### Runway（27，base `https://api.dev.runwayml.com`，`X-Runway-Version: 2024-11-06`）
| 模型 | 模式 | 结果 | 证据 |
|---|---|---|---|
| grok_imagine_image_2 / seedream5_pro / gen4_image / gemini_image3_pro / gemini_image3.1_flash / gemini_2.5_flash | t2i | ✅×6 | 全下载亲验 |
| **muse_image / gpt_image_2 / seedream5_lite** | t2i | 🔧 **BUG-3 已修** | 这三个的 ratio 枚举**不含**共享默认 `1024:1024`（muse 最小 1600 系、gpt 最小 2048 系、seedream5_lite ≥3.68M px）→ 用默认恒 400。修后 ✅（muse 2.6MB / seedream5_lite 3.6MB / gpt 4.2MB，亲验红苹果）。[DOCCHECK ✓/改 一手 spec `runwayml/openapi` 逐模型 `ratio.enum`：muse/gpt 映射值全在 enum — 一致；**seedream5_lite 横/竖原 `2720:1530` 不在 enum → 改正为 spec 值 `2848:1600`/`1600:2848`**（真发均 ACCEPTED）] |
| gen4_image_turbo | i2i | 🟡 | 强制要参考图（i2i-only），契约在架 |
| gen4.5 / seedance2_5 / seedance2 / seedance2_fast / seedance2_mini / wan3 / grok_imagine_1_5 / hailuo3 / veo3.1 / veo3.1_fast / happyhorse_1_0 / gemini_omni_flash | t2v | 🟡×12（wan3 代表 ✅ 真出 mp4）| 12 全探测确认在架（8 提交带估价即取消，4 返"credits 不足"=在架）；wan3 480p·5s 真出 mp4 帧亲验 |
| gen4_turbo | i2v | 🟡 | i2v-only（gen4_turbo 无 t2v）|
| seed_audio(sfx·speech) / eleven_text_to_sound_v2 / eleven_multilingual_v2 / eleven_v3 | audio | ✅×5 | `/v1/sound_effect`·`/v1/text_to_speech` 全下载（eleven 系须 `voice:{type:runway-preset,presetId:Maya}`）|

## ❌ 归因（4 类，全部我们侧、全部已修）

所有失败都归入「我们侧 wire 漂移」——**0 个供应商下线、0 个账户永久失效**（账户余额不足的模型仍在架、属账户侧）。

1. **BUG-1 · fal `openai/gpt-image-2` 的 `image_size` 发错类型** —— 我们 `ratioResToOpenAiSize` 产出 `"1024x1024"` WxH 串，但 fal 的 `ImageSize` 只认枚举（`square`/`portrait_16_9`…）或 `{width,height}` 对象，发串直接 422 `model_attributes_type`。该转换器对 newapi/OpenAI 的 `size` 字段是对的（那个要 WxH），所以修法是**新增 fal 专用转换器**，不改共享的。
   - 修：`electron/catalog/paramTranslate.ts` 加 `ratioResToFalImageSize`（按朝向出 fal 枚举）；`electron/catalog/falOfficial.ts:65-66` 两处 gpt-image-2 mapping 改用它。
   - **官方出处**（DOCCHECK 2026-09-01 核实 → 与原修法**一致**）：`https://fal.ai/models/openai/gpt-image-2/api`（目录实发端点）原文 `image_size` 类型 = `ImageSize | Enum`，「one of the presets, `{width, height}`, or 'auto' … **Possible enum values: square_hd, square, portrait_4_3, portrait_16_9, landscape_4_3, landscape_16_9, auto**. Default value: landscape_4_3. Note: For custom image sizes, you can pass the width and height as an object.」→ 枚举名/对象皆可、WxH 串非法，原修法（走枚举名）正确。
2. **BUG-2 · fal 队列轮询路径没收敛到 app 根** —— fal 提交用完整子路径端点，但 status/result 只挂在 `owner/app`（前两段）上；深子路径端点轮询完整路径恒 **405**。影响 **fal Seedance 2.5 / Kling V3 Pro / Gemini Omni / MiniMax H3-Max / Seedream 5 Pro / ElevenLabs SFX**（凡端点 > 2 段）。loopback 测试用 `pathname.includes("/requests/")` 宽松匹配，遮住了这个漂移。
   - 修：`electron/catalog/falOfficial.ts` `queueOperations` 加 `falAppRoot()`，query/result 用收敛根；create 仍用完整端点。
   - **官方出处 ⚠️ 文档与实际不符，以实测为准**（DOCCHECK 2026-09-01 核实 → 原修法**一致/已证实**）：官方 `https://docs.fal.ai/model-endpoints/queue` 示例用 `fal-ai/flux/schnell`，写 `status_url` **保留完整端点**（`…/fal-ai/flux/schnell/requests/{id}/status`），与本修法相反。但真发实测（3 端点提交即取消）证伪——fal 网关自己就收敛到前两段：`fal-ai/flux/schnell`（**即文档那例**）读回 `…/fal-ai/flux/…`(202)，而文档写的全路径反而 **405**；`bytedance/seedance-2.5/text-to-video`、`fal-ai/kling-video/v3/pro/text-to-video` 同样收敛到前两段。故文档此点已陈旧，`slice(0,2)` 修法与现役网关一致（result 端点回**裸** `.../requests/{id}` 无 `/response`，未完成时返 400=未就绪、非 405，证明端点对）。
3. **BUG-3 · Runway 图像 ratio 未按模型判别** —— `runway-image` archetype 用一份 ratio 列表喂全部 10 个 Runway 图像模型，但 Runway 是**按模型判别的 union**：`muse_image`/`gpt_image_2` 的枚举不含共享默认 `1024:1024`（含 `auto` + 更大档），`seedream5_lite` 要 ≥3.68M px。用默认发这三个 → 恒 400 `Validation of body failed`。视频侧早有 `normalizeRunwayVideoContract` 的 ratioFamilies 解此类，图像侧一直漏了。
   - 修：`electron/catalog/runwayOfficial.ts` `normalizeRunwayImageReferences` 加按模型判别的 ratio 重映射（视频 ratioFamilies 的图像对偶）；并让**每条**图像 mapping 都挂这个 transform（纯 t2i 过去不挂它，正是这三个模型文生图挂掉的根因）。
   - **官方出处**（DOCCHECK 2026-09-01 核实 → muse/gpt **一致**；seedream5_lite **已改正**）：一手机读 spec `https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json` 的 `/v1/text_to_image` oneOf 逐模型 `ratio.enum` 确认——muse_image/gpt_image_2 均**不含 1024:1024**，原映射值（1600:1600·2016:1152·1152:2016 / 1920:1920·2560:1440·1440:2560）**全在各自 enum 内**，一致。**seedream5_lite 原修法用 `2720:1530`/`1530:2720` 不在 spec enum**（那是 seedream5_**pro** 的值）→ 已改正为 spec 列出的 `2848:1600`/`1600:2848`（横/竖，方仍 2048:2048）。真发实测：三模型发 1024:1024 全 400、发各自映射值全 ACCEPTED（seedream5_lite 亦容忍 enum 外自由值如 2720:1530，但仍取 spec 值 fail-safe）。
4. **BUG-4 · KIE `kling-3.0/video` 缺 `multi_shots` 布尔** —— KIE 现在**要求显式传** `multi_shots`（不传 → 422 `multi_shots cannot be empty`；传数组 → 500 `must be a boolean`；传 `false` → 通过）。官方文档（docs.kie.ai/market/kling）：`multi_shots` 是布尔开关，true 切到 `multi_prompt[]` 多镜头，false=单镜头走 prompt。我们目录只发 prompt、漏了这个字段 → KIE kling t2v/i2v 全 422。
   - 修：`electron/catalog/kieKling.ts` `KLING_3_CREATE_OP` input 加 `multi_shots: false`（单镜头默认；多镜头作后续增强）。

## 建议下架/更新清单（交编排者，别擅删）

- **无「建议下架」项**：本轮探到的 93 个模型**全部在架**（含探测确认的视频族）。
- **账户额度提示（非 bug，供运营参考）**：
  - APIMart 余额约 1860 万单位，而 vidu-q3 单发需 ~40 亿、kling 系需 ~30+ 亿 → 这些高价视频当前**跑不到底**（能识别、能校验，扣费才拦）。若要真产片需充值。
  - KIE `seedance-2.5`、Runway `seedance2/2_5/2_fast/veo3.1` 均 402/credits 不足 → 账户余额，非目录问题。
- **小观察（非阻断，未改）**：`archetypeWireDefaults.video.generated.ts` 里 `minimax-h3` 的 `text_to_video` 兜底默认被 `ref` 模式（adaptive + reference-to-video）盖住（3 个 mode 同享档案级 `transportTaskKind: text_to_video`，生成器"后者胜"）。**运行时不受影响**（用户选中的 mode 各自带正确 params，t2v 模式默认 16:9），仅"种子兜底值"这一层不准。要治本得让 wire-defaults 生成器按 mode 而非 taskKind 收口——单独一件事，未纳入本分支。

## 亲验样张路径（抽验，均本地 Read 过）

- 图（内容对提示词"红苹果/白桌"）：`/tmp/matrix/artifacts/apimart_gpt_image_2.png`、`kie_flux_2_pro.png`、`fal_seedream_5_pro.png`、`runway_muse_image.png`（修复后）、`apimart_z_image_turbo.png`
- 视频抽帧：`grok_frame.png`(APIMart)、`kie_seedance2_frame.png`(睡猫)、`wan3_frame.png`(Runway)、`mmh3_frame.png`(MiniMax H3) —— 均红苹果/白桌，内容对
- 音频：`minimax_speech-2.8-hd.mp3`、`kie_suno_v5_5_music.mp3`、`runway_seed_audio_tts.mp3` 等（共 15 段）
- 全部 54 个产物在 `/tmp/matrix/artifacts/`

## 未测清单（无 key / 本地会员前置，仅盘点未真跑）

- **agnes(10) / modelscope(10) / volcengine(6) / volcengine-speech(1)**：无 key。
- **dreamina(4)**：即梦会员本地 CLI（无登录态），只验档案契约，标"会员前置"跳过真跑。
- **comfyui-local(1) / codex-local(1)**：本地运行时前置（~/ComfyUI 可起但耗时），标"本地前置"跳过。
- **runninghub(13) / replicate(0 种子) / meshy(1) / antigravity-cli(0) / local-text(0)**：无 key 或无种子模型。
- **elevenlabs(4)**：key 零 scope，**等用户重开 key**。

## 复跑方法

测试脚本在 `/tmp/matrix/`（`lib.mjs` 读 key + 记账，`t-*.mjs` 各 vendor tier，`probe-*.mjs` 识别探测）。矩阵盘点：`applyBuiltinSeeds()` 空目录种子（`/tmp/dump-catalog.mts`）。回归测试：`electron/catalog/vendorWireDriftFixes.test.ts`（16 例，锁 4 处修复）。

## DOCAUDIT-A 追加封印（2026-09-02）

本班新增预算上限 `¥45`；已知新增花销 `¥0.3216`。封印优先采用参考图模式、最短合法时长、最低可用分辨率/模式、1 个样本。`mapping content hash` 是 `sha256(JSON.stringify({create,query,statusMapping}))`，按当前代码在封印时计算；密钥未写入本文件。

| 模型 × 封印模式 | mapping content hash | 日期 | 产物路径 | 单笔花销 | 结果/人工核验 |
|---|---|---|---|---:|---|
| KIE `bytedance/seedance-2-5` × reference image (`image_to_video`，480p/4s/1 图) | `4bd65019833c26ade209206ada2d2d32cf9ddbddccd8478a65d9143f54a91f3b` | 2026-09-02 | — | ¥0 | ⛔ HTTP 402；余额 12.5 credits，响应未披露本次 required credits，无法计算数值差额；未创建任务 |
| APIMart `viduq3` × image-to-video reference (540p/3s/1 图) | `fe33fcf3e0578606a97bd7e1ea531b371e4e2402e7677924fb2e07f10fa0901a` | 2026-09-02 | `/tmp/matrix/artifacts/docaudit-apimart-viduq3-ref.mp4` | ¥0.12 | ✅ 3.04s H.264/AAC；抽帧确认红色机器人参考特征与挥手提示词 |
| APIMart `kling-v3` × image-to-video reference (`std`/3s/1 图) | `b62ac560f8a29ec5983857b9cf4342a2c9ef03b8a2d568a7368e26f75236d4d6` | 2026-09-02 | `/tmp/matrix/artifacts/docaudit-apimart-kling-v3-ref.mp4` | ¥0.2016 | ✅ 3.04s H.264；抽帧确认红色机器人参考特征与挥手提示词 |
| APIMart `seedance-2.5` × image-to-video reference (`480p`/4s/1 图) | `ac6a5da498f1152947beee406e33bf65a01aed3f7e92afceca26825df07d4d9f` | 2026-09-02 | `/tmp/matrix/artifacts/docaudit-apimart-seedance25-ref.mp4` | ¥0.3883 | ✅ 4.04s H.264；抽帧确认红色机器人参考特征与挥手提示词；接口 `credits_cost=3.883`，余额差 `0.3883` |

附注：本班早先的免费探针曾让 APIMart Veo/Omni 入口返回 200 并创建任务，但 `/v1/balance` 的 `used_balance` 从 `173.221924` 增至 `173.543524`，增量正好 `¥0.3216`，说明两笔探针未产生额外花销；二者未作为封印证据。Kling 首次错误地发送 `mode=standard`，异步失败且 cost=0，之后用官方 `std` 参数完成上述封印。

## DOCAUDIT-B 封印模式审计 + 参考模式补发（2026-09-02，SEALMODE 终班）

> **规则依据**：`docs/engineering-rules.md` R5「模型 wire 契约三段标准作业」第三段（付费给封印）+ hook `scripts/claude-hooks/model-doc-check.sh`。原文：封印发选**覆盖面最大的模式**（带参考图/参考视频输入的模式优先，参考 wire 是纯文 wire 超集，一发管两头）；**多模式模型其余模式**——wire 形态与已封模式**差异大（另端点/另编码/multipart）才补发**，仅多一字段且干跑+免费探针对账通过的记「**结构已验**」。
> **本次做法**：以 `applyBuiltinSeeds()` 空目录种子为准（代码为准），对每个 ✅ 已封模型比对「封印模式（纯文/无参考）× 该模型参考模式」两条 mapping 的 create 端点 + 编码 + body 形态；同端点+同编码（JSON）→ 结构已验；另端点 → 候选补发。`mapping content hash` 同 DOCAUDIT-A 口径 `sha256(JSON.stringify({create,query,statusMapping}))`，按封印时代码计算；密钥未写入本文件（掩码 6 位，源 `~/.nomi-test-keys.env`）。
> **预算**：本班上限 **¥20**；实际新增 **≈¥1.8**（fal 4 发，见逐笔）。

### 审计结论摘要

- **纳入审计的 ✅ 已封模型（有参考模式者）= 27**：KIE 视频 5（seedance-2.0/happyhorse/minimax-h3/wan-3.0/gemini-omni-1.1）+ KIE 图 8 + MiniMax-H3 + fal 4（3 图 + seedance-2.5）+ APIMart 图 7 + APIMart grok(视频代表) + Runway wan3(视频代表)。（文本/TTS/音乐类无参考 wire，不纳入。）
- **结构已验 = 22**：封印模式与参考模式**同 create 端点 + 同 JSON 编码**，参考仅在同一 body 里多填 `image_urls`/`first_frame_url`/`reference_*_urls` 等字段（运行时按 mode 填），干跑逐字段对账 + 已封纯文模式真发过同端点即证端点/轮询/状态词表通 → 不烧钱。其中 KIE `happyhorse`/`minimax-h3` 连独立 i2v mapping 都没有，参考字段就长在那条 t2v mapping 里（同一条服务两模式）。
- **候选补发 = 5**（均「另端点」）：fal 4（3 图 `/edit` + seedance-2.5 `/image-to-video`）差异端点、fal 账户有余额 → **本班真发封印**；Runway `wan3` 的 i2v 走 `/v1/image_to_video`（与封印用的 `/v1/text_to_video` 另端点）→ 但 **Runway credits ⛔ 已知拦**（veo estimatedCost=40、seedance 系余额不足），本班不重试，留 ⛔。
- **补发 K = 4**，全部真发 + 产物下载 + **双验（提示词特征 + 红色机器人参考特征）通过**。参考图用自绘特征强图 `/tmp/matrix/artifacts/ref-red-robot.png`（亮红机器人 + 天线 + 青色胸灯，fal 官方文档确认 `image_urls`/`image_url` 接受 base64 data URI，故内联不需外链托管）。

### 审计对照表（✅ 已封 × 封印模式 × 参考模式 wire 形态 → 判定）

| vendor/model | 封印模式(纯文) create 端点 | 参考模式 create 端点 | wire 差异 | 判定 |
|---|---|---|---|---|
| kie `bytedance/seedance-2`(2.0,generic) | POST `/api/v1/jobs/createTask` | 同端点(i2v generic 同 hash) | 同端点/JSON，+`first_frame_url`等 | 结构已验 |
| kie `happyhorse` / `minimax-h3` | POST `/api/v1/jobs/createTask` | 无独立 ref mapping（同条 t2v 已含 `image_urls`/`reference_image_urls`） | 同端点/JSON | 结构已验 |
| kie `wan/3-0-video` | POST `/api/v1/jobs/createTask` | 同端点(i2v 同 hash) | 同端点/JSON | 结构已验 |
| kie `google/gemini-omni-flash-1-1` | POST `/api/v1/jobs/createTask` | 同端点(i2v 同 hash `ac80dabc`) | 同端点/JSON | 结构已验 |
| kie 图 ×8（gpt-image-2 / seedream / nano-banana(-2/-2-lite) / seedream/5-pro / 5-lite / flux-2/pro） | POST `/api/v1/jobs/createTask` | `image_edit` 同端点 | 同端点/JSON，+参考图 URL | 结构已验 |
| minimax `MiniMax-H3` | POST `/v2/video_generation` | 同端点(i2v 同 hash `5cba9696`) | 同端点/JSON | 结构已验 |
| apimart 图 ×7（seedream-5-0-pro / 4.5 / gemini-2.5/3.1-flash-image / gpt-image-2 / qwen-image-2.0/3.0） | POST `/v1/images/generations` | `image_edit` 同端点 | 同端点/JSON，+参考图 URL | 结构已验 |
| apimart `grok-imagine-1.5`(视频代表) | POST `/v1/videos/generations` | 同端点(i2v，+`image_urls`) | 同端点/JSON | 结构已验 |
| **fal `openai/gpt-image-2`** | POST `/openai/gpt-image-2` | POST `/openai/gpt-image-2/edit` | **另端点** | **补发 ✅** |
| **fal `bytedance/seedream/v5/pro`** | POST `/bytedance/seedream/v5/pro/text-to-image` | POST `/bytedance/seedream/v5/pro/edit` | **另端点**（轮询根收敛 `bytedance/seedream`，BUG-2 路径） | **补发 ✅** |
| **fal `fal-ai/nano-banana-2`** | POST `/fal-ai/nano-banana-2` | POST `/fal-ai/nano-banana-2/edit` | **另端点** | **补发 ✅** |
| **fal `bytedance/seedance-2.5`** | POST `/bytedance/seedance-2.5/text-to-video` | POST `/bytedance/seedance-2.5/image-to-video` | **另端点** | **补发 ✅** |
| runway `wan3`(视频代表) | POST `/v1/text_to_video` | POST `/v1/image_to_video`（i2v）；另有 `reference` 模式=同端点+字段 | 另端点 | ⛔ 候选但 Runway credits 不足 |

### 补发封印台账（模型 × 封印模式 × 哈希 × 日期 × 产物路径 × 花销）

| 模型 × 封印模式 | mapping content hash | 日期 | 产物路径 | 单笔花销 | 结果/人工核验（双验） |
|---|---|---|---|---:|---|
| fal `openai/gpt-image-2` × edit reference (`image_edit`，`square`/1 图/1 张) | `ca0a2ed3644df49c2e87cb3e6395c60d7ad0cc347766b9c58c00567da1448545` | 2026-09-02 | `/tmp/matrix/artifacts/seal-fal-gpt-image-2-edit-ref.png` | ≈¥0.29 | ✅ 1.0MB PNG；亲验红色机器人（天线+青胸灯，形态保真）置于阳光沙滩+棕榈——参考特征+提示词特征双中 |
| fal `bytedance/seedream/v5/pro` × edit reference (`image_edit`，`square`/1 图/1 张) | `9dd01030b6d54ef0313845eceea21d5dcca1a78cddd71fee696f98b7c9d0ea3a` | 2026-09-02 | `/tmp/matrix/artifacts/seal-fal-seedream5pro-edit-ref.png` | ≈¥0.22 | ✅ 2.1MB PNG；亲验红色机器人置于绿色森林；轮询根 `bytedance/seedream`（BUG-2 收敛路径实走）——双验通过 |
| fal `fal-ai/nano-banana-2` × edit reference (`image_edit`，`1K`/`1:1`/1 图/1 张) | `0d593c323e5155d8e1cfe8885e22b9c1757f20c6672e6b4afd9b6acc720dbca5` | 2026-09-02 | `/tmp/matrix/artifacts/seal-fal-nanobanana2-edit-ref.png` | ≈¥0.28 | ✅ 1.8MB PNG；亲验红色机器人置于雪山之巅；`resolution` 官方枚举实为 `0.5K/1K/2K/4K`（首发误用 `1080p` 被校验拒=不计费，改 `1K` 通）——双验通过 |
| fal `bytedance/seedance-2.5` × image-to-video reference (`480p`/4s/1 图/auto) | `60ab8074c9657ca07aa655ec7b137cac2d0c09e381f4b3137aa0f10984ed9a7e` | 2026-09-02 | `/tmp/matrix/artifacts/seal-fal-seedance25-i2v-ref.mp4` | ≈¥0.79 | ✅ 4.04s H.264 640×640 143KB；抽帧确认红色机器人保真、手臂挥动姿态——参考特征+提示词特征双中 |

附注：① 逐笔花销为按 fal 官方逐模型公示单价的保守估算（fal 无用量流水端点可查）；封印后 fal 余额读回 `$17.437`，本班 4 发 + 早期一次已取消的 t2i 探针（HTTP 0 冷连后手动 PUT `cancel`）+ 一次 nano-banana `1080p` 校验拒（cost=0），合计 ≈$0.25≈¥1.8，**远在 ¥20 上限内**。② fal 提交存在首连偶发 HTTP 0（冷连），已在 `seal-fal-ref.mjs` 加一次重试；不是契约问题（同 body 二次即 200）。③ 复跑脚本 `/tmp/matrix/seal-fal-ref.mjs`（`--dry` 干跑对账 / `--only=<substr>` 单发），参考图生成 `/tmp/matrix/make-robot.py`。

### ⛔ 清单（已知不重试）

- KIE `seedance-2.5` × reference：HTTP 402，余额 12.5 credits（DOCAUDIT-A 已记，本班未重试）。
- Runway `wan3` i2v（及 Runway 视频族的 i2v 另端点）：Runway credits 不足（seedance/veo estimatedCost=40），本班判为候选补发但按已知 ⛔ 不重试；其 `reference` 模式为同端点+字段=结构已验，i2v 另端点待账户充值后补发。
