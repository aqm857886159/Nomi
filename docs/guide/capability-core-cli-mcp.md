# 用户指南：用 Claude Code / Codex 在本地驱动 Nomi（CLI + MCP）

> 让你电脑上的 AI 编程助手（Claude Code、Codex、Cursor…）直接操作你的 Nomi：建项目、往画布加镜头、改提示词、用你配好的模型**真生成图 / 视频 / 文本**，结果落进 Nomi 项目，打开就能看。
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

打开 Nomi 的「模型接入」→「接入 AI 编程助手」，选择 Claude Code、Codex 或 Cursor，点击接入。Nomi 会只合并自己的 `nomi` 条目、保留其它 MCP server，并在改写前留下 `.nomi-backup`。接入卡会真正启动配置中的命令做握手，不会只凭“配置里有一行”显示成功。

手工配置时，MCP server 必须启动 **Nomi 应用自身**，并传入 `NOMI_MCP_STDIO=1`。不要再使用旧版 `scripts/nomi-mcp.mjs`；该脚本已经退役。例如安装版 macOS 的 Claude Code / Cursor 配置为：

```json
{
  "mcpServers": {
    "nomi": {
      "command": "/Applications/Nomi.app/Contents/MacOS/Nomi",
      "args": [],
      "env": { "NOMI_MCP_STDIO": "1" }
    }
  }
}
```

Codex 使用 `~/.codex/config.toml`，还需要为 Electron 冷启动和视频任务保留足够超时：

```toml
[mcp_servers.nomi]
command = "/Applications/Nomi.app/Contents/MacOS/Nomi"
args = []
startup_timeout_sec = 60
tool_timeout_sec = 600
default_tools_approval_mode = "writes"
env = { NOMI_MCP_STDIO = "1" }
```

**② 重启对应客户端**，确认 `nomi` 这组 13 个工具出现了，包括 `nomi_list_models`、`nomi_create_project`、`nomi_generate` 和 `nomi_start_playbook`。

**③ 直接说人话**，它自己挑工具完成：

> 「在 Nomi 里新建一个项目叫『咖啡广告』，先列一下我有哪些图模型；然后拆 3 个咖啡主题的镜头加到画布，每个写好提示词；最后用其中的图模型把第一个镜头生成出来。」

Claude Code 会依次调 `nomi_create_project` → `nomi_list_models` → `nomi_add_nodes` → `nomi_generate`，把结果回给你。

---

## 4. 开着 vs 关着 —— 一条要知道的限制

如果 Nomi **正开着、而且正打开着你要改的那个项目**，外部的「改画布」命令（加节点 / 连线 / 改提示词 / 删节点）会被**拒绝**并提示原因：

> `该项目正在 Nomi 中打开；图变更请在 app 内操作，或关闭项目后再用外部调用`

原因：那一刻 app 内存里的状态才是真相，外部直接改文件会被它防抖回盘覆盖掉（防止你的改动丢失）。

**应对**：在 app 里手动改，或先关掉那个项目再用外部命令。**读取、列模型、生成不受此限制。**
（「外部改动实时反映到打开着的画布」是后续切片。）

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

| 工具 | 对应 |
|---|---|
| `nomi_list_projects` / `nomi_create_project` | 列 / 建项目 |
| `nomi_list_models` | 列可用模型 |
| `nomi_read_canvas` | 读画布 |
| `nomi_add_nodes` / `nomi_connect_nodes` | 加节点 / 连线 |
| `nomi_set_node_prompt` / `nomi_delete_nodes` | 改提示词 / 删节点 |
| `nomi_generate` | 真生成（含参考图 references、指定 nodeId） |
| `nomi_start_playbook` | 创建不花钱、可恢复的制作草稿；当前完整流程为 `brand.promo` |
| `nomi_get_run` / `nomi_subscribe_run` | 读取制作状态 / 按游标等待持久事件 |
| `nomi_get_artifact` | 取得指定 Run 产物的安全投影、精确 Nomi 深链和限时预览 |

---

## 6. 故障排查（真实错误 → 解法）

| 报错 | 原因 | 解法 |
|---|---|---|
| `未找到 token` | 没生成过 token | 启动一次 Nomi（见 §1.2） |
| `API key missing: <vendor>` | 该渠道没填 key，或 key 没解开 | 在 Nomi 里给该渠道填 API Key；确认用的是你平时启动的那个 Nomi（key 按 app 身份加密，换身份解不开） |
| `Model is not enabled: <model>` | 模型没启用 | 先 `nomi models` 看可用列表，用列出来的 vendor/modelKey |
| `该项目正在 Nomi 中打开` | 该项目正在 app 里开着 | 关掉那个项目，或在 app 内改（见 §4） |
| `headless host 未构建` | dev 下没 build | 先 `pnpm run build:electron` |
| `vendor and request are required` | 命令参数不全 | 对照 §5 补齐 vendor / modelKey / intent / 提示词 |

---

## 7. 安全

- 本地服务**只监听 `127.0.0.1`**（外网 / 局域网够不着）+ **token 校验**。
- **付费生成不能只凭 token 启动**——方向和制作合同必须在 Nomi 里由真人批准，支出上限、模型和任务集合会绑定到本次授权；外部 MCP 客户端不能伪造批准。
- 外部调用只能做 Nomi 的领域操作（建工程 / 改画布 / 生成），**不是**任意文件读写。
- 项目、素材、提示词、密钥和编排状态保存在本机。使用外部模型 API 时，完成任务所需的输入仍会发送给你配置的供应商；“本地优先”不等于“所有推理都离线”。

---

## 8. 已知边界（诚实标注）

- **完整制作从 Nomi 收口**：MCP 可以创建和观察 Production Run，但方向、预算、粗剪、导出、发布、删除和覆盖文件不能在外部客户端自动批准。
- **当前公开 playbook**：Production Run 的完整驱动先覆盖 `brand.promo`；没有公开“批量生成所有片段”的工具。
- **供应商差异**：只有供应商返回真实进度时 Nomi 才显示百分比；超时或提交结果不明会安全暂停，不会自动重下单。
- **媒体查看**：外部宿主拿到的是去路径、去 prompt、去供应商内部字段的安全投影；真文件通过 project / Run / artifact 绑定的限时 loopback 预览访问。
