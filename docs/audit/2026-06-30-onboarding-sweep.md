# 接入测试全量扫描 2026-06-30

**触发**：用户报 modelscope 图片 HTTP 400「(no detail from provider)」，要求把「生成」这里**目前接入的所有模型逐个真跑一遍，找到所有问题→挖根因→全部解决→做完整接入测试**。

**方法**：headless 接入测试 harness（`scratchpad/onboard-sweep.mjs`，经能力核 `invoke('generate')` 走 B 模式真生成，spend 旁路 `NOMI_LOOP_SPEND_OK=1`，网络瞬态自动重试以剔除代理抖动噪音，按各模型 `kind` 用正确 taskKind 逐个真跑）。共 **59 个已接入模型**（12 vendor）。

## Pass 1（text + image + audio，37 模型）已完成

汇总：**18 成功 / 12「其他」/ 5 连接错 / 2 超时**。逐项分诊 → 根因 → 处置：

### A. 代码级根因（已修，已 commit，五门过）

| # | 模型/路径 | 现象 | 根因 | 处置 |
|---|---|---|---|---|
| 1 | 用户报的 modelscope 400 | `(no detail from provider)` 吞掉真因 | 错误提取只读单数 `msg/message/error`，魔搭失败体是复数 `errors.message`（轮询侧早读、提交/错误侧漏读） | 补齐 `errors.message/.detail`（vendorHttp.ts）。已推 main `0371c70d` 前序 commit |
| 2 | dreamina 图/视频（UI+headless 全废） | `即梦 CLI 调用失败：unknown flag: --download_dir` | 提交子命令(text2image/text2video/image2video/multiframe2video/image_upscale)误带 `--download_dir`，实查 CLI 只 `query_result` 认 → 提交即秒挂 | 提交 op 去标 + `processOperation` 结构性兜底(只 query_result 追加)，杜绝复发 |
| 3 | 火山 Seedream 5.0 | HTTP 400 size must be WxH/2k/3k/4k | headless/MCP 路缺 `size`（UI 经档案填，MCP 不暴露 params） | mapping `defaultParams` 兜底机制 + 该 op 声明 `size:2048x2048` |
| 4 | apimart 配音 nomi-audio | HTTP 500 model is required | 同上：缺 `model` | `defaultParams:{model:gpt-4o-mini-tts,voice:alloy}` |
| 5 | 豆包语音 doubao-seed-tts-2.0 | 「未选择音色」 | 同上：缺 `voice` | `defaultParams:{voice:zh_female_vv_uranus_bigtts}` |

> #3-5 同一根因：**headless/MCP 路从不填档案默认参数**。一处机制(`HttpOperation.defaultParams` + runtime 并入 extras 之下 + seed 强制对账同步)解决整类。回归锁：`onboardingSweepFixes.test.ts` 7 例。

**附带挖到的更深一层**：headless host 启动**从不调 `ensureBuiltinModelSeeds`**（只 GUI 启动调），导致代码改了 curated mapping 后**只有开过 GUI 才同步到目录**，纯 MCP/CLI 用户会跑旧目录。本次靠「下次开 GUI 自然对账」交付（#3-5 的 defaultParams 随之生效）；**host 端自动对账**因有 userData 路径解析坑(写到了 `Electron/` 空目录)暂未并入，单列 backlog（见下）。

### B. 用户配置/账号级（非代码，待用户处置）

| 模型 | 现象 | 处置 |
|---|---|---|
| **kie 全部**(gemini-omni/gpt-image-2 ×2/seedream/nano-banana/seedance/happyhorse/kling) | `API key missing: kie` | kie **没存 API key** → 需用户补 key，否则这些不算「已接入」 |
| **runninghub 全部**(3D ×3 + 视频 ×6 + 图片 ×4) | `API key missing: runninghub` | 同上，runninghub 没存 key |
| 火山 Seedream 4.5 / 4.0 | HTTP 404 account has not activated the model | 用户需在火山 Ark 控制台**开通**这两个模型（5.0 已开通可用） |

### C. 待查（超时，需 app 关闭后长超时复跑）

| 模型 | 现象 | 怀疑 |
|---|---|---|
| code-newcli-com/gpt-image-2 | 200s×3 超时 | 真慢(>200s)或卡住；真机默认 360s |
| apimart/imagen-4.0 | 200s×3 超时 | 同上 |

### 成功（连接健康，18）
text 全部(claude-fable-5/deepseek-v4-pro/gpt-5.5/moonshot/Qwen3 ×3)；apimart 图(seedream-4.5/gemini-flash/z-image-turbo/gpt-image-2)；modelscope 图全部(Z-Image-Turbo/Qwen-Image/FLUX.2-klein/FLUX.1-Krea/Z-Image/majicflus/Qwen-Image-Edit)。

## Live 复测（app 关闭后，headless）——四修全验证

| 修复 | 结果 |
|---|---|
| 火山 Seedream 5.0 size | ✅ **真出图**（size 默认生效，defaultParams 已落 nomi 目录）|
| apimart 配音 model | ✅ **真出 .wav**（model 默认生效）|
| 豆包语音 voice | ✅ 过了「未选择音色」→ 现卡**凭证格式**(需 APP_ID:ACCESS_KEY，用户配置)|
| dreamina --download_dir | ✅ 过了「unknown flag」→ 现卡 **VIP/credit**(账号 credit=0、无 vip，用户配置)|
| host seed 对账 | ✅ 补后 defaultParams 同步进 nomi 目录(此前 ABSENT)，已推 `135991f2` |

## Pass 2（video + model3d，22 模型）已完成 — 扫出**视频 headless 缺参**类

汇总：**8 连接错 / 14「其他」**，无一进真生成。逐类：

| 类 | 模型 | 现象 | 性质 |
|---|---|---|---|
| **视频 headless 缺参**(新根因类) | apimart sora-2/veo/seedance/hailuo（用 VARIANT_MODEL_REF）| HTTP 400 **Model name is required** | 同 audio 那类：headless 不填档案变体 model；但值在 src/config 档案里(electron 够不着) |
| 同上 + 类型 | apimart kling-v3 | HTTP 400 duration **string≠int** | 视频 body duration 模板渲染成字符串，apimart 要 int |
| 同上 | volcengine doubao-seedance | HTTP 400 missing `model` | headless 不填 model |
| 无 key | kie 视频 ×3 / runninghub 视频 ×6 + 3D ×3 | API key missing | 用户配置(已拍：留着别动) |
| VIP | dreamina 视频 ×2 | exit=1（credit=0/无 vip）| 用户配置 |

> **视频 headless 缺参**是 #3-5 同一根因的延伸，但**铺得更广**：每个视频档案各有 model 变体 + duration(要 int) + resolution/ratio，值都在 `src/config/modelArchetypes`（renderer 侧，electron rootDir 隔离够不着）。逐 op 加 defaultParams=可行但要复刻每个档案的值(脆 + 多)；**根治应是「档案默认参数下沉成 electron 也能读的共享源」一次性桥接**（架构改动）。这是个有取舍的架构岔路 → 待用户拍板范围，不擅自大重构/不堆脆补丁。

## 全量复跑（app 关闭 + 沙箱隔离 + runninghub key 已接入，59 模型逐个真跑，81min）

> harness v2：每模型一个全新项目（绕开 headless「同项目 >3 次生成偶发 项目不存在」坑，见下 backlog），串行 + 网络重试，沙箱隔离（独立 NOMI_SETTINGS_DIR/PROJECTS_DIR 复制目录）。

汇总：**20 成功 / 15 no-output(提交成功但 240s 内没取回结果) / 18 连接错 / 6 其他**。

- **成功 20**：所有有 key 的 vendor 的 text/image/audio——code-newcli(fable-5)、modelscope(全部图+文本)、apimart(deepseek/seedream-4.5/gemini-flash/gpt-image-2/z-image/**nomi-audio**)、dm-fox、moonshot、火山 Seedream **5.0**(size 修生效)、Qwen-Image-Edit。本轮修复全部 live 复验通过。
- **runninghub 全部 no-output（13）**：key 已生效**提交成功**(不再 key missing)→ 返 `queued`，但 240s headless 轮询上限内没取回结果。runninghub(ComfyUI)队列慢，**根因=headless 轮询上限太短**，非连接断。已修：`NOMI_POLL_TIMEOUT_MS` 可调大轮询上限（核 core.ts）。
- **apimart/火山 视频缺参（8 连接错）**：`Model name is required`(VARIANT_MODEL_REF 模型不填 model) + `duration string≠int`——headless 缺档案参数类，待**档案默认桥接**（已有 plan，用户已选根治 A）。
- **慢图 2 个 no-output**：code-newcli/gpt-image-2、apimart/imagen-4——同轮询上限问题（提交成功未取回）。
- **配置缺口（用户已拍留着）**：kie 全部(no key)、火山 4.5/4.0(未在 Ark 开通)、豆包语音(凭证格式 APP_ID:ACCESS_KEY)、dreamina(账号非 maestro vip)。

## Backlog（接入测试 v2 新增）
- [ ] **档案默认桥接到 electron**（根治 headless 视频/慢模型缺参，用户已选 A，plan: docs/plan/2026-06-30-headless-archetype-defaults-bridge.md）。
- [ ] **headless 项目 poison**：同项目 MCP 生成 >3 次后**偶发**永久「项目不存在」（注册表+manifest 都在却 readWorkspaceProject 返 null）。仅 headless 磁盘网关路；GUI 渲染层网关不受影响。**setPath userData 修复后 48+ 次连续/并发生成未复现**，根因未钉死（非确定性，疑早期 userData 漂移+共享注册表脏态）。保留观察，多 agent 大流量测试时若复现即现场抓。
- [ ] runninghub 轮询上限默认值是否该按 vendor 调（现 env 可调）。

## 多 agent 完整用户测试（3 路并行真实旅程，独立沙箱）

三个「真实用户」agent 各跑一条端到端旅程，记录顺/卡/困惑/报错：

| Agent | 旅程 | 结果 |
|---|---|---|
| 1 | 角色设定（生成→改词→变体） | 功能链路全绿、出图质量高；但**一致性靠手写提示词硬背**（无角色锁）、改词不标 stale、尺寸/画风不可控 |
| 2 | 三镜头分镜（同主角） | 三次生成+连线全绿，但**三个不同的女孩**——连线对一致性零作用 |
| 3 | 改图+配音 | 配音✓（真 wav）；**改图走不通**（连了参考边，生成仍 400「需要参考图」） |

**三路收敛到同一头号根因（已修+真机验证，commit）**：**headless generate 从不读画布参考边**——只读 `input.references`/`node.references`，GUI 走渲染层把边归一进 node.references 再发，headless/CLI/MCP 直发绕过它 → 连线=空承诺（对齐记忆 `connection-reference-bugs` 的槽/边分裂在 headless 仍未收口）。修：references 为空时兜底从参考类入边解析源节点产出（core.ts `referencesFromEdges`）。验证：连图→改图节点→生成，改图成功取到参考（此前 400）。

**其余 agent 情报（非 bug / 产品向，记一笔）**：
- **URL/磁盘目录口径**：asset url 用稳定 `workspace-<id>`，磁盘是 `名字-slug-hash`——**by design**（url 经 registry `resolveProjectRelativePath` 解析，便携抗改名）；不是 bug。但与 poison 共享「registry 解析 id」依赖。
- 改词不标 node stale、CLI 无尺寸/比例参、同 prompt 家族画风漂移、无角色身份锁 → 都指向 Nomi 战略招牌「跨镜身份/显式版本」空白（产品级，非表面 bug）。
- CLI 无参时报「项目不存在」误导（应打 usage）；失败留孤儿节点无回收（小 UX）。
- **poison 未复现**：三 agent 各 3-4 次生成均未触发（仍非确定性）。

## 结论
- **UI 路视频正常**（档案在 UI 填好 model/duration）；本类只伤 **headless/MCP 视频**。
- 连接健康面：text/image/audio（连接齐全的 vendor）headless 全通；image/audio 的缺参已修验。
- 真正的连接级代码 bug（dreamina flag）已修；其余视频失败是「headless 缺参类(待架构决策)」或「用户配置(已拍留着)」。

## Backlog
- [ ] **headless host 自动 seed 对账**：补 `ensureBuiltinModelSeeds` 进 host 启动，但先解决 userData 路径解析(写到 `Electron/` 空目录)+并发短命 host 写竞争。否则纯 MCP 用户更新后跑旧目录。
- [ ] Pass 2（8 视频）+ #2-5 四修的 live 复测（app 关闭后）。
- [ ] #C 两个超时长超时复查。
- [ ] 产品决策：keyless vendor(kie/runninghub)的模型是否还该出现在「已接入」列表（现在用户看得到但必失败）。
