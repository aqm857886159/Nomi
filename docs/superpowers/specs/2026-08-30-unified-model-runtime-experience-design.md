# Nomi 统一模型、运行时与多模态资产体验设计

日期：2026-08-30  
状态：方案冻结候选，按阶段实现  
基线：`origin/main @ 491d670a`，已包含 PR #188 与 PR #221

用户范围决定：保持现有页面导航、供应商优先选择和交互逻辑，不做信息架构重排。所有新能力通过现有 Catalog、模型设置、画布节点、任务中心和素材组件增量出现。

## 1. 这份方案统一什么

这不是单独的 3D Viewer 方案，也不是单纯增加几行模型目录。它把最近两次核心交付与本轮新信息合成一个完整产品闭环：

- PR #188 已证明专用供应商、官方本机 CLI、媒体任务和 Catalog 可以进入同一生产工作区。
- PR #221 已建立对话式模型接入、安全凭据、真实认证、持久发布、MCP 与手工设置共用的 canonical 边界。
- 本轮补充当前旗舰云模型、音乐/音效/语音/3D、LocalAI 外部运行时和统一异步任务合同。
- 页面层只补新模型能够真实生成、恢复、预览和下载所需的缺口，不重做现有连接与创作流程。

最终产品不是一个供应商列表，而是：

> 用户可以先选择自己信任和付费的供应商渠道，再按能力选择该渠道中的旗舰模型；当用户明确交给 Agent 自动编排时，Nomi 才从已认证路线中代为选择，并把结果变成可继续编辑的项目资产。

## 2. 已有能力与真实缺口

### 2.1 当前已经存在

- 12 个内置 Catalog supplier、92 个模型、136 条 mapping。
- 本轮实现后的静态结果是 15 个 supplier、106 个模型、151 条 mapping；图片 38、视频 36、文本 16、音频 12、3D 4。
- PR #221 的 IntegrationSession、ConnectionCertification、可信凭据 UI、真实模式认证和 MCP 工具。
- PR #188 的 Antigravity/Agnes 专用连接、生产媒体执行和设置页入口。
- 统一画布节点、任务中心、项目资产落盘和下载能力。
- `model3d` 生成节点与基于 Three.js/R3F 的 GLB 卡内预览，支持旋转、缩放和自动取景。
- 图片、视频、音频素材库及预览；视频和音频可继续进入时间轴。

### 2.2 仍未形成闭环

- 供应商任务的未知状态过去可能被误当成功；reconcile/cancel 虽有局部定义，但没有完整贯通生产入口。
- 音频 Catalog 只有一个粗粒度 `audio` 类型，音乐、音效、语音与转写在用户任务和生命周期上没有完整分层。
- 3D 已能在画布节点中预览，但素材库的 `AssetKind` 仍只有 image/video/audio；GLB 不会进入统一素材筛选、全屏预览和资产信息流程。
- 3D 临时 CDN URL 的启动后补救逻辑仍只覆盖 image/video，签名 GLB 必须在首次返回时可靠本地化。
- LocalAI 没有设置页连接体验；当前新增代码只到 external descriptor 和 probe。
- 模型选择仍容易把“模型”和“调用渠道”混在一起；同一模型通过官方、KIE、APIMart 或本地运行时调用时，用户难以比较和理解。
- 旗舰模型资料已有研究结论，但还没有全部变成 seed、archetype、mapping、连接页文案和真实认证证据。

## 3. 产品对象：供应商渠道、能力、模型三层分开

用户不需要理解 provider 协议，但必须看得见实际付费和传输数据的渠道。产品稳定区分三种对象：

| 对象 | 用户问题 | 例子 | 真相源 |
|---|---|---|---|
| 供应商渠道 Provider route | 密钥、费用和数据发给谁 | ElevenLabs 官方、KIE、APIMart、LocalAI | verified connection / executor |
| 能力 Capability | 我要做什么 | 音乐、音效、配音、视频、图生 3D | archetype / verified mode |
| 模型 Model | 用哪个生成器 | Suno V5.5、Meshy 7、Gemini Omni 1.1 | Catalog model + version evidence |

手工设置和创作界面的默认顺序是 `供应商渠道 -> 能力 -> 模型`。这是因为供应商决定凭据、余额、价格、隐私边界、可用区和真实接口合同，不能在用户不知情时被 Nomi 静默替换。

同一个模型可以有多条路线，但每条路线仍是独立的可执行身份。用户先选 KIE 或 APIMart，再看到该渠道实际认证过的 Suno V5.5；界面可以提示“另一个已连接渠道也提供此模型”，但切换必须由用户确认。只有在 Agent 自动编排或用户选择“自动”时，Nomi 才跨渠道比较并代选。

Nomi 推荐和自动选择必须满足：

1. 只有已认证 mode 可以进入普通模型选择器。
2. 当前旗舰优先，旧版本不因数量多而排在前面。
3. 官方直连、聚合平台和本地运行时不互相冒充。
4. 模型名、版本和契约必须精确。APIMart `gemini-omni-flash-preview` 不得显示成 KIE `google/gemini-omni-flash-1-1`。
5. 默认不越过用户当前选择的供应商；跨渠道自动选择必须是用户显式选择的模式。
6. 推荐理由来自能力证据、用户偏好和实测结果，不把供应商宣传写成客观排名。

## 4. 本轮模型与供应商范围

### 4.1 立即接入的旗舰集合

| 路线 | 模型 | 用户能力 |
|---|---|---|
| MiniMax 官方 | `MiniMax-M3` | 文本与 Agent 模型 |
| MiniMax 官方 | `MiniMax-H3` | 原生音视频生成 |
| MiniMax 官方 | `speech-2.8-hd` / `speech-2.8-turbo` | 成片配音 / 快速试听 |
| ElevenLabs 官方 | `eleven_v3` | 高质量语音 |
| ElevenLabs 官方 | `music_v2` | 音乐 |
| ElevenLabs 官方 | `eleven_text_to_sound_v2` | 音效 |
| ElevenLabs 官方 | `scribe_v2` | 转写 |
| Meshy 官方 | `meshy-7` | 单张图片生成带纹理 GLB |
| KIE | `google/gemini-omni-flash-1-1` | 多参考、最高 4K 的音视频生成 |
| KIE | Suno `V5_5` music / sounds | 音乐与音效 |
| APIMart | Suno `v5.5` music / sounds | 音乐与音效备选路线 |
| APIMart | `flowmusic` + `lyria-3.5` | 音乐备选路线 |

当前 12 个内置 supplier 增加 MiniMax、ElevenLabs、Meshy 后，静态内置 supplier 为 15 个。KIE、APIMart 是扩模型，不增加 supplier 数量；Replicate 保持既有元素拆解路线。LocalAI 是一个内置“连接器类型”，用户连接后动态形成运行时/模型路线，不用虚假的预置模型把 supplier 数量凑成 16。

Meshy 的加入不是因为“3D 必须用 Meshy”，而是它提供当前可核实的官方单阶段 `image-to-3D -> poll -> model_urls.glb` 合同，用户不需要 RunningHub Enterprise-Shared Key。Nomi 只接 Meshy 7 单图生 3D；两阶段 text-to-3D、纹理包和其它格式留到资产包/工作流合同成熟后。fal 和 Replicate 的广泛媒体目录有价值，但统一队列不等于统一模型请求与输出，本轮不把未逐端点认证的长尾目录塞进选择器。

### 4.2 暂不接入

- APIMart Gemini Omni Preview：不是 KIE 的 1.1 契约。
- MiniMax Music 3.0：2026-08-20 后不再向新 API 用户开放。
- Meshy 文生 3D：preview/refine 两阶段超出当前单任务合同。
- fal 与 Replicate 的广泛媒体扩充：保留下一轮；每个精选端点必须分别核对请求、输出和付费认证，不能仅凭统一队列合同批量宣称可用。
- Hugging Face Inference Providers：大生态保留为 P1；非聊天任务不是现有 OpenAI-compatible 通道可直接复用的单一合同，且当前官方矩阵不覆盖音乐和 3D。
- Hi3D 3.0：官方 API model key 尚未核实，不猜测写入生产目录。
- 旧模型和“雷达扫到但没有可执行合同”的长尾条目。

### 4.3 后续旗舰雷达

- Tripo v3.1：文生和图生均为单阶段 create/poll/GLB，可作为下一条 3D 路线。
- Hunyuan3D 3.1：优先补多视图输入，而不是增加重复版本。
- Hi3D 3.0：拿到官方可调用 model key 后进入合同 smoke。
- 每次版本更新都先进入 radar 和隔离认证，不自动替换用户当前已验证的生产模型。

## 5. 页面与交互范围

本轮冻结现有页面逻辑：不新增模型中心、不重排设置首页、不改变供应商优先选择、不增加跨供应商比较页，也不把音频节点改成新的分段工作台。

### 5.1 模型与供应商视觉身份

现有选择顺序不变：先选模型族；同一模型有多家渠道时再锁定供应商；最后编辑参数。识别增强只进入已有控件：

- 内置供应商在供应商触发器和下拉列表中使用本地打包的品牌 Logo。
- 已识别模型在模型触发器和下拉列表中使用本地打包的模型品牌 Logo。模型 Logo 表示模型品牌，供应商 Logo 表示实际调用渠道，两者不互相冒充。
- 用户自接或无法识别的模型/供应商使用稳定的通用本地图标和 catalog 名称。Nomi 不远程抓 favicon，避免泄露使用行为，也避免网络失败导致选择器抖动。
- 不增加代际徽标，不调整参数面板、比例画框、时长控件或摘要栏；模型新旧只影响排序和默认选择，不增加视觉负担。
- Logo 不是新控件，不改变选择行为，也不新增常驻操作位。

新能力通过现有入口增量出现：

- MiniMax、ElevenLabs、Meshy 使用现有已知供应商连接页、凭据保存和 PR #221 certification 流程。
- KIE、APIMart 的新模型按现有供应商分组进入模型选择器；Replicate 保持现有入口。
- LocalAI 复用现有“添加供应商 / OpenAI-compatible”流程；connector 在后端识别 LocalAI 并增强发现证据，不增加一套专用页面。
- 现有模型详情、任务中心、节点生成状态和下载按钮继续使用，只接入新的状态和产物类型。
- Agent 发起的连接仍复用 PR #221 的 handoff，不新增 Agent 接入页面。

允许的 UI 改动只限于新能力无法使用时的必要增量：

- 在现有状态位置显示 LocalAI 的就绪、启动中、未授权或离线。
- 在现有供应商和模型列表中增加新条目、准确版本与已认证状态。
- 让 `model3d` 进入现有素材类型、预览和下载组件。
- 增加缺失的本地化文案、错误状态和无障碍标签。

LocalAI external connector 的行为仍必须满足：

1. 公开发现请求不携带密钥。
2. 探测顺序为 `/.well-known/localai.json` -> `/readyz` -> `/v1/models/capabilities` -> `/v1/models`，旧版本可补 `/version`。
3. discovery 只表示后端声明能力，不能直接冒充生产认证。
4. `/system` 不作为普通用户连接成功条件。
5. 跨域 endpoint、重定向和超大响应被拒绝，密钥不转发到新 origin。
6. 文本复用已有 OpenAI-compatible Pi/AI SDK 路线；不复制聊天管线。

## 6. 新模型如何进入现有创作流程

手工创作继续沿用当前顺序：

```text
供应商渠道 -> 该供应商的模型 -> 现有模式和参数控件
```

- 音乐、音效和配音继续使用现有 audio 节点及声明驱动参数。模型所需参数由 archetype/mapping 投影，不新造节点页面。
- Suno/Lyria 的异步接口进入现有任务中心；ElevenLabs 同步二进制接口仍走现有即时结果路径。
- 3D 继续使用现有 `model3d` 节点和 `Model3DViewer`；Meshy/RunningHub 的 3D mapping 共享同一图片引用槽和 GLB 本地化合同。
- Agent 遵守用户已选择的供应商；未指定时可以从 verified catalog 选择，但费用确认仍显示最终供应商和模型。
- 新模型若尚未认证，沿用现有设置和认证引导，不改变当前节点/模型选择器的导航逻辑。

## 7. 任务中心：云端和本地共用一套诚实状态

共享状态固定为：

```text
queued -> running -> succeeded
                  -> failed
                  -> cancelled
                  -> unknown
```

在用户界面中，物化过程继续细分显示为“正在下载”“正在校验”“正在保存”，但 provider 原始字符串不能直接决定成功。

任务行显示：

- 任务类型和模型名称。
- 当前路线，例如 `Meshy 官方`、`KIE`、`LocalAI · 本机`。
- 排队/生成/下载/校验状态与已用时间。
- 可执行动作：查看、取消、重试或处理问题。

取消必须如实呈现：

- `已取消`：远端确认取消。
- `取消请求已发送`：尚未确认。
- `无法取消，任务已运行`：provider 明确 too late。
- `该路线不支持远端取消`：用户可以从 Nomi 脱离跟踪，但不能冒充退款或远端停止。

网络断开或应用重启后先 reconcile；`indeterminate` 不自动重提付费任务。未知状态进入“需处理”，绝不进入资产物化。

## 8. 结果与素材库

### 8.1 所有最终产物先本地化

供应商签名 URL 只是运输地址，不是项目资产。图片、视频、音频和 GLB 都必须在 URL 有效期内：

1. 有界下载到 staging。
2. 校验 Content-Type、magic bytes 和格式结构。
3. 用对应解码/导入器验证。
4. 写入 Nomi 管理资产并记录来源。
5. 节点和素材库只把本地 managed URL 作为主地址。

### 8.2 音频可用层

- 素材库按 `音频` 管理，详情中显示其语义类型：配音、音乐或音效。
- 预览提供播放、暂停、进度、时长和音量；真实波形可作为后续增强，首版不能用装饰波形冒充内容分析。
- 音乐、配音和音效均可拖入时间轴；转写 JSON/文本作为伴随产物进入项目文件或字幕流程，不伪装成可播放音频。
- 来源信息继续使用现有生成记录/provenance，不新增音频详情页面。

### 8.3 3D 可用层

素材库的 `AssetKind` 增加 `model3d`，但时间轴仍只接受 image/video/audio。

3D 素材块使用稳定的立方体占位或已有 poster，不在小素材块中启动 WebGL。预览复用现有 `AssetPreviewDialog` 外壳和 `Model3DViewer`，不新增独立 3D 详情页面。

首版必须具备：

- GLB 加载、结构校验、旋转、缩放、平移或明确禁用、重置视角。
- 自动取景和稳定光照，不依赖远程 HDR。
- 加载中、损坏、GPU/WebGL 不可用的明确状态，并始终保留下载动作。
- 下载 GLB，并沿用现有节点来源记录和生成变体操作。

首版不做材质编辑、网格编辑、骨骼、动画时间线或 Blender 级功能。Meshy 返回的 FBX/OBJ/USDZ/纹理包在后续资产包设计中处理，本轮主资产只认证 GLB。

## 9. Agent 体验

内部 Pi、Antigravity 类专用入口与外部 Codex/Claude/OpenCode 都调用同一个 Nomi domain service。

典型对话：

```text
用户：用我这张产品图做一个 3D 模型，再配一段 8 秒音效。

Agent：
1. 识别 image-to-3D 与 sound-effect 两个能力。
2. 遵守用户指定的供应商；未指定且允许自动选择时，才从 verified catalog 选择 Meshy 7 与 Eleven SFX v2，偏好本地时检查 LocalAI 认证能力。
3. 进入同一预算/权限确认。
4. 创建两个可观察任务，并把产物写入同一项目。
5. 返回可编辑的 3D 节点和音频节点，而不是两个临时 URL。
```

当模型未连接时，Agent 只能发起 integration session 并引导用户进入 trusted UI，不能在聊天中索要密钥。Agent 所说的“已接入”必须对应真实 verified mode 和持久化证据。

## 10. LocalAI 对产品体积和系统的影响

external 模式只增加 descriptor、probe、连接配置和适配调用，代码体积很小；不把以下内容打进安装包：

- LocalAI 二进制和容器。
- Python/CUDA/ROCm/vLLM 等后端。
- 任意模型权重。
- 模型下载器和进程托管器。

因此本轮不会让安装包增加数 GB，也不会自动占用 GPU。代价是用户需要先自行启动 LocalAI，Nomi 只能诊断连接，不能承诺替用户安装、升级、启动或修复服务。

managed sidecar 是后续独立产品决策，必须另行解决安装包、签名、磁盘预算、GPU 兼容、进程升级和卸载，不与 external connector 混写。

## 11. 技术边界

```text
Nomi UI / Internal Agent / External MCP
                  |
       Integration + Capability Core
                  |
          ProductionRun control plane
    permissions / budget / idempotency / recovery
                  |
       Unified Generation Runtime Adapter
      /             |               \
 official APIs   aggregators     local runtimes
 MiniMax/...     KIE/APIMart    LocalAI/ComfyUI
                  |
       materialize + verify + managed asset
                  |
       canvas / asset library / timeline
```

边界不变量：

- Catalog 是已发布模型与 mapping 真相源，runtime discovery 只是候选证据。
- ProductionRun/现有任务账本和资产存储继续做唯一控制面，不新增 LocalAI 专用任务表或 3D 专用资产库。
- LocalAI、ComfyUI 和云供应商可以有不同 executor adapter，但对上输出同一状态、reconcile、cancel 和 materialize 语义。
- Provider route 不拥有用户项目、预算审批或资产最终状态。

## 12. 分阶段交付

### 阶段 A：共享合同与旗舰目录

- 完成规范化状态、三态 reconcile、诚实 cancel、异步音频和 `model3d` GLB 物化。
- 增加 MiniMax、ElevenLabs、Meshy，以及 KIE/APIMart 旗舰 mapping。
- 增加 LocalAI external descriptor/probe，不宣称媒体执行已认证。
- 修 model radar delegated index，保留模型时点证据。

退出条件：provider-neutral 合同测试、每个 mapping 的 loopback fixture、seed 幂等测试、类型检查与 Catalog 生成器全部通过。

### 阶段 B：LocalAI 接入现有连接流程

- LocalAI probe 接入 `HttpProviderConnector` 和现有 IntegrationSession discover/certification。
- LocalAI 复用当前 OpenAI-compatible 添加供应商和模型发布流程。
- 云供应商继续复用 PR #221 认证流程；模型选择器保持当前供应商优先逻辑。

退出条件：401、503 startup、offline、旧 LocalAI 和部分认证都投影为现有页面可表达的稳定状态；不产生新导航分支。

### 阶段 C：音频与 3D 产物闭环

- 音乐、音效、语音和转写通过现有 audio 节点及声明参数执行。
- 3D 进入现有素材库类型、过滤和预览；复用当前 GLB Viewer 与下载能力。
- GLB 与异步音频进入 managed asset、下载和 fresh-process readback。
- 任务中心贯通真实 cancel/reconcile。

退出条件：真实用户旅程能从模型选择到本地资产完成，并在应用重启后继续预览和下载。

### 阶段 D：真实认证与发布门

- 使用用户明确授权的真实凭据分别做最小付费 smoke；没有凭据的路线保持 `configured, unverified`。
- LocalAI 至少完成文本真调用；媒体 executor 只有在固定版本合同通过后才发布。
- Meshy GLB、Suno/Lyria 异步音频、Eleven 同步二进制和 H3 音视频分别验证。
- 完成安装包、MCP、Electron、重启恢复与升级读回测试。

## 13. 测试和验收矩阵

| 层 | 必测内容 |
|---|---|
| 纯合同 | 状态归一、unknown 禁止物化、reconcile 三态、cancel 五种 disposition、asset kind |
| HTTP loopback | 正常、401、429、503、超时、断连、异常 JSON、超大响应、跨域重定向、签名 URL |
| 媒体验证 | GLB header/chunk/长度、音频可解码和时长、视频容器/视频轨/需要时的音轨 |
| Catalog | 15 个 supplier、精确 model id、版本不混淆、mapping 参数、重复播种不覆盖用户配置 |
| UI 单测 | 状态投影、任务分组、route 显示、3D filter/preview fallback、音频任务分段 |
| Electron journey | 连接 -> 认证 -> 选择 -> 生成 -> 任务中心 -> managed asset -> 重启读回 |
| 安全 | 密钥不进 renderer/MCP/log，公开探针不带 auth，跨 origin 不转发 auth，私网 scope 需确认 |
| 视觉 | 1280x800、1440x900 和窄窗口；中英文；明暗主题；无重叠、截断和 WebGL 空白 |

3D Electron 验收必须包含截图和 canvas 像素检查，证明模型非空、自动取景正确、旋转后画面变化，并验证 WebGL 不可用时仍可下载。

## 14. 完成定义

“完成”不是 seed 出现在 JSON，也不是连接探针返回 200。每条发布路线必须满足：

```text
可信连接
-> 精确模型和 mode
-> 用户确认权限/成本
-> 正式 submit
-> query/reconcile/cancel
-> 有界下载与格式验证
-> managed asset
-> 画布/素材库可见
-> 重启后可读
-> Agent 与手工入口得到同一结果
```

在没有真实凭据或硬件时，自动化可以证明合同和 UI，但最终状态只能写“已实现、待真实认证”，不能写“生产可用”。

## 15. 非目标

- 不把 Nomi 做成模型权重下载器或 LocalAI 安装器。
- 不创建第二个模型设置中心、任务账本或资产库。
- 不替换现有 Pi，也不在本轮升级整个 AI SDK Harness。
- 不把 ComfyUI 绕进 LocalAI；两者保持直接 adapter。
- 不做专业 3D 建模编辑器。
- 不改变现有模型设置、供应商优先选择、画布节点或任务中心的页面逻辑。
- 不为了供应商数量加入弱模型或没有生产合同的模型。
