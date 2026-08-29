# 根因修复治理设计

日期：2026-08-27
状态：已评审通过，进入实施。

## 背景

两类用户故障暴露了同一个工程问题：代码可以在单个案例上“修好”，但缺少一种可执行机制，强制实现者证明自己修的是整类问题的共同入口，而不是当前报错的表面症状。

- ComfyUI 工作流把图片文件名写入 `VHS_VideoCombine.frame_rate`。表面是一次 400，根因候选是旧媒体绑定仍可指向数值槽位。
- Kling 3.0 Omni 多图任务把第一张普通参考图提升为首帧，并把其余图片重新编号；本地素材若只有图片扩展名/MIME、实际字节却是 HTML/XML，也会在视频解码时才失败。根因位于自定义调用的角色合同、存量脚本迁移和本地上传前的字节边界。

仓库已有 P2“修根因不修症状”和 R5“查官方文档”，但自然语言规则只能提供上下文，不能证明实现者真的完成了入口扫描、外部核验、结构修复和回归覆盖。设计目标因此不是再加一段更长的提醒，而是把这些要求变成可检查的交付物。

## 目标

1. 让人和 AI 在修复高风险生产路径前，先形成同一份结构化根因合同。
2. 用仓库技能把“症状 → 直接原因 → 类根因 → 入口集 → 不变量 → 回归测试”变成固定流程。
3. 用 CI 阻止缺少类根因、入口集、来源证据或回归测试的修复进入主线。
4. 保持单一真相源；不同 Agent 的规则文件和本地 hook 不各自复制业务规则。
5. 让本次 ComfyUI 与 Kling 修复成为第一组真实样例，而不是只搭空框架。

## 非目标

- 不用规则替代代码评审、测试或真实用户任务走查。
- 不要求所有普通重构和文案改动都写根因合同。
- 不让本地 hook 成为唯一门禁；本地配置可能缺失，CI 必须独立生效。
- 不为 MiniMax、Kling 或单一供应商新增长期专用分支。

## 设计

### 1. 三层结构

| 层 | 载体 | 作用 | 权威性 |
|---|---|---|---|
| 原则 | `CLAUDE.md` 的 R21，`AGENTS.md` 由脚本生成 | 短触发规则，告诉 Agent 何时必须进入根因流程 | 规范入口 |
| 方法 | `.agents/skills/root-cause-remediation/SKILL.md` | 给出调查顺序、外部研究、入口扫描、修复与验证方法 | 单一流程真相源 |
| 执行 | 根因合同 + `check:root-cause-contracts` | 检查高风险改动是否有完整证据和变化中的回归测试 | CI 权威门禁 |

本地 hook 只负责及时提醒，不承担最终正确性。已提交脚本是源代码，本地工具配置是可生成适配器。

### 2. 根因合同

每次高风险缺陷修复在 `docs/fixes/*.root-cause.json` 提交一份机器可读合同，至少包含：

- `problem_type`：问题类别。
- `symptom` 与 `direct_cause`：用户看到什么、当前失败如何发生。
- `class_root`：为什么同类入口会共同失败。
- `affected_population`：哪些用户、版本、输入条件会触发。
- `scope_paths` 与 `entry_points`：改动覆盖的生产文件和已扫描入口。
- `external_sources`：官方文档或真实源码链接、核验日期和用途；纯内部问题可给 `internal_only_reason`。
- `invariants`：修复后必须永远成立的结构约束。
- `regression_tests`：本次变更中实际新增或修改的测试文件。
- `migration`：旧数据、旧脚本或旧绑定如何处理。
- `residual_risks`：仍未被证明的边界。

合同不是事故复盘作文。字段用于迫使实现者回答“这类问题还能从哪里回来”，并让门禁验证这些回答是否对应真实代码和测试。

### 3. 触发范围

第一阶段覆盖错误代价高、跨供应商或跨媒体边界的生产路径：

- `electron/catalog/`
- `electron/assets/`
- `electron/comfyui/`
- `electron/image/`
- `electron/productionRun/`
- `electron/protocol/`
- `electron/providerAdapter/`
- `electron/tasks/`
- `electron/vendor/`
- `electron/runtime*`
- `electron/hardenedFetch.ts`、IPC、Store、Repository 边界
- `src/workbench/generationCanvas/runner/`

文档、测试、快照和纯样式文件本身不触发。被触发的生产文件必须由同一变更中的一份或多份合同通过 `scope_paths` 覆盖。

### 4. 门禁语义

`check:root-cause-contracts` 对基线差异执行以下检查：

1. 是否存在未被合同覆盖的高风险生产文件。
2. 合同是否声明类根因、受影响人群、入口集、不变量、迁移和残余风险。
3. 是否存在官方资料/源码证据，或明确说明为什么这是纯内部问题。
4. `regression_tests` 是否存在、是否是测试文件、是否确实在本次差异中变化。
5. `scope_paths` 是否只覆盖真实存在的生产路径。

只有本次新增或修改的合同能满足本次门禁；历史合同是知识记录，不要求以后每次重复改写。CI 使用 PR base SHA / push before SHA，本地使用与 `origin/main` 的 merge-base，避免主分支 push 零差异漏检或落后分支误收上游改动。

检查器本身必须有 `match` / `not_match` 风格红绿 fixture，证明门禁既能拦下缺失合同，也不会误伤低风险改动。

### 5. 本次缺陷的类根修复

#### ComfyUI 媒体绑定

不变量：媒体绑定只能写入工作流图中当前值为字符串的媒体参数槽，不能写入数字、布尔或连接槽。新导入在归一化入口直接拒绝错槽；catalog v11 对能由保存图和旧 prompt 证明的存量错绑原子重建 binding、model parameters 与 mapping，恢复 `frame_rate` 原数值并把图片槽迁回真实媒体输入。

这修在工作流绑定归一化入口，因此 MiniMax H3、其他 VHS 工作流和未来同类模板共同受益。

#### 自定义调用引用角色

不变量：`firstFrame`、`lastFrame` 与 `images[]` 是显式且互不推断的角色；普通参考图的顺序和数量必须保持。脚本不得用 `images[0]` 作为缺失首帧的回退，也不得因为这种提升而过滤或重编号普通参考图。

修复进入变量合同和脚本生成规则，使新脚本不再生成该模式。catalog v11 不改写任何既有 Custom Call 脚本：历史数据没有可靠的生成来源或模板指纹，源码形状无法证明它不是用户或其他模型有意逻辑。运行时同样不使用源码正则；任意既有脚本继续按 escape-hatch 语义执行。受旧生成脚本影响的连接需要在编辑器中基于新合同重新生成并确认，避免后台静默改变其他模型。

#### 本地媒体字节边界

不变量：任何本地图片进入上传策略前，栅格图片声明必须与全局媒体表对应的魔数一致；AVIF/HEIC 在有上限的 ISO-BMFF `ftyp` box 内逐项读取 major 与 compatible brands，不为大文件构造品牌数组。SVG 用维护中的 XML parser 做严格 well-formed 校验，根节点必须属于 SVG namespace，并禁用本场景不需要的 DTD/entity 入口。BMP、TIFF、ICO 等全局支持格式的嗅探能力也与媒体表同步，避免“支持上传但无法验证”的旁路。

不主动回抓上传器返回的远端 URL：整图重下会让多图任务翻倍耗时，自动重定向还会扩大 SSRF 面。已公开 URL 的内容可用性继续属于上传服务合同，Nomi 在自己掌握的源字节边界做确定性校验。

## 外部依据

- [OpenAI Codex AGENTS.md 指令层级](https://developers.openai.com/codex/guides/agents-md)：仓库规则按目录作用，但规则文本本身不是测试证据。
- [OpenAI Agent Skills](https://learn.chatgpt.com/docs/build-skills)：技能适合按任务触发并渐进加载详细流程。
- [OpenAI Rules](https://learn.chatgpt.com/docs/agent-configuration/rules)：`match` / `not_match` fixture 为可测试规则提供了直接范式。
- [OpenAI Hooks](https://learn.chatgpt.com/docs/hooks)：hook 可在工具调用和结束阶段阻断，但依赖本地配置，因此本设计只把它作为提前反馈。
- [Claude Code memory](https://code.claude.com/docs/en/memory)：`CLAUDE.md` 是上下文，不是强制执行机制。
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)：确定性校验应落在 hook 或 CI，而不是依赖模型记住规则。
- [GitHub Copilot repository instructions](https://docs.github.com/en/copilot/concepts/prompting/response-customization)：仓库级和路径级指令可并存，适合让短原则靠近代码范围。
- [Gemini CLI GEMINI.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-md.md) 与 [hooks](https://github.com/google-gemini/gemini-cli/blob/main/docs/hooks/writing-hooks.md)：同样采用分层上下文和确定性生命周期校验。
- [Cline rules](https://github.com/cline/cline/blob/main/docs/customization/cline-rules.mdx)：路径条件规则支持只在相关代码范围内加载工程纪律。

以上资料于 2026-08-27 核验。供应商 Kling 页面当前无法从服务端获得稳定的具体接口正文，因此本次不根据不可核验内容猜测端点或字段。

## 成功标准

- 缺少合同的高风险生产改动在本地和 CI 中失败。
- 完整合同、测试改动和覆盖路径可以通过门禁。
- 精确回归测试证明 `frame_rate` 不再被媒体绑定覆盖。
- 精确回归测试证明两张普通参考图不会被提升、过滤或重编号。
- 图片扩展名/MIME 伪装的 HTML/XML、标签错配 SVG 或损坏栅格字节在任何上传前被拒绝，`mif1 + compatible heic/avif` 等合法图片与全局支持格式不被误伤。
- 全部仓库门禁通过，并以独立分支和 PR 交付。
