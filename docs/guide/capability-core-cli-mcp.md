# 用户指南：用 Claude Code / Codex / Cursor / Pi 在本地驱动 Nomi（CLI + MCP）

> 让你电脑上的 AI 编程助手（Claude Code、Codex、Cursor、Pi…）直接操作你的 Nomi：建项目、往画布加镜头、改提示词、用你配好的模型**真生成图 / 视频 / 文本**，结果落进 Nomi 项目，打开就能看。
>
> 这份是「照着走得通」的完整使用指南。实现原理见 `docs/plan/2026-06-20-capability-core-headless-exposure.md`。

---

## 0. 这是什么 / 适合谁

Nomi 主进程内置了一个**能力核**，把「建工程 / 改画布 / 真生成」做成可被外部调用的接口。两种用法：

- **CLI** —— `node scripts/nomi.mjs <命令>`。适合 Claude Code 用 Bash 直接调、写脚本批量跑。
- **MCP** —— 把 Nomi 挂成 MCP server，Claude Code / Codex 把它当工具，你说人话它自己调。

**开着关着都能用，自动适配**——你不用选模式：

| 情况 | 行为 | 你的体验 |
|---|---|---|
| Nomi **开着** | 走它内部的本地服务（A 模式） | 即时返回 |
| Nomi **关着** | 自动拉起一个无窗口后台 Nomi 把活干完落盘（B 模式） | 命令一样，干完就在那 |

适合：想在终端/编辑器里用一句话指挥 Nomi 干活的人；想把「拆镜头 → 生成」写成脚本跑的人。

---

## 1. 准备工作（一次性）

### 1.1 配好至少一个能用的模型
在 Nomi 里接入并启用至少一个模型，且该模型所属渠道**填了 API Key**（生成要花这个 key 的额度）。用 `nomi models` 可以看哪些模型可用（见下）。

### 1.2 拿 token
外部调用要凭证，防止任意程序偷用你的额度。**正常启动一次 Nomi**（打开 app 即可），它会自动生成：

```
~/.nomi/capability-core/token
```

有这个文件，CLI / MCP 才能调。删掉它，下次启动会重新生成。

### 1.3 验证准备就绪

```bash
node scripts/nomi.mjs status
```

```json
{ "appOpen": false, "endpoint": null, "hasToken": true }
```

`hasToken: true` 就绪。`appOpen` 表示 Nomi 此刻开没开（开着会显示 `endpoint`）。

---

## 2. 完整流程 A —— 用 CLI 从零做一组分镜并出图

> 场景：我要给一支咖啡广告做 3 个分镜，每个镜头出一张概念图。

**① 看有哪些模型可用，挑一个图模型**

```bash
node scripts/nomi.mjs models
```

```json
{ "models": [
  { "vendor": "modelscope", "modelKey": "Tongyi-MAI/Z-Image-Turbo", "kind": "image", "label": "Z-Image-Turbo" },
  { "vendor": "apimart", "modelKey": "gpt-image-2", "kind": "image", "label": "GPT Image 2" },
  { "vendor": "modelscope", "modelKey": "Qwen/Qwen3-8B", "kind": "text", "label": "Qwen3-8B" }
] }
```

**② 建项目**（记下返回的 `id`）

```bash
node scripts/nomi.mjs project create "咖啡广告"
# → { "id": "workspace-xxxx", "name": "咖啡广告" }
```

**③ 批量加 3 个镜头节点**（一次加一个；记下每个返回的 `nodeId`）

```bash
node scripts/nomi.mjs canvas add workspace-xxxx image "晨光中的咖啡杯特写，蒸汽升腾，暖色调"
node scripts/nomi.mjs canvas add workspace-xxxx image "咖啡师拉花的手部特写，浅景深"
node scripts/nomi.mjs canvas add workspace-xxxx image "咖啡馆窗边，一个人捧着杯子微笑，逆光"
# 每条 → { "ids": ["node-aaaa"] } / { "ids": ["node-bbbb"] } / { "ids": ["node-cccc"] }
```

**④ 看一眼画布，确认都加上了**

```bash
node scripts/nomi.mjs canvas read workspace-xxxx
# → { "nodes": [ {id, kind, prompt, status, hasResult}, ... ], "edges": [] }
```

**⑤ 逐个生成**（会花额度，自动轮询到出图）

```bash
node scripts/nomi.mjs generate workspace-xxxx modelscope "Tongyi-MAI/Z-Image-Turbo" image "晨光中的咖啡杯特写，蒸汽升腾，暖色调"
```

```json
{ "nodeId": "node-...", "status": "succeeded",
  "assets": [ { "type": "image",
    "url": "nomi-local://asset/workspace-xxxx/assets/generated/.../image-....png",
    "providerUrl": "https://.../xxx.png" } ] }
```

**⑥ 回 Nomi 看成果**
打开 Nomi → 进「咖啡广告」项目 → 画布上镜头都带上了生成的图（图已落进项目 `assets/` 目录）。

> 想出**视频**：把 `image` 换成 `video`、模型换成视频模型（如 `apimart` 的 `doubao-seedance-2.0`）。视频更慢，命令会自动等更久（最长 5 分钟）。
> 想出**文本**（如让模型写文案）：`generate ... text "..."`，结果在返回的 `text` 字段。

---

## 3. 完整流程 B —— 用 Claude Code（MCP）对话式做

**① 一键接入（推荐）**

打开 Nomi 的「模型接入」→「接入 AI 编程助手」，选择 Claude Code、Codex、Cursor 或 Pi，点击接入。Nomi 会只合并自己的 `nomi` 条目、保留其它 MCP server，并在改写前留下 `.nomi-backup`。接入卡会真正启动配置中的命令做握手，不会只凭“配置里有一行”显示成功。

不要照文档手写一份只有 `NOMI_MCP_STDIO=1` 的配置。当前版本还会为 Claude Code、Codex、Cursor、Pi 分别生成本机签名的 `NOMI_MCP_CLIENT` 与 `NOMI_MCP_CLIENT_PROOF`；证明绑定当前电脑和具体客户端，不能写死在公开文档，也不能跨客户端复用。缺少证明的配置可以列工具，但正式 Production Run 会被安全地视为 `external`，无法越过 Nomi 的可信宿主门。

需要手工接入时，先在卡片里选择目标客户端，再点「复制配置」，把 **Nomi 当机生成的完整片段** 合并到对应客户端。不要使用旧版 `scripts/nomi-mcp.mjs`，也不要从另一个客户端复制 proof。Codex 的生成片段已经包含 Electron 冷启动、长视频任务和写操作审批所需的超时与审批配置。

从旧版升级后，Nomi 会先备份并自动升级能明确识别的旧 `nomi` 配置；自定义启动命令不会被静默覆盖，卡片会明确要求你手动修复。

当前配置版本是 v3。客户端启动的是 Nomi 包内的 `Nomi Helper` Node runtime 和 `mcpNodeLauncher.js`，不是第二个 Electron GUI。Helper 先读取本机实例广告；Nomi 已打开时直接走 loopback RPC，未打开时只启动一个正常 Nomi 并等待 RPC 就绪。Claude Code、Codex 和 Cursor 同时冷启动时也会汇合到同一个 Nomi 实例，不会各自注册一份 macOS 应用。

**② 完成两侧权限并重启对应客户端**：

- Claude Code / Codex：卡片真实握手成功后，确认 `nomi` 的工具出现（数量以 `tools/list` 为准）。
- Cursor：先在 Nomi「设置 → 自动化与权限」允许 Cursor 发起草稿；首次在 Cursor 调用 Nomi 时，Cursor 自己仍可能要求你批准本地 MCP。Nomi 不会代替你静默批准 Cursor。
- Pi：pi coding agent **自己不带 MCP**（官方 usage.md 明写）。Nomi 把 `nomi` 条目写进 pi 生态通用的标准共享配置 `~/.config/mcp/mcp.json`；pi 侧还需装一次社区适配器 `pi install npm:pi-mcp-adapter`（接入卡上给了可复制命令，Nomi **不代跑**），装完重开 pi，用 `/mcp` 即可看到 `nomi` 的工具。Nomi 不会写 `~/.pi/agent/mcp.json`——那是适配器自己的覆盖层。同样要先在「设置 → 自动化与权限」允许 Pi 发起草稿。

工具总数**以 `tools/list` 为准**；写在这里的数字由 `nomiMcpProductionRuns.test.ts` 钉住目录派生值（没有测试盯着的地方就别写数字——`docs/integrate-with-your-agent.md` 曾经写着「47 个工具」）。当前是 25 个工具。15 个按对象归并：`nomi_read`（读侧统一入口，整体只读）、`nomi_canvas_edit`（画布语义写，唯一的画布写工具；`operation` 枚举即全部合法动作，须持项目租约。传输 schema 由 canvasWrite.ts 的 Zod 校验器派生，不再手写第二份）、`nomi_asset_import`、`nomi_project_create`、`nomi_session_open`、`nomi_run_start` / `nomi_run_control` / `nomi_run_gate`（持久制作 Run）、`nomi_artifact_review`（剧本/分镜审阅+修订）、`nomi_integration`（模型/ComfyUI 接入状态机）、`nomi_integration_manage`（改供应商配置、删供应商/模型、切换单 API 代理）。单次生成的可编辑流程是 `nomi_operation_plan` → `nomi_operation_preview` → `nomi_operation_gate`（付费两相）→ `nomi_operation_execute` → `nomi_operation_control`：先展示/编辑计划，再由 rollout policy 决定何时可提交；未通过阶段检查时会明确返回下一步，不会回退到旧生成器。另外 9 个 M2 语义编辑工具：`nomi_canvas_maintenance`、`nomi_document_read`、`nomi_document_edit`、`nomi_timeline_read`、`nomi_timeline_edit`、`nomi_export_job`、`nomi_media_query`、`nomi_layout_read` / `nomi_layout_write`（剪辑面五块面板的开关 / 尺寸 / 预设，effectClass = reversible_local：自动放行、一行收据、⌘Z 可撤销）。（`nomi_canvas_plan` 已于 2026-09-05 退役：它与 `nomi_canvas_edit` 在 `tools/list` 里 description / inputSchema / method 字节级相同，宿主没有依据选哪个。）

**③ 直接说人话**，它自己挑工具完成：

> 「在 Nomi 里新建一个项目叫『咖啡广告』，先列一下我有哪些图模型；然后拆 3 个咖啡主题的镜头加到画布，每个写好提示词；最后用其中的图模型把第一个镜头生成出来。」

Claude Code 会依次调 `nomi_project_create` → `nomi_read`（target=models）→ `nomi_canvas_edit`（operation=create_canvas_nodes）→ 单次生成流程（`nomi_operation_plan` → … → `nomi_operation_execute`），把结果回给你。

### 典型体验 1：快速初稿

1. 用户只描述目标、镜头数量和首个要生成的素材。
2. 助手先列出 Nomi 当前真正可用的模型，再创建项目、添加三个可编辑节点并连好参考关系。
3. 到第一次付费生成时，Nomi 展示模型、目标节点和支出后果；用户明确确认后才提交。
4. 结果回填原节点。用户打开 Nomi 时看到的仍是三节点、一条参考连线和首镜素材，不需要从对话里手工搬运。

### 典型体验 2：可恢复的完整制作

1. 用户给 brief，并选择 `key_confirm`、`budget_only` 或 `confirm_all`。创建 Run 本身不花费。
2. 方向和样片属于可逆创意门：支持 elicitation 的发起客户端会显示 Nomi 服务端发出的真人确认；也可以回 Nomi 决定。
3. 分镜确认后，预算合同必须在 Nomi 批准。`confirm_all` 会在每个镜头提交供应商前再停一次，卡片明确显示镜头、供应商和模型。
4. 拒绝某镜会暂停且不会提交；恢复制作时会生成新一轮逐镜确认，不会悄悄提交，也不会永久卡死。
5. Nomi 重启后从持久事件和 gate 恢复。粗剪采用与 MP4 导出仍在 Nomi 单独批准，最终产物可在任务中心预览。

---

## 4. 开着 vs 关着 —— Nomi 会自动选安全路径

| 当前状态 | Nomi 的处理 | 你的体验 |
|---|---|---|
| 目标项目正在前台打开 | 通过渲染层应用改动 | 画布立即刷新，确认卡在当前界面出现 |
| Nomi 开着，但目标项目不在前台 | 对该项目安全落盘，确认仍由 Nomi 全局展示 | 不会把后台项目灌进当前画布，也不会漏掉人工门 |
| Nomi 关着 | 包内 Helper 启动正常 Nomi，等待唯一 GUI 的 RPC 就绪后转发 | Nomi 自动出现；需要真人决定时在 Nomi 展示，不会另起一个无界面应用身份 |

你不需要为了让 MCP 工作而关闭项目。三个客户端共用同一份实例广告和本地 RPC；Helper 自身不创建 `NSApplication`，避免 GUI 已开时第二实例在 AppKit 注册阶段退出。

---

## 5. 命令 / 工具 完整参考

### CLI（`node scripts/nomi.mjs ...`）

| 命令 | 作用 |
|---|---|
| `status` | Nomi 开没开 / token 有没有 |
| `models` | 列可用模型（vendor / modelKey / kind / label） |
| `projects` | 列所有项目 |
| `project create "名字"` | 新建项目 → 返回 id |
| `canvas read <projectId>` | 读节点与连线 |
| `canvas add <projectId> <kind> "提示词"` | 加节点（kind=text/image/video/shot/character/scene/audio） |
| `canvas connect <projectId> <源id> <目标id> [mode]` | 连线（mode 缺省 reference） |
| `canvas prompt <projectId> <节点id> "新提示词"` | 改提示词 |
| `canvas delete <projectId> <节点id> [更多...]` | 删节点（连带删边） |
| `generate <projectId> <vendor> <modelKey> <intent> "提示词"` | 真生成（intent=image/video/text/audio） |

### MCP 工具

面收敛（2026-09-02，surface-16-collapse）：拉分支时存在的 42 个「一动词一工具」的 API 镜像塌成 15 个按对象归并、贴任务的工具。读侧全收进 `nomi_read`（整体只读，宿主免确认），写侧按对象 + action/phase 枚举归并；付费两相（确认/执行）保留分家，不合成一步。并线 main 后另有 4 个 M2 语义编辑工具（timeline/export/media）为收敛后新增的独立对象，原样保留、暂未并入 `nomi_read`（续裁），合计 15+4=19。

| 工具 | 对应 |
|---|---|
| `nomi_session_open` | 打开当前项目的安全会话，拿一个短期项目句柄（写副作用） |
| `nomi_read` | 读任意只读投影（`target`=canvas/projects/models/generation_context/operation/run/run_events/artifact/artifact_content/integration）；整体只读、免确认 |
| `nomi_canvas_edit` | 画布语义写，唯一的画布写工具（`operation` 枚举即全部合法动作；须持项目租约，一批一个 undo；渲染层拥有的动作在无 GUI 时回 `capability_unsupported` 并说明下一步） |
| `nomi_canvas_maintenance` | 删除节点或撤销删除（破坏性操作需确认，undoToken 可撤销） |
| `nomi_document_read` | 读项目创作文档（只读） |
| `nomi_document_edit` | 编辑项目创作文档（`operation`=insert/replace/append） |
| `nomi_asset_import` | 把本机文件（手绘帧/截图/参考图）导入项目当素材，返回可直接引用的 `nomi-local://` 地址 |
| `nomi_operation_plan` | 起/改一份可编辑的生成草稿（单镜 prompt / 多镜 shots / 剧本 scriptText 三选一）；不提交、不花额度 |
| `nomi_operation_preview` | 预览草稿将用的模型/模式/参数/参考与不支持字段 + 定价（只读，不封存、不调用模型） |
| `nomi_operation_gate` | 单次生成付费门（`phase`=request 发确认挑战 / decide 提交客户端确认凭据；裸 boolean 不算确认） |
| `nomi_operation_execute` | 在计划已封存且确认有效后开始单次生成；提交只走统一 Runtime Adapter，未满足时 fail-closed |
| `nomi_operation_control` | 控制单次生成（`action`=cancel 取消草稿 / reconcile 核对提交状态；未知结果不盲目重提） |
| `nomi_run_start` | 创建不花钱、可恢复的持久制作草稿；只记 brief + playbook（当前完整流程为 `brand.promo`） |
| `nomi_run_control` | 控制持久制作 Run（`action`=pause/resume/cancel/set_trust）；预算门仍不会被跳过 |
| `nomi_artifact_review` | 审阅/修订版本化剧本或分镜（`action`=approve/request_changes/reject/revise，revise 配 `kind`=script/storyboard） |
| `nomi_run_gate` | Run 的确认门（`action`=decide 表态可逆创意门 / materialize 把已批分镜落画布并登记 jobs+预算）；服务端会再次向真人确认，不能决定预算、逐镜头付费、导出或发布 |
| `nomi_integration` | 模型 / ComfyUI 接入会话状态机（`action`=begin/open_credentials/discover/select/confirm/submit_workflow/resolve_input/start/cancel；只接收公开连接资料，密钥不经 Agent，confirm/start 是付费两相不合成一步） |
| `nomi_project_create` | 新建一个空白 Nomi 项目，返回项目 id |
| `nomi_timeline_read` | 读取时间轴快照或指定范围（只读） |
| `nomi_timeline_edit` | 预览、申请或撤销时间轴编辑；apply/undo 必须回到 Nomi 宿主确认 |
| `nomi_export_job` | 查询导出状态或验证渲染结果；启动/取消导出仍是宿主专属 |
| `nomi_media_query` | 查询项目媒体、素材范围或波形信息（只读） |

---

## 6. 故障排查（真实错误 → 解法）

| 报错 | 原因 | 解法 |
|---|---|---|
| `未找到 token` | 没生成过 token | 启动一次 Nomi（见 §1.2） |
| `API key missing: <vendor>` | 该渠道没填 key，或 key 没解开 | 在 Nomi 里给该渠道填 API Key；确认用的是你平时启动的那个 Nomi（key 按 app 身份加密，换身份解不开） |
| `Model is not enabled: <model>` | 模型没启用 | 先 `nomi models` 看可用列表，用列出来的 vendor/modelKey |
| `headless host 未构建` | dev 下没 build | 先 `pnpm run build:electron` |
| `vendor and request are required` | 命令参数不全 | 对照 §5 补齐 vendor / modelKey / intent / 提示词 |
| `旧配置缺少客户端身份凭据` | 升级前配置只有 stdio 开关，没有本机客户端签名 | 在 Nomi 接入卡对该客户端点「重新接入」 |
| `untrusted-host` | 当前客户端没有有效签名，或尚未在 Nomi 设置中获准发起草稿 | 重新接入对应客户端，再到「自动化与权限」开启该客户端 |
| `CONNECTION_CLOSED`（客户端里 nomi 直接连不上，日志无一字提到 Nomi） | 宿主配置还指着旧入口 `scripts/nomi-mcp.mjs`。旧入口在换成「Nomi 二进制 + `NOMI_MCP_STDIO=1`」时被删净，老配置于是启动即退出 | 在 Nomi →「模型接入」→「接入 AI 编程助手」对该客户端重新接一次，再重启客户端。（旧路径现在会在 stderr 打一行中英迁移提示并以退出码 2 结束，不再静默死掉） |
| `找不到 Nomi 的钥匙串` | 当前启动的是另一份应用身份、隔离测试配置或搬动后的 app，系统钥匙串不会把原凭据交给它 | 关闭该实例并从 `/Applications/Nomi.app` 打开平时使用的 Nomi；除非你明确要新建独立配置，否则不要重新录入或删除原钥匙 |

---

## 7. 安全

- 本地服务**只监听 `127.0.0.1`**（外网 / 局域网够不着）+ **token 校验**。
- Nomi 生成的 MCP 客户端证明按 Claude Code / Codex / Cursor / Pi 隔离；自报客户端名、伪造证明和跨客户端复用都只获得 `external` 权限。
- **付费生成不能只凭 token 启动**——方向/样片可由 Nomi 服务端向支持 elicitation 的客户端再次询问真人；预算、逐镜头提交、粗剪采用和导出仍在 Nomi。支出上限、模型和任务集合绑定本次授权，外部 MCP 客户端不能伪造批准。
- 外部调用只能做 Nomi 的领域操作（建工程 / 改画布 / 生成），**不是**任意文件读写。
- 项目、素材、提示词、密钥和编排状态保存在本机。使用外部模型 API 时，完成任务所需的输入仍会发送给你配置的供应商；“本地优先”不等于“所有推理都离线”。

---

## 8. 已知边界（诚实标注）

- **完整制作的人为边界**：MCP 可以创建、观察和控制 Production Run；方向/样片等可逆创意门可在发起客户端经 Nomi 服务端强制确认后决定。预算、逐镜头付费提交、粗剪采用、导出、发布、删除和覆盖文件仍必须回到 Nomi。
- **当前公开 playbook**：Production Run 的完整驱动先覆盖 `brand.promo`；没有公开“批量生成所有片段”的工具。
- **供应商差异**：只有供应商返回真实进度时 Nomi 才显示百分比；超时或提交结果不明会安全暂停，不会自动重下单。
- **媒体查看**：外部宿主拿到的是去路径、去 prompt、去供应商内部字段的安全投影；真文件通过 project / Run / artifact 绑定的限时 loopback 预览访问。
