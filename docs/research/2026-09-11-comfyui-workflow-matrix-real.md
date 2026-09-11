# ComfyUI 工作流接入矩阵 · 第一次真机实跑（2026-09-11）

> 回答的问题：**「ComfyUI 各种工作流都能接进 Nomi 并且好用吗？」**
>
> 8 月那份 `docs/research/2026-08-25-comfyui-workflow-matrix-report.md` 是 fake HTTP server 跑的合同层结论；
> 本次是**第一次对着本机真 ComfyUI 跑**，只记真机事实，不复述其合同层结论。
> 纪律：像真人一样只走界面（粘贴 / 点按钮 / 看屏幕），不预埋 catalog、不灌 store、不发 IPC。

## 一句话结论

**导入前半程做得很好，导入后半程整条断在地上。**
七行工作流里，**7/7 能被正确解析、缺件报告精确到文件名**；但**0/7 能真的跑起来**——
本机 ComfyUI 在界面上**永远停在「未启用」**，导入的工作流**一条都没落盘**，画布上的模型选择器里**一个 ComfyUI 模型都没有**。
两个都是**结构性死路**（不是配置问题、不是可发现性问题），复现率 3/3。

## 八行状态

| # | 行 | 状态 |
|---|---|---|
| 1 | SD1.5 文生图（官方 `basic_api_example.py` 原文） | ①②③ ✅ 精确 · ④⑤ ❌ 到不了 |
| 2 | SD1.5 图生图（LoadImage） | ①②③ ✅ · ④⑤ ❌ |
| 3 | SD1.5 + LoRA（LCM-LoRA） | ①②③ ✅ · ④⑤ ❌（LoRA 字段不在自动建议里，需手动加） |
| 4 | 放大（RealESRGAN_x4plus） | ①② ✅ · ③ ⚠️ 漏报（N1）· ④⑤ ❌ |
| 5 | 视频无模型链（LoadVideo → 放大 → SaveVideo，官方 `utility-gan_upscaler`） | ①②③ ✅ · ④⑤ ❌ |
| 6 | 缺件专测 A：官方 Flux Dev（不下模型） | ③ ✅ **4/4 精确，零误报** |
| 7 | 缺件专测 B：ComfyUI-KJNodes（装前 / 装后） | ③ ✅ 装前精确报 3 个缺节点，装后 0 缺 |
| — | 4b 负向对照（故意塞 3 个本机没有的文件名） | ⚠️ **只报出 1 个，漏 2 个**（N1 实锤） |

## 环境（真机事实）

| 项 | 值 |
|---|---|
| ComfyUI commit | `1d48d9cf7bcecb6022a87b3cb13e0fb435bf9b8a`（2026-09-10）· 版本 `0.35.0` |
| 前端 / 模板包 | `comfyui-frontend-package 1.51.10` · `comfyui-workflow-templates 0.11.59` |
| Python / torch | 3.12.13 · `torch 2.14.0` + `torchvision 0.29.0` · `mps=True` · Device `mps` |
| 起法 | `cd ~/ComfyUI && ./.venv/bin/python main.py --port 8188`，日志 `/tmp/comfyui-matrix.log` |
| Nomi | worktree `Nomi-comfy-matrix`，base `origin/main @ 0cea000d8`（未改任何产品代码） |
| object_info 规模 | 装包前 **928** 类；装 KJNodes 后 **1188** 类（+260） |
| 下载量 | 模型 2.2GB（SD1.5 fp16 2.03GB + RealESRGAN 64MB + LCM-LoRA 128MB）；venv 1.7GB；自定义节点 4.2MB。**合计 4.0GB**，在 ≤7GB 预算内 |
| 磁盘 | 开工前 `20Gi avail / 96%` → 收工 `43Gi avail / 90%`。**空间是涨的**——本次占 4.0GB，同期别的会话清理 worktree 释放了更多，不是本任务省出来的 |

**ComfyUI 仍在跑**（本报告写完时 listener PID 见 `lsof -nP -iTCP:8188 -sTCP:LISTEN -t`），**故意不杀**，留给下一位。
要停：`kill $(lsof -nP -iTCP:8188 -sTCP:LISTEN -t)`。注意 **`pkill -f "ComfyUI/main.py"` 抓不到它**——
它的命令行是相对路径 `main.py --port 8188`（cwd 才是 `~/ComfyUI`）。本次就因为这个白跑了一轮「装了包却看不到节点」。

## 素材与许可

| 文件 | 来源 | 许可 |
|---|---|---|
| `v1-5-pruned-emaonly-fp16.safetensors` | `Comfy-Org/stable-diffusion-v1-5-archive` | CreativeML OpenRAIL-M |
| `RealESRGAN_x4plus.pth` | `xinntao/Real-ESRGAN` releases `v0.1.0` | BSD-3-Clause |
| `lcm-lora-sdv1-5.safetensors` | `latent-consistency/lcm-lora-sdv1-5` → `pytorch_lora_weights.safetensors` | openrail++ |
| `ComfyUI-KJNodes` | `kijai/ComfyUI-KJNodes` @ `57105374f47d0fbb49c9c3926fb981702e0a4b5c` | GPL-3.0 |

Flux / WAN / SVD **按要求没下**，只用其工作流测第③步。

## 主表

所有工作流**先在真 ComfyUI 上 POST `/prompt` 跑通**（5/5 `success`，产物见下），
再拿去 Nomi，这样 Nomi 里出问题时能确定是 Nomi 的问题而不是图本身有毛病。

| 工作流 | ①导入 | ②认输入（认成什么） | ③缺件准确性 | ④跑通 | ⑤改参数 / 绑定入口 | 结论 | 证据 |
|---|---|---|---|---|---|---|---|
| **1. SD1.5 文生图**<br>官方 `basic_api_example.py` 原文 | ✅ 解析通过，认成「图片工作流（无首尾帧＝文生）」 | 提示词→`#6 CLIPTextEncode`；输出→`#9 SaveImage（图片）`；7 个数值参数（KSampler seed/steps/cfg/denoise + EmptyLatentImage w/h/batch） | ✅ **精确**：官方原文写 `v1-5-pruned-emaonly.safetensors`，本机是 `-fp16` 版 → 报「1 个输入引用了本机没有的文件」并点名 `CheckpointLoaderSimple.ckpt_name`。改成本机文件名后 → **0 缺，零误报** | ❌ 到不了（见 BUG-1/2/3） | ❌ 到不了 | **能导入不能跑** | `row1a-02-analyzed.png`<br>`row1b-02-analyzed.png` |
| **2. SD1.5 图生图**<br>LoadImage → VAEEncode | ✅ 认成「图片工作流（带首帧输入＝图生）」 | 媒体输入按声明出槽：`Load Image` → 图片槽；提示词/输出同上；4 个 KSampler 数值 | ✅ 0 缺（正确） | ❌ | ❌ | **能导入不能跑** | `row2-02-analyzed.png` |
| **3. SD1.5 + LoRA**<br>LoraLoader | ✅ 认成「文生」 | 提示词/输出对；7 个数值参数 | ✅ 0 缺（正确——`LoraLoader.lora_name` 是老式 combo，Nomi 看得见本机 LoRA 列表） | ❌ | ⚠️ **`lora_name` 不在自动建议参数里**（自动只挑数值）。可用「添加参数」手动暴露，但用户得自己想到 | **能导入不能跑** | `row3-02-analyzed.png` |
| **4. 放大**<br>UpscaleModelLoader + ImageUpscaleWithModel | ✅ 认成「带首帧输入＝图生」 | `Load Image` → 图片槽；输出 `#9 SaveImage`；**0 个自动参数** | ⚠️ 本机有该文件所以报 0 缺（表面正确），但**这条链上的缺件检测其实是瞎的**——见负向对照 | ❌ | ❌ | **能导入不能跑 + 缺件漏报** | `row4-02-analyzed.png` |
| **4b. 负向对照**<br>故意塞 3 个本机没有的值 | ✅ | `Load Image` 图片槽 ＋ `Load Audio` **也被标成「图片」**（BUG-5） | ❌ **只报 1 / 3**：`CheckpointLoaderSimple.ckpt_name` 报了；`UpscaleModelLoader.model_name="NOT_INSTALLED_x8plus.pth"` 和 `LoadAudio.audio="NOT_INSTALLED_clip.wav"` **静默漏掉** | — | — | **N1 实锤：漏报不是误报** | `row4b-02-analyzed.png` |
| **5. 视频无模型链**<br>官方 `utility-gan_upscaler`：LoadVideo → GetVideoComponents → ImageUpscaleWithModel → CreateVideo → SaveVideo | ✅ 认成**视频**工作流 | `加载视频` → **视频**槽（正确认出 `LoadVideo.file` 而不是 `image`）；输出 `#12 SaveVideo（视频）`（正确跳过中间的 `CreateVideo`） | ✅ 0 缺（正确） | ❌ | ❌ | **能导入不能跑** | `row5-02-analyzed.png` |
| **5UI. 同上，界面格式原文** | ✅ **自动转成 API 格式**（Nomi 借 ComfyUI 自己的前端转，见 `electron/comfyuiGraphConvert.ts`） | 与 API 版**逐项一致** | ✅ 0 缺 | ❌ | ❌ | **转换这一层是真的好用** | `row5ui-02-analyzed.png` |
| **6. 缺件专测 A：官方 Flux Dev**<br>（不下任何 Flux 模型） | ✅ | 提示词→`#194:49 CLIPTextEncode`（**subgraph 展平后的复合 ID 带冒号，照样认得**）；输出→`#9 SaveImage`；7 个数值参数 | ✅ **4/4 精确、零误报、零漏报**：`VAELoader.vae_name="ae.safetensors"` · `UNETLoader.unet_name="flux1-dev.safetensors"` · `DualCLIPLoader.clip_name1="clip_l.safetensors"` · `DualCLIPLoader.clip_name2="t5xxl_fp16.safetensors"`；节点 0 缺（正确，全是核心节点） | — | — | **缺件报告在老式 combo 上完全可信** | `row6-02-analyzed.png` |
| **6UI. 同上，界面格式原文**（官方模板包原样 25KB，含 subgraph） | ✅ 自动转 API，**subgraph 自动展开** | 与 API 版逐项一致 | ✅ 同样 4/4 精确 | — | — | **官方模板直接粘贴可用** | `row6ui-02-analyzed.png` |
| **7a. KJNodes · 装之前** | ✅ | `Load Image` 图片槽；2 个 KJ 数值参数 | ✅ **精确**：「本机 ComfyUI 缺 3 个节点：`ImageResizeKJv2` · `GetImageSizeAndCount` · `ColorMatch`——先装齐（如用 ComfyUI-Manager），否则运行必失败」 | — | — | **缺节点报告精确** | `row7a-02-analyzed.png` |
| **7b. KJNodes · 装之后** | ✅ | 同上，`Load Image`→图片槽、`#9 SaveImage`→输出、`#20 ImageResizeKJv2` 的 2 个数值参数；提示词正确判 `__none__`（这张图确实没有提示词节点，**没硬凑**） | ✅ 0 缺节点 0 缺文件 | ❌ | ❌ | **第三方节点包识别没问题** | `row7b-02-analyzed.png` |

### 第④步在 ComfyUI 侧的对照（证明图本身没问题）

直接 POST `/prompt`，5/5 `success`：

| 行 | 产物 | 耗时 |
|---|---|---|
| 1 | `ComfyUI_00001_.png` | 22.3s |
| 2 | `NomiMatrixRow2_00001_.png` | 10.4s |
| 3 | `NomiMatrixRow3_00001_.png` | 7.5s |
| 4 | `NomiMatrixRow4_00001_.png` | 21.4s |
| 5 | `video/NomiMatrixRow5_00001_.mp4` | 21.1s |

所以：**图是好的、机器是好的、ComfyUI 是好的。断的是 Nomi 从「导入」到「能用」这一段。**

---

## 真机发现的 bug / 缺口清单

### BUG-1（阻断）「启用 ComfyUI」永远停在「未启用」，界面上没有任何确认入口

- **现象**：点「启用 ComfyUI」→ 卡片提示「已提交「本地 ComfyUI」，请在 Nomi 中确认后开始真实验证」，
  但徽章仍是 **未启用**，按钮文案仍是「启用 ComfyUI」。用户**已经在 Nomi 里了**，却没有任何东西可以确认。
- **探针**：点击后 t+0.5s / 1s / 1.5s / 2s / 3s / 5s / 8s / 12s 逐拍扫全部按钮与 aria-label，
  「确认 / 去确认 / 验证」**一个都没出现**；再点一次「启用」没用；关掉设置回主界面也没有待确认提示。
- **截图**：`C1-after-enable.png`、`P-final.png`、`P-second-enable.png`、`P-settings-closed.png`
- **疑似位置**：`src/ui/onboarding/ComfyuiLocalCard.tsx:121-124`
  ```
  // Probe is advisory only. Keep the instance disabled until a workflow
  // canonical run reaches promotion; this prevents save-then-enable.
  catalog.upsertVendor({ key, enabled: false, baseUrlHint: ... })
  ```
  设计上「要等一条工作流的 canonical run 晋级才启用」，但那条路被 BUG-2 堵死 → 死循环。
- **归到**：第①步（接入）
- **已知？** 否。`gh pr list` 里没有在途 PR 碰这块。

### BUG-2（阻断）导入的工作流**一条都不落盘**，而且失败**不告诉用户**

- **现象**：粘贴 → 分析 → 命名 → 点「导入」→ 弹出「确认接入并开始验证」→ 点「确认验证」→
  弹层关闭、**直接跳回模型首页显示「还没有接入生成模型」**。`model-catalog.json` 里**搜不到刚导入的名字**。
  全程**没有任何错误提示**。
- **复现**：3/3（两次完整矩阵 + 一次隔离 profile 专项探针）。不点「确认验证」直接关掉弹层，结果一样：不落盘。
- **真相在盘上**（隔离 profile `capability/integration-sessions.json`）：
  ```json
  { "kind": "comfyui-workflow", "stage": "failed",
    "startReceiptStatus": "consumed",
    "blockingReason": { "code": "certification_unavailable" } }
  ```
  且 ComfyUI 的 `/history` 自始至终只有我自己那 5 条直连验证——**Nomi 一次 `/prompt` 都没发出去**。
- **根因链（逐跳可查）**：
  1. `electron/main.ts:410` → `registerIntegrationSessionIpc()`，**没传 service**
  2. `electron/integrationCertification/integrationSession.ts:1643` → `singleton ||= createRuntimeIntegrationSessionService()`，**没传 deps**
  3. 同文件 `:236` → `const runTask = input.runTask`（= `undefined`），`fetchTaskResult` / `mintSpendGrant` 同理
  4. 同文件 `:377`（`certifyComfy` 闭包第一行）→ `if (!runTask || !fetchTaskResult || !mintSpendGrant) throw new Error("comfy_certification_unavailable")`
  - `certifyComfy` 本身**是**挂上了（`:536`），所以 `:1422` / `:1561` 的「有没有这个能力」检查全部通过，
    直到真正调用时才在闭包里炸——**一个 optional 依赖没接线，把整条接入链变成必炸且静默**。
    这正是 **R28**「安全关键依赖不许 optional + 欠账登记」拦的那一族。
- **截图**：`PB-confirm-01-gate.png`、`PB-confirm-02-after.png`、`row1b-03-import-gate.png`、`row1b-04-verified.png`
- **归到**：第①步（导入落地）与第④步（跑）
- **已知？** 否。

### BUG-3（阻断，BUG-1 的直接后果）画布上一个 ComfyUI 模型都选不到

- **现象**：按真人路径接完 ComfyUI → 建项目 → 生成画布 →
  - 对话区模型选择器：**「目录里没有可用的」**，图片默认「自动选」，只给「去模型库添加 / 接自己的 key」
  - 节点自己的模型选择器：默认「即梦图片（会员）」，**列表里没有任何 ComfyUI 条目**
- **值得注意**：`model-catalog.json` 里内置的 `comfyui-txt2img`（"本地 · 文生图"）mapping **是 `enabled: true`** 的，
  但 vendor `comfyui-local` 是 `enabled: false` → 整条都浮不上来。
- **顺带**：`src/ui/onboarding/ComfyuiLocalCard.tsx:290+` 的「已连接」分支（**预置模板「一键启用」、工作流列表、
  进工作流设置整页的入口**）统统挂在 `enabled` 为真之下 → BUG-1 未解时，ComfyUI 卡片上**只有「自定义」导入面板这一个东西是活的**。
- **截图**：`D3-model-picker.png`、`D5-node-model-picker.png`
- **归到**：第④步
- **已知？** 否。

### BUG-4（准确性）新一代 `["COMBO",{options}]` 下拉的缺件**漏报**（= 任务书里的 N1，但方向相反）

- **任务书假设是「误报缺件」，真机结果是「静默漏报」。** 负向对照 4b 塞了 3 个本机没有的值，只报出 1 个：

  | 输入 | object_info 形状 | Nomi 报了吗 |
  |---|---|---|
  | `CheckpointLoaderSimple.ckpt_name` | 老式 `[[...], {...}]` | ✅ 报了 |
  | `UpscaleModelLoader.model_name` | 新式 `["COMBO", {options:[...]}]` | ❌ **静默漏掉** |
  | `LoadAudio.audio` | 新式 `["COMBO", {...}]` | ❌ **静默漏掉** |

- **规模（ComfyUI 0.35.0 全量普查，`object_info-combo-format-census.json`）**：
  **老式 60 个输入 vs 新式 500 个输入**——新式已经是绝大多数。
  受影响的恰好是**放大模型、视频输入、音频输入**这几条链（`UpscaleModelLoader.model_name` / `LoadVideo.file` / `LoadAudio.audio` 全是新式）；
  而 checkpoint / LoRA / UNET / CLIP / VAE 这些**还是老式**，所以文生图这条主路看起来一切正常——**问题被主路的正常掩盖了**。
- **KJNodes 也是混的**：260 个类里老式 108 个输入 / 新式 33 个。
- **疑似位置**：`electron/comfyuiObjectInfo.ts:43`
  ```ts
  const options = Array.isArray(spec) ? spec[0] : undefined;
  if (!Array.isArray(options) || ...) continue;   // spec[0] === "COMBO" 时直接 continue
  ```
  → 该输入没有枚举 → `reconcileComfyWorkflow` 的 `if (!options || options.includes(value)) continue` 跟着跳过 → **不报缺**。
  连带影响：这些字段也烤不成画布上的下拉（`collectGraphEnumOptions` 同一处跳过）。
- **夹具已存好**给修 N1 那位：
  `object_info-newgen-combo.json`（新式 5 个节点原文）、`object_info-legacy-combo.json`（老式 7 个对照）、
  `object_info-combo-format-census.json`（全量 500 条路径）、`object_info-kjnodes-sample.json`、`object_info-kjnodes-combo-census.json`
- **归到**：第③步
- **已知？** 是（N1，另有人在修）——但**方向要更正**，且请把负向对照当验收断言。

### BUG-5 `LoadAudio` 的媒体槽被标成「图片」

- **现象**：4b 里同时有 `LoadImage` 和 `LoadAudio`，绑定区两行都写「图片」。
- **疑似位置**：`src/ui/onboarding/ComfyuiWorkflowImportPanel.tsx:450`
  ```tsx
  {row.mediaKind === 'video' ? t('...comfyWorkflow.video') : t('...comfyWorkflow.image')}
  ```
  二元三目，`'audio'` 落进 else → 「图片」。**后端是对的**（`comfyuiWorkflowImport.ts` 的 `LOAD_AUDIO_RE` 认得 `LoadAudio`、
  `mediaKind: 'audio'` 也带出来了），断在这一行渲染上；`onboardingProviders.comfyWorkflow` 下也**还没有 `audio` 这个文案键**，修的时候要一并加。
- **注意**：音频那批修复（`124cde2a4`、`ac9c78b46`）**已经在本次 base 里**了，所以这是**当前 main 上仍然存在**的漏网，不是老版本。
- **归到**：第②步 · **已知？** 否。

### BUG-6 验证弹层的「模型：」永远停在「正在读取…」

- **现象**：`row1b-03-import-gate.png` 里「模型：正在读取…」，等到弹层关闭都没落定。
- **根因**：盘上 session 的 `selections: []`。`src/ui/onboarding/IntegrationConfirmationPanel.tsx:109`
  是 `selections.map(...).join('、') || t('modelSetup.integrationPending')` ——
  **「空」和「还在读」共用同一句文案**，于是「本来就没有」被显示成「正在读取…」，用户只会以为是慢。
- **归到**：第①步 · **已知？** 否。

### BUG-7 本机 ComfyUI 也被告知「确认后才会消耗上游额度」

- **现象**：同一张弹层的正文写「这是一次真实生产请求……确认后才会消耗上游额度」。
  接的是 `http://127.0.0.1:8188`，**不花一分钱**。对着本地后端讲额度，既不准确也制造无谓犹豫（D4 诚实交付）。
- **位置**：`src/i18n/locales/modelSetup.ts:88 integrationConfirmHint`
- **归到**：第①步 · **已知？** 否。

### BUG-8 导入只能**粘贴 JSON**，没有文件上传 / 拖拽

- **现象**：`ComfyuiWorkflowImportPanel.tsx:367` 只有一个 `<textarea>`；全仓该面板内无 `input[type=file]`、无 drop 处理。
- **为什么是摩擦（D1）**：用户手上的东西就是一个 `.json` 文件（官方模板包 493 张全是文件，本次 Flux 那张 25KB）。
  现在要他「打开文件 → 全选 → 复制 → 找到那个 5 行高的小框 → 粘贴」。
  而 Nomi **已经能自动把界面格式转成 API 格式**了（这一步做得很好），偏偏卡在「怎么把文件递进来」。
- **归到**：第①步 · **已知？** 否（用户 memory 里「技能导入必须能直接上传文件」是同一族诉求）。

### BUG-9 带视频输入的工作流被描述成「无首尾帧 ＝ 文生」

- **现象**：第 5 行明明有 `LoadVideo`，抬头仍写「已识别为 视频 工作流（无首尾帧 ＝ 文生）」。
  下面绑定区又正确列出「加载视频 / 视频」槽——**同一屏里自相矛盾**。
- **原因**：文生/图生那句只看首尾帧（图），没把视频/音频输入算进去。
- **归到**：第②步 · **已知？** 否。

### BUG-10 导入面板挤在 760×560 的设置对话框里，绑定行要滚动才看得见

- **现象**：粘贴区只有 5 行高（`row1a-02-analyzed.png` 里只能看到 JSON 的最后 4 行）；
  「媒体输入 / 输出节点 / 可调参数」整段在视口之外，要滚动才看得到；缺件警告也被切一半。
- **对比**：`ComfyuiWorkflowSettingsPage.tsx` 开头的注释已经写明「那张对话框是 760×560，装不下节点图」，
  所以**配置**搬去了整页——但**导入**仍留在小框里，而导入恰恰是要一次看清 5 段信息的那一步。
- **归到**：第①②步 · **已知？** 部分（整页化的理由已在注释里，只是没覆盖导入）。

---

## 做得好的（别在修上面时弄坏）

1. **界面格式 → API 格式自动转换**（`electron/comfyuiGraphConvert.ts`，借 ComfyUI 自己的前端跑 `graphToPrompt`）。
   真机验证：官方 Flux 模板 25KB **含 subgraph**，粘进去自动展平成 9 个节点，
   结果与我用同样办法手工导出的 API 版**逐字节同结论**。这是 Electron 独有的结构性优势，做得对。
2. **缺件对账在老式 combo 上完全可信**：Flux 4/4 精确、SD1.5 原文 1/1 精确、改对后 0 误报。
3. **缺节点对账精确**：KJNodes 装前不多不少报 3 个，还给了「用 ComfyUI-Manager」的下一步。
4. **不硬凑**：没有提示词节点时老老实实给 `__none__`；`CreateVideo` 不当输出、正确顺到下游 `SaveVideo`；
   `LoadVideo` 的键认的是 `file` 不是 `image`。
5. **subgraph 复合节点 ID（`194:50`）全链路无碍**。

---

## 下一步收口清单建议

**P0 · 不修这两条，ComfyUI 接入等于没有**

1. **接线 `runTask` / `fetchTaskResult` / `mintSpendGrant`**（BUG-2 根因）。
   改在最早能拦住的那层（R28）：把这三个从 `Dependencies` 的 optional 改成必填，
   让**编译器**拦住「忘了接线」，而不是等运行时在闭包里抛一个用户看不见的 `comfy_certification_unavailable`。
2. **让失败可见**：`stage: "failed"` + `blockingReason` 必须回到用户眼前。
   现在是「弹层一关、跳回首页、什么都没说」——比报错更糟，用户会以为成功了。
3. **给「启用 ComfyUI」一条走得通的路**（BUG-1）：要么卡片上就地给确认入口，
   要么承认本地后端不需要「消耗额度」这套闸（见第 6 条）。当前文案指向一个不存在的地方。

**P1 · 准确性**

4. **`parseObjectInfoIndex` 认新一代 `["COMBO",{options}]`**（BUG-4）。
   验收必须用负向对照：塞 `UpscaleModelLoader.model_name` / `LoadVideo.file` / `LoadAudio.audio` 三个本机没有的值，
   **三个都要报出来**才算修好；夹具已在 `2026-09-11-comfyui-matrix-evidence/object_info-*.json`。
   顺手能修好画布下拉（同一处跳过导致枚举烤不进去）。
5. **`LoadAudio` 槽显示成「音频」**（BUG-5），补 `comfyWorkflow.audio` 文案键，并把那个二元三目改成按 `mediaKind` 穷举。
6. **本地后端不讲「上游额度」**（BUG-7）；「模型：」区分「空」与「读取中」（BUG-6）。
7. **文生/图生的判定把视频、音频输入算进去**（BUG-9）。

**P2 · 摩擦**

8. **导入支持选文件 / 拖拽 `.json`**（BUG-8）——转换层已经够聪明了，别卡在递文件这一步。
9. **导入面板挪出 760×560 的对话框**（BUG-10），与已经整页化的「工作流设置」同一个家。
10. **LoRA / checkpoint 这类文件名字段进自动建议参数**（第 3 行）——现在只自动挑数值，
    换 LoRA 是很常见的动作，不该要用户自己想到去点「添加参数」。

**建议的回归断言（把本次发现变成拦得住人的东西，R28）**

- 一条真机走查：起本机 ComfyUI → 界面接入 → 导入官方 SD1.5 API 图 → **断言 catalog 里真的有这条工作流** → 画布模型选择器里**选得到它** → 生成出图。
  （本次三条断言全红，而现有 `comfy-*.walk.mjs` 三条走查全是预埋 catalog + fake HTTP server 的，**结构上看不见 BUG-1/2/3**。）
- 一条缺件负向对照单测：老式 + 新式 combo 各塞一个不存在的值，**两个都必须报**。

---

## 证据清单

全部在 `docs/research/2026-09-11-comfyui-matrix-evidence/`：

- **截图** 46 张（`<row>-<step>.png`；`00-/02-/03-` 接入，`row*-01-pasted/02-analyzed` 每行两步，
  `row1b-03/04` 导入闸与确认后，`C*`/`P*` 启用探针，`PB-*` 落盘探针，`D*` 画布与模型选择器）
- **工作流** `workflows/`（12 张，含官方原文、界面格式原文、负向对照）
- **object_info 夹具** `object_info-newgen-combo.json` / `-legacy-combo.json` / `-combo-format-census.json` /
  `-kjnodes-sample.json` / `-kjnodes-combo-census.json`
- **结构化记录** `findings.json`
- **输入素材** `matrix_input.png` / `matrix_input.mp4`
- **探针脚本** `prototype/`（本次新增，只走界面、不预埋 catalog、不灌 store）：
  `comfy-real-matrix.mjs`（主矩阵）、`-connect`、`-gate-probe`、`-import-probe`、`-canvas`，跑法见 `prototype/README.md`。
  **刻意不放进 `tests/ux/`**：它们是「记录并继续」的探索脚本，没有断言，
  会被 `check:walkthroughs`（≥2 条失败路径）和 `check:test-waits`（禁私有墙钟等待）拦下——**这两条门岗拦得对**，
  为了过门岗往探针里塞凑数断言只会骗过下一个读它的人。真正该补的回归走查见上面收口清单最后一节。
