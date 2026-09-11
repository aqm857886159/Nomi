# 顶尖产品怎么给 AI 定义领域动词 —— Agent 工具面先例调研

> 日期 2026-09-11 · 调研工人产出，**只出研究，不改生产代码**
> 目的：给 Nomi Agent 工具面的第一性原理重设计提供外部参照。Nomi 是本地 AI 视频创作工作台（画布节点 / 分镜 / 时间轴 / 素材 / 付费生成），不是编程 agent，所以**领域工具**（Figma / Blender / Notion / Slack / Linear）和编程 agent 一样重要。

## 文件索引
| 文件 | 内容 | 出处等级 |
|---|---|---|
| [figma.md](./figma.md) | Figma MCP 26 工具 + 1 prompt | 官方文档 |
| [blender.md](./blender.md) | Blender MCP 28 工具 + 1 prompt（**最像 Nomi 的样本**） | 开源源码 |
| [linear.md](./linear.md) | Linear MCP 31 工具 | 官方一句话 + 第三方实连快照 |
| [notion.md](./notion.md) | Notion MCP 36 工具 + 设计理由 | 官方文档 + 官方博客 |
| [github.md](./github.md) | GitHub MCP 52（默认）/ 101（曾）+ 合并前后 | 官方 README/源码/changelog |
| [playwright.md](./playwright.md) | Playwright MCP 71 工具（默认 24） | 官方 README |
| [slack.md](./slack.md) | Slack MCP 约 19 个能力 | 官方文档（**不给 tool name**） |
| [manus.md](./manus.md) | Manus 29 工具 | ⚠️ 泄露件 |
| [devin.md](./devin.md) | Devin 约 40 个 XML 命令 | ⚠️ 泄露件 |
| [cursor.md](./cursor.md) | Cursor 13 工具 | ⚠️ 泄露件 |
| [cline.md](./cline.md) | Cline 9 工具 | 开源源码 |
| [codex.md](./codex.md) | Codex 核心工具 + 55 条审批文案表 | 开源源码 |
| [claude-code.md](./claude-code.md) | Claude Code 常驻 8 + 延迟约 50 | **本会话实测** |
| [openai-agents-sdk.md](./openai-agents-sdk.md) | hosted tools + function_tool 设计 | 官方文档 |
| [design-guides.md](./design-guides.md) | Anthropic×3 / OpenAI / MCP 规范的硬性建议逐条 | 官方文档 |
| [counterexamples.md](./counterexamples.md) | 三类反例的真实证据与修法 | 官方 issue/changelog/论坛 |

### 没拿到 / 有保留的
- **Slack**：官方文档按能力组织，**没有** tool name 与 schema。文中的名字是能力标题，不保证等于 `tools/list` 的 `name`。
- **Linear**：官方 https://linear.app/docs/mcp **不列工具**，全文一句话。31 条来自 Speakeasy 的实连目录（第三方快照）。
- **Manus / Devin / Cursor**：只有泄露件，非官方发布，**引用必须标注**。
- **GitHub README** 给的是 annotation 的 `Title`（人话短语），不是给模型的 `description`；完整 description 需读源码，本文只抄了 issues 族。
- **ChatGPT 忽略 `readOnlyHint`** 那条只找到社区帖线索，未逐字核对，标为"存在争议"。

---

## 横向对照表

| 产品 | 工具数 | 动词粒度 | 命名风格 | 读写分离 | 破坏性怎么标 | 返回值指路 |
|---|---|---|---|---|---|---|
| Figma | 26 | 一次能用上的一整件上下文 | 动词_名词（用户词汇） | 动词 | 无 | ✅ 文档写死"主入口+fallback" |
| Blender | 28 | 读细 / 写=1 个逃生口 / 素材按供应商 | 供应商_动词 | 动词 | 只有自然语言告警 | ✅ poll/status 族 |
| Linear | 31 | list/get + **save（upsert 合一）** | 动词_名词 | 动词整齐 | 无（delete 单列） | ✅ 返回带 git branch name |
| Notion | 36 | 一口气做完的一件事（建库=库+源+视图） | `notion-动词-名词` | 动词 | 无（**不给 delete**） | ✅ `get-async-task` |
| GitHub | 52（曾 101） | **名词 + read/write + method 枚举** | **名词_读写** | ✅ 写进名字 + `--read-only` | annotation（只填 ReadOnlyHint） | ✅ **STOP 文案** |
| Playwright | 71（默认 24） | 原子动作 | `browser_` + 动词/名词_动词 | caps 分层 + readOnly 元数据 | **名字里带 `_unsafe`** | ✅ snapshot ref = 下次入参 |
| Slack | ~19 | 一件用户任务 | 人话 | **OAuth scope** | scope | ✅ 上传两步写进描述 |
| Manus | 29 | 原子动作 | `域_动词`（6 个域） | 无 | 无 | ❌ |
| Devin | ~40 | 混合（含语义级 `find_and_edit`） | 动词_名词 | 无 | **`sudo=` / `request_auth=` 参数** | ❌（写在行为守则里） |
| Cursor | 13 | 一种"找/改/跑"的方式 | 搜索族统一后缀 | 无 | "PROPOSE" + fail gracefully | ✅ diagram 回灌语法错误 |
| Cline | **9** | 一个工具管一整族 | 混合 | 无 | **`retryable:false`** | ✅ 截断策略+翻页办法同写 |
| Codex | ~20+ | session id 建模长任务 | 动词_名词（动词=意图） | approvals 模块 | **55 条人话审批模板表** | ✅ output_schema |
| Claude Code | 8 + ~50 延迟 | 两极（原子 / 巨型 action 路由） | **大驼峰纯名词** | 无 | permission system | ✅ 大量"别做什么" |

### 三个统计事实
1. **工具数中位数 ≈ 29**；最少 Cline 9，最多 Playwright 71（但默认只暴露 24）。**没有一家把"全部能力"一次性摆出来**。
2. **命名风格没有共识**，但**每家内部高度一致**。唯一的跨家共识是：**名词必须是用户词汇**。
3. **MCP 的 `destructiveHint` 在四个官方 server 里一次都没被用上**（Figma/Linear/Notion 文档层无标注；GitHub 源码只填 `ReadOnlyHint`）。各家都另建了自己的审批机制。

---

## 对 Nomi 的可迁移结论（15 条）

> 每条格式：**结论** — 依据（出处）— 落到 Nomi 是什么。

1. **工具面按"名词 + 读/写"切，具体操作降级成枚举参数。**
   GitHub 把 101→52 就靠这个；`issue_read` 的 `method` 枚举里每个分支自己写返回什么（[github.md](./github.md)）。Anthropic 官方同款建议（[design-guides.md](./design-guides.md) A）。
   → Nomi：不要 `create_shot` / `update_shot` / `delete_shot` / `reorder_shots` 四个，要 `storyboard_read` + `storyboard_write(method=…)`。

2. **create + update 合成一个 `save_*`，判据写进描述。**
   Linear 四个 `save_*` 全是 "If `id` is provided, updates the existing X; otherwise creates a new one."（[linear.md](./linear.md)）。
   → Nomi：`save_node` / `save_shot`，给 id 就改、不给就建；**删除单独留一个工具**，不塞进枚举（Linear 也是这么做的）。

3. **默认只暴露一小撮，其余按需加载。**
   Playwright 默认 24/71 靠 `--caps`；Claude Code 常驻 8 + 延迟 50 靠 `ToolSearch`；OpenAI 建议"fewer than 20 functions at the start of a turn"；GitHub 的三条理由里第三条是"**Defaults matter. Most users never customize**"（[playwright.md](./playwright.md)、[claude-code.md](./claude-code.md)、[design-guides.md](./design-guides.md) D、[counterexamples.md](./counterexamples.md) 1.1）。
   → Nomi：画布/分镜/时间轴/素材/生成 五个面不该同时常驻；按当前视图或任务阶段决定加载哪一组。

4. **写一个"主入口"工具，并在文档/描述里公开声明其余工具是它的输入或 fallback。**
   Figma 原文："get_design_context is the default entry point: the other tools in this group are either inputs to it, or fallbacks…"（[figma.md](./figma.md)）。
   → Nomi：明确谁是"读当前创作上下文"的唯一入口，其余（缩略图、单节点详情、素材原图）都标成它的 fallback。

5. **破坏性/不可撤销的操作，别指望 annotation，做成"预演 + 确认"两个工具或两步。**
   Slack 把 "Draft messages"（起草并预览）和 "Send messages" 拆成两个能力（[slack.md](./slack.md)）；MCP 规范自己声明 annotation 是 hints、客户端 MUST 当不可信（[design-guides.md](./design-guides.md) E）。
   → Nomi：付费生成必须是 `准备一次生成（返回报价+参数，不扣费）` → 用户确认 → `执行`。与 09-09 拍板的"每次提交看报价确认"一致。

6. **★ 写操作返回值要能"按住"模型。**
   GitHub `issue_write` 渲染表单时返回 `IsError=true` 且正文写死："**STOP — do not call any other tools, do not respond as if the issue was updated, and do not claim the operation succeeded.** … Wait silently for the user to review and click Submit. When they do, the real result will be delivered to your context automatically."（[github.md](./github.md)）
   → Nomi：介入槽（付费卡）弹出后，工具返回值必须是这种形状，否则模型会自说自话"已生成"。这是本次调研**最直接可抄的一段**。

7. **审批文案是一张随版本发布的资产表，不是运行时拼串。**
   Codex 的 `consequential_tool_message_templates.json`：`schema_version: 4`、55 条、每条带 `template_params`（哪些参数展示给用户、用什么标签）；同名工具在不同 connector 下人话不同（"apply presentation updates" vs "apply document updates"）（[codex.md](./codex.md)）。
   → Nomi：审批卡的文案和字段登记成一张表 + 门岗，新增破坏性工具没登记就红。对照 R28 / R31。

8. **"要不要阻塞用户"编码进工具选择，不是参数。**
   Manus：`message_notify_user`（不等回复）vs `message_ask_user`（等回复）（[manus.md](./manus.md)）。
   → Nomi：「告诉用户进度」和「问用户一个问题」必须是两个工具，否则模型会用一个工具乱发。

9. **提问工具的 UI 约束写进 schema，并在服务端强制归一。**
   Codex `request_user_input`：questions "Prefer 1 and do not exceed 3"、header "12 or fewer chars"、options "2-3 mutually exclusive choices. Put the recommended option first and suffix its label with \"(Recommended)\". Do not include an \"Other\" option; the client will add a free-form \"Other\" option automatically."，且运行时 `if missing_options { return Err(...) }` + 强制 `is_other = true`（[codex.md](./codex.md)）。Cline `ask_question` 同样写死 "You should only ask one question. Provide an array of 2-5 options."（[cline.md](./cline.md)）。
   → Nomi：AskUserQuestion 类工具的选项数/字数/推荐项位置全部进 schema 描述 + 运行时校验，别靠提示词祈祷。

10. **幂等性用"能不能自动重试"表达，写在工具定义里。**
    Cline：读/搜/抓 `retryable:true`；跑命令、打补丁、编辑 `retryable:false, maxRetries:0`，源码注释 "Editing operations are stateful and should not auto-retry"（[cline.md](./cline.md)）。
    → Nomi：付费生成、节点写入、导出都是 `retryable:false`；缩略图、读取、搜索可重试。**这比 `idempotentHint` 更可执行。**

11. **长任务建模成 handle/session，并把生命周期写进创建工具的描述。**
    MCP 2026-07-28 规范新增的有状态工具指南：返回显式 handle、后续调用传回、"the server's retention policy should be stated in the creation tool's description … **so the model can see it when deciding to create state**"、过期要返回可恢复的错误（[design-guides.md](./design-guides.md) E）。Codex `exec_command` 返回 session ID、Blender `poll_rodin_job_status`、Notion `notion-get-async-task` 都是同一形状（[codex.md](./codex.md)、[blender.md](./blender.md)、[notion.md](./notion.md)）。
    → Nomi：一次生成 = 一个 run handle；`提交生成` 返回 handle，`查生成状态` 吃 handle，**产物保留多久写在"提交生成"的描述里**。

12. **描述里写"什么时候不要用我""这个工具不返回什么"，比写功能更值钱。**
    Anthropic 官方把"when it shouldn't be used"列进必写项，好例子里专门有一句 "It will not provide any other information about the stock or company."（[design-guides.md](./design-guides.md) A）；Claude Code 的描述里否定句密度极高（"Do NOT re-read a file you just edited…"）（[claude-code.md](./claude-code.md)）；Cursor `edit_file` 明说 "This will be read by a less intelligent model"（[cursor.md](./cursor.md)）。
    → Nomi：每个工具描述必须有一行"不要在 X 时用这个，用 Y"。做成描述模板 + 评审项。

13. **一致的描述模板比长描述更管用（两条路线，按工具数选）。**
    Manus 29 个工具逐字遵守 `<动作>。Use for <场景>.` 两句模板（[manus.md](./manus.md)）；Anthropic 官方则建议"at least 3–4 sentences"（[design-guides.md](./design-guides.md) A）。二者不矛盾：**工具多、粒度细 → 模板化；工具少、粒度粗 → 写长。**
    → Nomi：若收敛到 ~10 个粗粒度工具，走 Anthropic 路线写透；若保留 ~30 个细粒度，必须上 Manus 式模板。**先定工具数，再定描述长度。**

14. **调用顺序/依赖写在 server instructions 或一个 prompt 里，不要复制进每个工具描述。**
    GitHub 的 server instructions："acts like a system prompt that guides the model in effectively using an MCP server"（[github.md](./github.md)）；Blender 把整套策略放在 `@mcp.prompt() asset_creation_strategy`（[blender.md](./blender.md)）；Devin 把"遇到环境问题调哪个命令"写在行为守则段（[devin.md](./devin.md)）。
    → Nomi：Nomi 作为 MCP server 对外时，"先读上下文 → 建草稿节点 → 报价确认 → 生成"这条链写进 server instructions，不要在四个工具描述里各抄一遍（否则四份会漂移，违反 R14.1）。

15. **改工具名是破坏性变更，必须同时让已连接宿主刷新清单。**
    Figma `get_code`→`get_design_context` 后，用户因客户端缓存旧清单而看到"新工具坏了"，Figma 员工的回复只能是"重连刷新"（[counterexamples.md](./counterexamples.md) 2.1）。MCP 有 `notifications/tools/list_changed` 正是为此。
    → Nomi：P1「加新必删旧」在工具面上还要加一条——**删旧的同时发 list_changed，并在门岗里验它真的发了**。否则外部宿主（Claude Code / Codex）会拿着旧描述调新运行时。

---

## 两条不该抄的
- **别按供应商切工具**：Blender 的 `polyhaven_* / sketchfab_* / hyper3d_* / hunyuan3d_*` 四套同构工具，直接违反 Nomi 的 **P4 通用第一**，而且把 `MAIN_SITE` / `FAL_AI` / `subscription_key` 这种内部词漏进了模型上下文（[counterexamples.md](./counterexamples.md) 3.2）。Nomi 应该是**一个 `generate` 动词 + 模型身份参数**。
- **别留万能逃生口当主力**：Blender 的所有场景写操作都靠 `execute_blender_code`。Devin 的对策是在提示层写死 "If there exists a dedicated command for something you want to do, you should use that command rather than some shell command."（[devin.md](./devin.md)）——**有逃生口就必须有这句话**，否则领域动词形同虚设。
