# 内外工具面统一 —— 我们造了第二套

> **状态**：草案，待用户在 §4 三个方案里拍板后执行。**未动码。**
> **缘起**：2026-08-27 用户提问「我们的 MCP 工具和内置工具是不是不一致呀？是不是首先得打通一下？」——实测答案是**是，而且这直接违反我们自己定的北极星**。
> **上位方案**：`docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md` §0 北极星 + Track B2「工具动态注册表」。
> 不涉及新框架/新技术栈（是我们自己两套实现的收敛），故不适用 R5 的选型实查。

## 0. 北极星原文 vs 现状

master plan 第 0 节：

> **内外一个控制面**：外部 agent（Claude Code/Codex…经 MCP）和 Nomi 内嵌统一 agent，驱动**同一批语义工具、同一个确认面**、同一套技能库、同一组 Workflow Pack。

§1 分层总图下方：

> 两个入口都骑在 L2-L4 上：**外部** = MCP transport；**内部** = 进程内直连**同一工具实现**（**P1 不造第二套**）。

**现状：我们造了第二套。**

## 1. 实测对照（2026-08-27）

| | 对外 MCP | 内嵌 agent |
|---|---|---|
| 工具数 | **22** | **17**（画布 11 + 文档 6） |
| 定义位置 | `electron/capabilityCore/mcpToolCatalog.ts`（24,560 字符） | `electron/ai/canvasTools.ts` + `documentTools.ts` |
| 确认/权限 | `mcpGenerationPolicy.ts`（「single policy owner」） | `gate.ts` + `SpendConfirmDialog`，**完全不走前者** |

### 1.1 同一件事，两个名字（6 处）

| 一件事 | 对外 | 内嵌 |
|---|---|---|
| 读画布 | `nomi_read_canvas` | `read_canvas_state` |
| 建节点 | `nomi_add_nodes` | `create_canvas_nodes` |
| 连边 | `nomi_connect_nodes` | `connect_canvas_edges` |
| 删节点 | `nomi_delete_nodes` | `delete_canvas_nodes` |
| 发起生成 | `nomi_generate` | `run_generation_batch` |
| 改提示词 | `nomi_set_node_prompt` | `set_node_prompt` |

### 1.2 只有一边有的

**只对外有（16）**：`start_playbook` `intake_brief` `decide_gate` `control_run` `subscribe_run` `get_run` `get_artifact` `read_artifact` `review_artifact` `materialize_storyboard` `request_script_revision` `request_storyboard_revision` `create_project` `list_projects` `list_models` `import_asset`

**只内嵌有（11）**：`propose_storyboard_plan` `arrange_storyboard_to_timeline` `tidy_canvas` `create_staging_reference` `create_camera_move` + 6 个文档工具（`read_full_text` `read_selection` `insert_at_cursor` `replace_selection` `append_to_end` `author_skill`）

## 2. 这为什么是真问题（不是洁癖）

**① 能力单边失效，且会持续扩大。**
`create_camera_move`（运镜）和 `create_staging_reference`（站位参考）是我们最贵的两个能力 —— 外部 agent **永远调不到**。反过来 `decide_gate`/`control_run`/`subscribe_run` 那套耐久 Run 语义，内嵌 agent 完全没有，意味着**内嵌 agent 干的活没进那本账**。

**② 每加一个能力要写两遍，每修一个 bug 要修两处。**
对账、幂等键、预算这些语义会随时间漂 —— 而它们正是 master plan 划为「保护项、永不被反向改写」的护城河（ProductionRun 账本 / 预算收据 / Proposal 撤销）。**两套实现是护城河最危险的漏水点。**

**③ 确认面已经是两套。**
`mcpGenerationPolicy` 自称 "single policy owner"，但内嵌 agent 根本不经过它。而 master plan §2.4 明确要求「**单一审批信道**：确认=事件流上的反向请求」、§2.5「策略引擎单点化」。

**④ 这也是 §1.1 那 6 个别名的真实代价。**
名字不同还只是难看；**行为不同才致命**。目前没有任何测试证明 `nomi_add_nodes` 和 `create_canvas_nodes` 的落地语义一致（重复扣费、边连不上、对账偏差都可能只在一边出现）。

## 3. 先补一个事实：我们只是 server，不是 client

查证结论：**Nomi 不消费任何外部 MCP**（无 MCP client 实现）。

推论两条：

- 「MCP 工具吃 token」那个业界硬伤，在我们这儿是**客户端（Claude Code）替我们扛的**——它自己做延迟加载。我们暴露 22 个全量广告是可接受的。
- 群里那条「ComfyUI 出 MCP 了，跪求 nomi 支持本地 comfyui」**目前做不到**——要做就是新建 MCP client 能力，是独立议题，不在本文范围（且我们已有原生 ComfyUI 接入，需先判是否重复）。

## 4. 三个方案（待拍板）

|  | A. 内部收编到 MCP 语义 | **B. 抽语义工具层，两边都是投影** | C. 只对齐命名 |
|---|---|---|---|
| 做什么 | 内嵌 agent 直接调那 22 个 `nomi_*`（进程内直连，不走 JSON-RPC） | 抽一层「语义工具」真相源；MCP catalog 与 `canvasTools` 各自是它的**薄投影** | 改名字对上，底下两套照旧 |
| 好处 | 一步到位，账本天然统一 | 同上；且内部专有的运镜/站位能顺势升成一等公民对外暴露 | 便宜 |
| 代价 | 内部 11 个专有工具要么砍要么补进 MCP 面；文档工具塞进 MCP 语义别扭 | 要动 `mcpToolCatalog` + `canvasTools` 两处 + 一层新抽象，**中等偏高** | **治标**：名字一样、行为还两套，反而更容易误以为通了 |
| 判定 | 可行但削足适履 | **推荐** | **反对** |

**为什么反对 C**：名字一样但行为不一样，比名字不一样**更危险** —— 它会让所有人（包括未来的我）以为已经统一，从而停止怀疑。

**B 就是 master plan 的 Track B2「工具动态注册表」**（原标注：高风险，核心路径）。本文把它具体化为「先统一真相源，再谈动态裁剪」——**顺序不能反**：在两套实现之上做动态注册表，等于把漂移固化。

## 5. 建议的排序：排在 Skills 之后

| 顺序 | 事 | 理由 |
|---|---|---|
| 1 | Skills 渐进披露接给内部（`2026-08-27-skills-knowledge-distribution.md` Phase 1） | **接线**，实现已存在，纯增量，不动核心路径 |
| 2 | 补齐 skill manifest + 门岗 | 同上，低风险 |
| 3 | **本文 B 方案** | 动核心路径，需 plan 定稿 + 6 角色评审（R7） |

Skills 先做还有一个连带好处：**工具描述瘦身的机制跟 skill 渐进披露是同一套**。我们的工具面 13,438 字符里，`create_staging_reference`(2,557) + `create_camera_move`(2,128) 两个就吃掉 **35%**，而它们都是条件触发（只有双人对峙/有运镜意图的镜头才用）却每轮全量在场。Skills 的 Level 1/2 机制建好后，工具描述可以直接复用它。

## 6. 开工前必须先答的（B 方案定稿门）

1. **语义工具层放哪一层？** 候选：`electron/capabilityCore/`（跟 ProductionRun 账本同层）。需确认不会让 `electron/ai/` 反向依赖 capabilityCore 造成循环。
2. **文档工具（6 个）进不进 MCP 面？** 外部 agent 该不该改用户的剧本？涉及权限语义，需拍板。
3. **专有工具（运镜/站位）对外暴露后，3D 离屏渲染在无窗口的 headless 场景怎么办？** 已知它们依赖渲染层。
4. **迁移期怎么保证两边行为一致？** 建议：先写**双投影一致性测试**（同一语义输入分别走两条路，断言落地结果等价），红了再动实现 —— 否则统一过程本身会引入回归。
5. **`mcpGenerationPolicy` 与 `gate.ts` 谁收编谁？** 关系到 master plan §2.5「策略引擎单点化」。

## 7. 验收门（B 方案）

- [ ] 一个语义工具真相源；`mcpToolCatalog` 与 `canvasTools` 都只是它的投影，**新增工具只写一处**
- [ ] 双投影一致性测试全绿（同输入 → 同落地、同账本、同幂等键）
- [ ] 内嵌 agent 干的活进 ProductionRun 账本（与外部同一个 Run）
- [ ] 确认面单一：`gate` 与 `mcpGenerationPolicy` 收敛成一个
- [ ] 旧的第二套已**物理删除**（P1，无并行版）
- [ ] 内外同任务产生**同一个 Run**（master plan §7 验收项）
