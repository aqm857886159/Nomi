# 创作资产 Registry 立项：Skill/Effect Pack/LoRA 三类 · 收录格式 v0 + 采集管线 + 网页站（2026-09-07）

- 状态：📋 方案待拍板（本文件即立项文档；拍板后分 PR 实施）
- 前置调研：[`docs/research/2026-09-07-skill-ecosystem-catalog/`](../research/2026-09-07-skill-ecosystem-catalog/)（README / 官方格式与导入机制 / 聚合站逆向 / collection-schema.md / catalog.sample.json 57 条 / showcase.html / **hf-minimax-lora-scan.md**）
- 上位方案：`docs/superpowers/plans/2026-08-24-unified-agent-master-plan.md` §2.9「SKILL.md 渐进披露」；衔接 `docs/plan/2026-08-27-skills-knowledge-distribution.md`（Phase 1-3 待执行）
- 范围拍板记录（2026-09-07 三轮 AskUserQuestion）：Registry 载体 = **Git 仓库索引**；首期 = **先网页聚合站 v1**；内容定位 = **Nomi 官方 + 生态投稿**；随后追加拍板 = **资产三类全做（skill + effect-pack + lora）** + **开放目录收全量（civitai 式分级治理）**，先以 HF Minimax LoRA 扫描数据定收录策略（扫描已完成，结论见 §2.1）

## 先查别人（R27 §16 必交物）

> 完整调研与出处见 [`docs/research/2026-09-07-skill-ecosystem-catalog/`](../research/2026-09-07-skill-ecosystem-catalog/)。逐项回答「要建的东西，生态里已经有什么」。

1. **SKILL.md 是开放标准，字段与校验规则在 agentskills.io**：必填仅 `name`(≤64，kebab，与目录同名) + `description`(≤1024)；官方校验 CLI 是 `skills-ref validate`。一手出处：[agentskills.io/specification](https://agentskills.io/specification)、[Anthropic Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)、[anthropics/skills 仓库](https://github.com/anthropics/skills)。
2. **没有官方 `skills add` 命令；一键安装是 Vercel 开源 `npx skills`**，`skills-lock.json`(source/skillPath/computedHash=SHA-256 内容哈希)是 Vercel 发明、与 Nomi 已有 `skills-lock.json` 同构。一手出处：[github.com/vercel-labs/skills](https://github.com/vercel-labs/skills)、[npm skills](https://www.npmjs.com/package/skills)、[OpenAI Codex build-skills 文档](https://developers.openai.com/codex/skills)。
3. **顶尖聚合站怎么做收录/展示**：skills.sh(来源可溯+三榜+安全审计公开)、SkillsMP(职业分类+review-first)、Civitai(详情序+license 沉底+免责)。一手出处：[skills.sh/about](https://www.skills.sh/about)、[skillsmp.com](https://skillsmp.com/)、[civitai.com 模型页](https://civitai.com/models/264290)。
4. **本仓已收敛到 frontmatter 唯一 owner（#580 skill-format-convergence 已合 main）**：`skill.json` 退场、Nomi 专有字段进 `metadata.nomi.*`——catalog「只认 SKILL.md」正是收敛后世界的直接推论，本方案与它同向无冲突。出处：[`docs/plan/2026-09-07-skill-format-convergence.md`](2026-09-07-skill-format-convergence.md)、[`docs/research/2026-09-07-pi-package-ecosystem.md:168`](../research/2026-09-07-pi-package-ecosystem.md)。
5. **「收录≠可用≠推荐」与分层披露**：PromptBase 买前看不到提示词本体（演示可见、参数接入后给）；「每 repo 限样防霸榜」「无样张不上架」抄 skills.sh/SkillsMP/CapCut。一手出处：[promptbase.com](https://promptbase.com/)、[capcut.com/templates](https://www.capcut.com/templates)。

## 0. 一句话

把 Nomi 从「本地单机技能库」升级成「**创作资产 Registry**」：**一个统一外层（来源/license/安全/预览/接入指令）+ 三类载荷分型接入**——`kind: skill`（SKILL.md 方法论，拷目录即用）/ `kind: effect-pack`（素材+提示词+音像参考，一键铺成画布流程）/ `kind: lora`（模型权重，检测本地 ComfyUI + 底座后落位）。差异化卖点是「校验即收录门槛 + 安全/策展分级 + 开放目录治理 + 机器可读」，两区并行：**内置策展区**（红线：只收自有/授权/无真人 likeness 内容）+ **开放目录区**（收全量，civitai 式分级/声明/免责）。

## 1. 现状与要动的东西（file:line 实测）

| 资产 | 位置 | 状态 |
|---|---|---|
| 内建技能 20+（SKILL.md v2 双文件） | `skills/`，规范见 `docs/skill-pack-format.md` | 已有 |
| 本地技能库 UI/导入/导出/拖拽/解析 | `src/workbench/skillLibrary/`（SkillLibraryPanel / skillDropIntake / parseSkillImport） | 已有，本地单机版 |
| 外部源锁定（source/skillPath/computedHash） | `skills-lock.json`（root） | 已有，**与 Vercel skills lock v1 同构**（调研确认） |
| 运行时 schema 与能力编排 | `electron/skills/`（skillCapability / playbookOrchestrator / skillIpc） | 已有，**内部侧** |
| `packages/schemas/*` | 仅 zod 占位，无源码 | **不是活跃 schema 目录**，两端共享 schema 需另定落位（见 §4 决策点 1） |
| **Registry catalog + 聚合站 + 校验器 + 采集管线** | — | **本方案要建的** |

## 2. 本方案交付（范围）

**0 层（贯穿）· 资产类型分层**
- catalog entry 加 **`kind: skill | effect-pack | lora`** + `modality`（形象/声音/风格/动作…）；双轨分类 domain/craft 保留（与类型正交）。
- 统一外层字段（来源可溯/license/安全/预览/接入指令/治理状态）对三类**同一套 schema**，类型只差 `adapterForNomi` 分型与 `assetSpec`（见 collection-schema 扩展）。
- **两区治理**：`curation.status` 扩为 `official | curated | candidate | open-directory`；license=无/other 与真人 likeness 内容只进 `open-directory`（分级 + 声明 + 免责），不进内置策展区。

**P0 · 收录底盘（先落 skill，schema 一次到三类）**
1. **catalog entry schema v0（含 kind/modality/两区）**：以 collection-schema.md §1 为准；本次追加 kind 分型与 curation.open-directory 档。
2. **校验器 `nomi skill validate <dir>`**：对齐 agentskills.io 规则（name≤64 小写连字符且与目录同名 / description≤1024 what+when / 保留字 anthropic·claude / license 声明）。优先评估**包 `skills-ref validate`**（R20：不造轮子）；包不了才自研等价实现。
3. **采集管线脚本**：输入源列表 → 拉取 → 解析 → 产出 catalog 条目 → validate + 安全标记 → 写 `catalog.json`。`source.type` 支持 `github | huggingface`（HF：repoId + siblings + license 映射 + gated/adult 标记）。首批种子 = skill 57 条（GitHub 已核验）+ **HF LoRA 头部样例**（见 §2.1 数据）。

**P1 · 网页聚合站 v1**（先做这一端）
4. **静态目录站**：列表页（卡片=最小可判集 + kind/modality 筛选 + 两区徽标）+ 详情页（按 kind 给接入入口：skill=三态安装 / effect-pack=预览+一键铺画布 / lora=样张+本地检测装权重）+ 搜索/筛选 + 同源折叠 + 安全审计位 + 「收录≠官方推荐」脚注。**数据源 = 同一个 `catalog.json`，CI 重建**。

> P2 桌面端「资产市场」面板（拉 manifest + 与 skills-lock.json 合并做更新检测 + 分型接入器：skillLibrary 复用 / ComfyUI 检测落位）**不在本方案范围**，是衔接下一步。

## 2.1 HF Minimax LoRA 扫描结论（2026-09-07 实抓，决定 LoRA 收录策略）

详见 [`hf-minimax-lora-scan.md`](../research/2026-09-07-skill-ecosystem-catalog/hf-minimax-lora-scan.md)。

| 维度 | 实测 | 决定 |
|---|---|---|
| 存量 | 601 命中 → **111 个真实 LoRA**，单条最高下载 50.2 万 | 货源真实，值得收 |
| license | apache-2.0 42 / **无 license 33** / other 32 / mit·gpl 4 | 无 license/other → 只进 open-directory |
| 底座 | MiniMaxAI/MiniMax-H3 36 + **Comfy-Org/MiniMax-H3 25**（comfyui 系，与 Nomi comfyui-local vendor 同生态） | LoRA 接入 = 本地 ComfyUI 检测 + 权重落位 + 工作流生成 |
| 预览 | HF 无统一预览元数据 | lora「看效果」= 作者样张 or 本地真跑一条小样 |
| 内容 | 真人 likeness（fal Realism-People）+ NSFW（lynaNSFW 一族）真实存在 | open-directory 必带内容分级 + 作者声明 + 免责 |

**对 schema 的直接改动**：`source.type: huggingface` 新增字段 `repoId / gated / adult`；`adapterForNomi.needs` 增加枚举值 `comfyui-install`（skill 用 tools-mapping/rewrite 不变）。

## 3. 决策点（R3：每项给对比与推荐）

| # | 决策 | 方案 | 代价/收益 | 推荐 |
|---|---|---|---|---|
| 1 | **两端共享 schema 落位** | **（实测修正 2026-09-07）** `packages/schemas/*` 是无 workspace 支撑的死占位（仅 node_modules/zod、无 package.json、仓库无 pnpm-workspace.yaml、package.json 无 workspaces 字段）——"新建独立包"前提不成立。改为：catalog schema + 校验器作模块落 `scripts/`（照 radar/check 脚本惯例），网页静态站独立目录消费同一 schema | **scripts/ 模块（修正）** |
|  |  | B. 放 `electron/skills/`（贴近 skillCapability） | 桌面近，但网页站（独立静态站）要跨仓/跨进程引用，脏 |  |
| 2 | **校验器实现** | A. 包 `skills-ref validate`（agentskills.io 官方 CLI） | 零维护、规则自动跟进；但引入外部 CLI 依赖与网络 | **A**（评估不通过退 B） |
|  |  | B. 自研 zod 校验 | 可控离线；但要自己追规范变更，违背 R20 |  |
| 3 | **网页站形态** | A. 纯静态（GitHub Pages/CI 渲染，无后端） | 零运维，符合 Git 索引载体；无账号/统计 | **A（首期）** |
|  |  | B. 静态 + 薄 API | 有安装计数闭环 | P3 再议 |
| 4 | **收录入口** | A. 「发布即收录」：作者在 Git 仓按规范放 SKILL.md，PR/表单提交 owner/repo 到 catalog | 抄 skills.sh，无账号体系 | **A** |
|  |  | B. 自建上传审核工作流 | 重 | 不做 |

## 4. 不动项

- **不把 `skill.json` 写进 catalog**；Nomi 内部运行时 schema（electron/skills/skillCapability 等）一律不动。
- 不动桌面端现有 skillLibrary 导入/导出/拖拽链路与安全边界（`electron/skills/skillPackage.ts` 主进程校验是唯一真相源）。
- 不动 `skills-lock.json` 既有格式；桌面端「更新检测合并」留 P2。
- **内置策展区红线不动**：真人明星 likeness / 成人内容不进内置区（沿用 Effect Pack 已确认红线）；开放目录另区分，不混。
- 不新增依赖除非决策点 2 包 `skills-ref` 通过评估。

## 5. 验收门

**P0**
- 用调研 57 条种子跑 `nomi skill validate`：产出 `catalog.json`，schema 校验零报错；`skills-ref validate`（若采用）对官方 anthropics/skills 样例可过。
- `catalog.json` 与 `catalog.sample.json` 逐字段对账通过（domain/craft 分类无孤儿、无重复 id——样本已证 0 重复）。
- **kind 分层验收**：skill / effect-pack / lora 三类夹具各一条过 schema；curation.open-directory 档与 license 映射（无 license/other → open-directory）单测红绿正确。
- **HF 采集验收**：管线以 `hf-minimax-lora-scan.md` 头部 5 条 LoRA 为输入，产出带 `repoId/gated/adult` 的条目，license 映射与实抓一致。
- 采集管线对同一源跑两遍结果一致（幂等）。

**P1**
- 端到端：改 catalog 里一条 description → push → CI 重建 → 网页站该条自动更新（浏览器可见）。
- 详情页三态安装入口均给出正确命令；「收录 ≠ 官方推荐」脚注与安全审计位在页面上逐字可见。
- `showcase.html` 的展示格式与真实站点逐项对账（P3/R8：实现后与样张一致）。

## 6. 回滚

- P0/P1 全部产出为**新增文件 + 新脚本**（catalog.json / validate 脚本 / 站点目录），不触碰生产链路 → 回滚 = 删目录 + 撤 CI job，零迁移成本。
- 唯一耦合点：若桌面端 P2 先被引入则需 manifest 版本兼容——本方案明确不引入，故无回滚债务。

## 7. 建议 PR 切法（拍板后执行）

1. `PR-a`（P0）：catalog schema zod 包（含 kind/modality/两区 + 三类夹具单测）+ `nomi skill validate`（对齐 agentskills.io）
2. `PR-b`（P0）：采集管线脚本（github + huggingface 两 source）+ 首批 catalog.json（57 skill 种子 + HF LoRA 头部样例，逐字段对账）
3. `PR-c`（P1）：网页静态站 v1（按 kind 分型接入入口 + 两区徽标）+ CI 重建 job
4. （衔接）`PR-d`（P2 单独立项）：桌面端资产市场面板 + manifest 拉取合并 skills-lock.json + effect-pack/lora 分型接入器
