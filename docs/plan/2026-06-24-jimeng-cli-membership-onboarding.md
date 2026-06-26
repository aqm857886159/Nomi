# 接入即梦官方 CLI —— 让即梦会员用会员积分跑视频

> 2026-06-24 · 状态：方案待拍板（架构改动，R4）
> 真相源：本文件。实现前不另立第二份。

## 一句话

字节 2026-03-31 出了**官方 `dreamina` CLI**（一行 curl 装，扫抖音码授权，跑 Seedance 2.0，花的是用户自己的即梦会员积分）。把它接进 Nomi 的 vendor 系统，让**任何即梦会员**在导演工作台里直接出视频，不用再为每次生成单独付 API 费。

## 为什么做（底层逻辑 · D1 用户摩擦）

- AI 视频最大的摩擦是**贵**：apimart/kie 按次收费，跑几条就肉疼，是新用户和穷创作者的头号门槛。
- 即梦年会员 ≈ 15000 积分/月（约 ¥1500 的量），**平价 + 已沉没成本**。"我已经付了即梦会员，让我在 Nomi 里直接用"——一句话掀掉最大门槛。
- 完全贴 Nomi 的 **BYO-key / 本地优先**哲学（P4）：不是新范式，是顺手多接一个 vendor。
- star 钩子真实：「用你的即梦会员驱动整个本地导演工作台，零额外 API 费」。

## 路线决策（已拍板）

**只接官方 CLI。逆向 free-api（每天 66 免费积分那种）不碰。**
理由：逆向版要绕字节 shark 反爬（headless Chromium 注 a_bogus 签名），字节一更新就崩 = solo 维护不起的猫鼠游戏；且**会封用户的号 + 法律灰**（维护者自己写明）。官方版合法、稳、对手抄不动，符合 D2(广度是敌人) + D4(诚实交付，不上线会封号的功能)。

## 即梦 CLI 接口事实（已核实，实现期需对真二进制复验）

| 环节 | 命令 |
|---|---|
| 装 | `curl -fsSL https://jimeng.jianying.com/cli \| bash` → `~/.local/bin/dreamina` |
| 授权 | `dreamina login --headless` → 返回 `verification_uri`+`user_code`+`device_code`（**OAuth 设备码流程**）；`login checklogin --device_code=… --poll=30` 轮询 |
| 文生视频 | `text2video --prompt --duration --ratio --video_resolution --poll` |
| 图生视频 | `image2video --image --prompt --duration` |
| 首尾帧 | `frames2video --first --last --prompt` |
| 多帧 | `multiframe2video --images a.png,b.png --prompt` |
| 多模态 | `multimodal2video --image --audio`（旗舰） |
| 取结果 | `query_result --submit_id=… --download_dir=./out` → 结果文件下到本地 |
| 余额 | `dreamina user_credit` |
| 模型 | seedance2.0 / seedance2.0fast / 3.5pro |

### 已对真二进制（v1.4.8）验证的事实（2026-06-24）

- **门槛比"会员"更窄 —— 必须是「高级会员 / maestro vip」**：普通即梦账号登录成功但 `user_credit` 返回 `vip_level:""`、`total_credit:0`，且任何生成命令在提交前被纯文本拒绝：`当前账号没有 dreamina_cli 使用权限: current account is not maestro vip`。**接入卡必须 derive 这个状态并诚实标**（见下"门槛诚实"）。
- **`user_credit` 真实输出**（JSON）：`{ "total_credit": int, "user_id": int, "user_name": str, "vip_level": str }`。
- **输出字段词汇表**（从 Go 二进制 struct tag 提取，写宽容解析器够用，首次真生成核准确嵌套）：任务态 `submit_id`/`gen_status`/`fail_reason`/`gen_task_type`/`generate_type`；结果容器 `results`/`result`/`result_json`/`item_list`/`resource_items`/`ResultUri`；视频 URL 候选 `video_url`/`transcoded_video`/`origin_video`/`download_url`/`cover_image`/`VideoMeta`/`duration_ms`；账户 `total_credit`/`vip_level`/`credit_count`。
- **本地副产物**：`~/.dreamina_cli/tasks.db`（SQLite，任务后才建）、`logs/`、`version.json`。实现期对比"解析 stdout vs 读 tasks.db"哪个更稳。

### 输出契约 —— 已从参考实现 Infinite-Canvas（hero8152，1477★，main.py 实战代码）反推确认（2026-06-24）

> ⚠️ **License = "Commercial use is prohibited"。Nomi 是商用产品，绝不抄它的代码（且它是 Python，Nomi 是 TS）。这里只取「dreamina 输出长什么样」这层事实性契约知识，全部自己用 TS 重写。**

久经实战的契约（写 TS 解析器照这个，不再需要 vip 账号才能写对）：
- **输出可能是「文本 + JSON 混合」**，不是干净 JSON。解析法：扫第一个 `{`/`[` 逐个 `raw_decode`，按是否含 `submit_id`/`gen_status`/`result_json`/`images`/`videos`/`data`/`total_credit` 给候选对象打分取最高。
- **结果媒体用递归宽容收集器**取，键白名单：`url`/`urls`/`image(s)`/`image_url(s)`/`video(s)`/`video_url(s)`/`output(s)`/`result(s)`/`file(s)`/`path(s)`/`download_url(s)`/`downloadUrl`/`file_path`/`filePath`，外加「看起来像媒体的字符串」（http(s)/`/output/`/`file://` 或 `.mp4/.png/...` 后缀正则）。**对嵌套层级不敏感** = 抗上游结构变动，正合 plan 原设计。
- **`query_result --download_dir=<dir>` 会把结果媒体文件直接下载到该目录** → 最稳的结果源是「download_dir 里的本地文件」，不是远端 URL。Nomi 应把 download_dir 指向项目素材目录，CLI 帮我们下好。
- **提交→轮询**：submit 返回 `submit_id` + `gen_status`(querying)；没拿到媒体但有 submit_id 就 `query_result` 续查；仍没有但有 submit_id = 云端排队（`queue_info`: `queue_idx`/`queue_length`/`queue_status`）→ 显「排队中」续查态。
- **失败判定**：`gen_status` ∈ {fail,failed,error} 或 reason 含 fail/invalid param；reason 取 `fail_reason`/`failReason`/`error`/`message`/`msg`。
- `submit_id` 递归找（`submit_id`/`submitid`/`task_id`/`taskid`）；**v1.4.2+ 是 UUID**（旧版 16-hex，最低版本闸 1.4.2）。
- 视频模型时长区间：3.0 系 3-10s，3.5pro 4-12s，seedance 4-15s；1080p 仅 vip 档模型；ratio ∈ {1:1,3:4,16:9,4:3,9:16,21:9}。
- 二进制发现：env `DREAMINA_BIN`/`JIMENG_BIN` 或 `which dreamina`；Windows 走 WSL（Nomi Mac 优先，Windows 后续）。登录：流式读 stdout 抽 `verification_uri`/QR（印证设备码登录卡方案）。轮询默认上限 900s。

⚠️ **唯一仍需 maestro-vip 账号的事 = 真生成验收（P3）本身**：跑通"扫码登录→出片→落库"这条活链路 + 核对 `AigcComplianceConfirmationRequired` 实际触发。**契约已不需要 vip 就能写对**，单测可用合成输出覆盖；只剩"亲眼看它真出一条片"这关等 vip。

## 集成架构（方案 2A·声明驱动进程 transport · 最小侵入）

复用现有异步视频轮询状态机，**只新增一种 transport**，沿用豆包语音 `audioResponse` 的"声明驱动分流"范式：

1. **`electron/catalog/types.ts:193-217`** — `HttpOperation` 加可选声明字段
   `process?: { bin: string; argsTemplate: string[]; resultJsonPath: string; statusPath: string }`（仿 `audioResponse:208`）。
2. **`electron/runtime.ts:457` `executeProfileOperation`** — 开头按 `operation.process` 分流：
   声明了 `process` → 走 **spawn 分支**（spawn `dreamina` + 收 stdout + `JSON.parse` + 按 `resultJsonPath`/`statusPath` 取值），否则走现有 `requestJson`。
   spawn 范本：`electron/video/extractVideoFrame.ts:89`、`electron/export/mediaProbe.ts:208`。
   **`runTask`/`fetchTaskResult` 的 submit→poll 状态机一行不改**——`taskCache`/`admitTask`/`providerMeta`/`statusMapping`/`buildProfileTaskResult` 全部复用。`providerMeta.task_id` 存 CLI 的 submit_id。
3. **新建 `electron/catalog/dreaminaVendor.ts`**（仿 `volcengineVendor.ts`，`authType:"none"`）+ **`dreaminaVideos.ts`**（curated 模型/映射；create=text2video/image2video/…、query=query_result，两个 op 各带 `process` 声明 + `statusMapping`）。
4. **`electron/catalog/seedBuiltins.ts:206 / 294 / 306 / 329`** — 四处注册 vendor / 模型 / 映射（幂等自愈，老用户重启自动补，仿 issue#9 种子大脑）。

## 授权 UX（设备码 → 桌面卡片）

设备码流程对桌面端是最佳 UX，**不用让用户复制粘贴 sessionid**（D1：effect-first，别让用户配置）：
- 模型设置里「即梦会员」卡 → 点「登录」→ Nomi 后台 `dreamina login --headless` 拿 `verification_uri`+`user_code` → 卡片里**显二维码 + 验证码**（复用现有付费确认卡/Spotlight 的 overlay 范式）→ 用户抖音扫码确认 → Nomi `checklogin` 轮询到 OK → 落盘。
- 受限 IPC：仅暴露 `dreamina:login-start` / `dreamina:login-poll` / `dreamina:logout`，参数白名单，禁任意 args 注入。

## 凭证存储（单槽多字段 · 复用现有派生链）

- 登录成功后把整个 login JSON `JSON.stringify` 成一个字符串，经 `catalogStore.ts:449 upsertModelCatalogVendorApiKey` 存进 `apiKeysByVendor["dreamina"]`（自动 safeStorage 加密）。用时 spawn 分支 `decryptApiKeyRecord` + `JSON.parse` 取回——仿火山语音 `splitDoubaoCredential`（`audioTaskRunner.ts:101`）的"单槽多字段"范式。
- **附带收益**：这样 `hasApiKey` 自动为真，模型 picker 派生链（`modelCatalogCache.ts:83` / `usableVendorModel.ts:18`）**零改动**即可点亮"已登录才可选"。否则 `authType:"none"` 会让未登录也显示可用（坑，见下）。

## 二进制管理（检测 + 引导/代装）

- 启动/进卡时检测 `~/.local/bin/dreamina` 是否存在 + 可执行。
- 不存在 → 卡片显「一键安装即梦 CLI」按钮，Nomi 代跑官方 curl 安装（用户可见命令，诚实）。**不 bundle**（是字节的二进制，licensing+更新都该跟官方走，bundle 违 P1 制造并行版）。
- 执行位自愈：仿 `electron/export/ensureExecutable.ts`（踩过 ffprobe 缺执行位的坑）。

## 不动的项（防 scope 蔓延）

- 不接逆向 free-api（已决策）。
- 不动现有 apimart/kie 视频路径（P1：新增 transport，不改旧 transport）。
- 不接即梦的文生图/图生图（本期只视频；图已有多家 vendor，避免重复）。本期也不接 multimodal 的 audio 输入（先把纯视频跑通）。
- 不做国际版 CapCut Dreamina（sessionid + 代理那套属另一套鉴权，留观察）。

## 回滚

新增 vendor + 一个 operation 声明字段 + 一个 spawn 分支，全部可加 feature 检测降级。回滚 = 删 dreaminaVendor/dreaminaVideos + 移除 seed 四处 + 还原 `executeProfileOperation` 的 process 分支判断。不影响任何现有 vendor。

## 验收门（P3：全绿≠完成）

1. 五门全过（filesize→tokens→lint→typecheck→test→build）。
2. 纯函数单测：CLI 输出 JSON 解析器（结果路径/状态/submit_id 提取）裸 Node 可测（仿 doubaoTtsCodec）+ process 分流单测。
3. **真机真生成**（需用户即梦会员，见下）：设备码登录走通 → text2video 出片 → 结果文件落库 → 画布/时间轴可见 → `user_credit` 余额读到。
4. R13 真机走查：登录卡 UX（二维码显示/轮询态/已登录态）+ 未装 CLI 的引导态 + 退登。

## 受众诚实（D4 · star 论需要校准）

原始设想是"让开即梦会员的也能跑视频"，但实测门槛是**「高级会员 / maestro vip」这一特定档**，不是任意即梦会员。受众 = "付了即梦顶级会员 + 想要本地导演工作台的人"，比"任意即梦用户"窄。功能仍真实有价值，但 star 论的盘子要按这个口径估，别高估。

## 阻塞 / 需用户独有资源

- **`dreamina` 已装、登录流程已真机验证通过、`user_credit`/错误信封/字段词汇表已扒到**（2026-06-24）。
- **唯一硬阻塞**：用户当前即梦账号**不是 maestro vip**（`vip_level:""`、0 积分、生成被拒）。要拿到 §"已验证事实"里 ⚠️ 的「结果 JSON 确切嵌套」+ 做真生成验收，**必须一个 maestro-vip 即梦账号**。这是用户独有资源，我无法自解。
- 代码可先全写完（解析器写宽容版 + 单测 + mock E2E + 登录卡样张 + 五门全过），真生成验收挂起等 vip 账号。

## 排期（实现时）

S1 types `process` 声明 + runtime spawn 分支 + 纯函数解析器 + 单测 → S2 dreaminaVendor/dreaminaVideos + seed 四处 + mock E2E → S3 设备码登录 IPC + 卡片 UX（先样张 R8 拍板）→ S4 二进制检测/引导/执行位自愈 → S5 真机真生成验收（用户即梦登录）+ R13 走查。
