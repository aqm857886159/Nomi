# Velorn 深挖：剪辑轴 + ComfyUI 深度集成轴（源码级）

> 日期：2026-09-09 · 对象：[VelornLabs/velorn](https://github.com/VelornLabs/velorn)（472★，AGPL 系，桌面版，React+Electron，纯 JS 无 TS）
> 方法：586 文件树全列 + `src/services/` 86 个服务逐类清点 + 关键文件源码实读（agentTools/workflowDependencies/comfyLauncher）
> 关联：[agent 原生剪辑版图](2026-09-09-agent-native-video-editing-landscape.md) §6.2、[剪辑栈底层分析](2026-09-09-nomi-editing-architecture-analysis.md)

---

## 一、总体判断

Velorn 是**唯一在两个轴上同时与 Nomi 对位**的开源对手：剪辑轴（真实时间轴+agent 工具）和生成轴（ComfyUI 深度集成）。它的两个结构性选择与 Nomi 相反，值得逐条评估：

1. **「一切皆 workflow JSON」**：本地 ComfyUI 图和云 API（OpenAI/Kling/Seedance/ElevenLabs/Grok/Gemini 的 `api_*.json`，`public/workflows/` 42 个）共用同一套 workflow 绑定/执行模型。统一性强，但把 66 家供应商的参数个性压进了 workflow 模板。
2. **ComfyUI 是宇宙中心**（带进程启动器+依赖包安装），Nomi 把 ComfyUI 当多供应商之一。

## 二、剪辑轴（`src/services/` 86 服务清点）

**Agent 工具面**（`agentTools.js`，读/写分模式，约 100+ 工具）：
- 读：`get_project` / `get_timeline(includeClips,limit)` / `get_assets(filter)` / `inspect_clip`（含 transform/effects/keyframes 全量）/ `find_timeline_items`（按 kind/status/timeRange/query） / `analyze_timeline`（**健康摘要**：clip 数、禁用片段、缺资产——一工具给全局体检）
- 写：clips（move/trim/delete/duplicate/replace/enable）、tracks CRUD、transitions、text/shape/solid/**adjustment clip**、**GLSL 特效**（list/add/update/remove）、**关键帧**（`set_clip_keyframes`）、dip-to-black、markers、多时间轴 CRUD、**checkpoint**（`create/restore_project_checkpoint`）
- **生成↔剪辑互操作**（Nomi 最该借的一组动词）：`prepare_generation_from_timeline_context`（从时间轴上下文准备生成任务）→ `queue_prepared_generation` / `queue_timeline_generation_batch` / `queue_h3_reference_video` / `queue_prompt_generation_batch`
- 导出：`export_timeline` / `export_fcpxml`（另有 `fcpxmlImporter.js` / `premiereXmlExporter.js` 双向专业 interchange）

**渲染/性能栈**：`gpuCompositor.js`（GPU 合成）+ `clipRenderCache`/`previewCache`/`renderCache`/`proxyCache`/`playbackCache` 五级缓存 + `opticalFlowCache` + `rtxVideoUpscale`/`topazVideoUpscale`（商业放大器集成）+ `exportWorkerLifecycle`（worker 隔离导出）+ `thumbnailSprites`（时间轴缩略图精灵图）。

**字幕/音频**：双路转写（`captionLocalTranscription` + `captionComfyTranscription`——**ComfyUI 也能当 ASR 跑**）+ 词级时间（`captionWordTiming`）+ 热词表（`captionVocabulary`）+ `audioMixerGraph`/`timelineAudioMix`/`audioAnalysis`。

**剪辑轴对照 Nomi**：

| 维度 | Velorn | Nomi | 判定 |
|---|---|---|---|
| 内核纪律 | 工具直改 store，无对等确定性内核/CAS | `timelineKernel` 10 原语+CAS+diff+validate | **Nomi 胜**（可测性/组合爆炸） |
| Pro 特效面 | GLSL per-clip、关键帧、adjustment clip、Topaz/RTX 放大、五级缓存 | framing/clipAudio/transitions，无关键帧无 GLSL | Velorn 胜（pro 深度） |
| 生成↔剪辑互操作 | `prepare_generation_from_timeline_context` + 批量队列 | 画布节点→落轴，反向（从轴上下文生成）无专用动词 | **可借**（见 §四） |
| checkpoint | 一等工具 | 编辑器撤销有，agent 无版本工具 | 对齐方案 F' |
| interchange | FCPXML 双向+Premiere XML 出 | 无 | 对齐方案 F' |

## 三、ComfyUI 深度集成轴（对 Nomi 最有信息量的部分）

Velorn 的 ComfyUI 栈分五层（全部实核）：

1. **进程生命周期**：`comfyLauncher.js`（electron 侧）+ renderer 客户端——**打包/启动/监管 ComfyUI 进程**（launcherMode: script/macApp、ownership、pid、日志环形缓冲 2000 行、pub/sub 多组件共享状态）。Nomi 明确不捆绑不启动 ComfyUI（`ARCHITECTURE-NOW.md:62`：external connector，模型进程用户自管）——**这是产品哲学分叉，不是能力差距**。
2. **图与绑定**：`comfyWorkflowGraph.js`（图操作）、`importedWorkflowBindings.js`+`comfyAutoImport.js`（导入工作流的输入绑定）、`getInputSpec`（从节点 schema 的 `input.required[key]` 提取 values/choices/enum，**jsonata 表达式**驱动，`workflowDependencies.js:31-58`）——与我们「工作流与 `/object_info` 对账」同源，但它把输入规格提取做成了通用 jsonata 管线。
3. **依赖治理**：`workflowDependencies.js` + `config/workflowDependencyPacks`（**依赖包**概念：按 workflow 声明所需节点/模型组）+ `workflowInstallJobs.js` + `workflowSetupManager.js`（安装任务队列）。我们的「运行前缺件预检」到此为止；Velorn 往前多走一步——**缺什么就排队装什么**。
4. **安全/审计**：`comfyPromptGuard.js`（提示词守卫）+ `comfyPartnerAuth.js`（伙伴认证）+ `comfyCreditsPerUsd` 换算（成本显示）。
5. **ComfyUI 当万能执行器**：`captionComfyTranscription.js`（ASR 走 ComfyUI 节点）、`musicGeneration.js`、API 包装层——云模型也伪装成 workflow 节点图，执行/缓存/成本口径统一。

**对照 Nomi**：

| 维度 | Velorn | Nomi | 判定 |
|---|---|---|---|
| ComfyUI 定位 | 宇宙中心（捆绑+启动+安装） | 多供应商之一的 external connector | 哲学分叉；Nomi 的多供应商广度（66 认证条目+任意中转）是 Velorn 没有的 |
| 工作流导入 | 导入+绑定+auto-import+依赖包+安装队列 | 转换常规保存格式+`/object_info` 对账+**运行前缺件预检** | 各有半场；**「缺件→安装任务队列」我们没做** |
| 输入规格提取 | jsonata 通用管线提取 enum/choices | 参考槽/参数体系（typed 更强） | Nomi 类型化更强，Velorn 覆盖面更广 |
| 云模型统一 | 一切皆 workflow JSON | capability/transport 契约体系 | Nomi 的声明式档案更成熟（P4） |
| 成本显示 | credits/USD 换算进 UI | productionRun 预算账本+定价 resolver | Nomi 胜 |

## 四、可借清单（进方案，不动架构）

| 借什么 | 落到哪 | 优先级 |
|---|---|---|
| `prepare_generation_from_timeline_context` 动词族：从时间轴选中区间/缺口语境准备生成任务并批量排队 | lane `canvas-agent` 新工具，执行端走既有生成提交链（`generationSubmission.ts`），产物落画布再采纳桥落轴 | P1（补「从剪辑语境反推生成」的反向动词，Nomi 只有哪些正向的） |
| 缺件→安装任务队列（`workflowInstallJobs` 模式）：缺件预检结果从「红字提示」升级为「一键排队安装/下载」 | ComfyUI 预检链路（`electron/` 现有对账代码）后接安装任务 | P2 |
| `analyze_timeline` 健康摘要工具：一工具返回缺资产/禁用片段/间隙统计 | `read_timeline` 旁加只读工具，agent 排障成本大降 | P1（便宜且高频） |
| checkpoint 语义：与方案 F' 合并（命名版本=checkpoint） | 方案 F' 已覆盖 | 已在计划 |
| 五级缓存清单（preview/render/proxy/clip/playback 分层） | 性能预算对齐参考，不抄实现 | 记录不立项 |

**不建议借**：捆绑/启动 ComfyUI 进程（违背 Nomi 本地优先不监管外部进程的既有承诺与安全边界）；一切皆 workflow JSON（会稀释 Nomi 的 typed capability 契约优势，P4）。

## 五、对总体格局的修正

Velorn 加入后，agent 原生剪辑类目的竞争地图修正为：**OpenChatCut 工具面最广、ChatCut 官方操作纪律最深、Velorn 生成集成最深、Nomi 底层内核与工程纪律最强**。Nomi 的风险不是单点落后，而是「单点最强 × 未接通」——四家都在把各自最强点交付给用户，我们还停在 main 上。这再次收敛到同一路线图：#646 过门（方案 A）→ 第一批 A'/B'。
