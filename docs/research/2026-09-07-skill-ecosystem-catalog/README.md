# Skill 技能生态 · 官方格式 / 导入机制 / 聚合站逆向 / 收录展示格式设计

> 日期：2026-09-07 · 目录：`docs/research/2026-09-07-skill-ecosystem-catalog/`
> 定位：为 Nomi「内置技能库 + 网页聚合站（Registry 单一真相源）」立项前的格式与内容调研。只调研与设计，未写产品代码。

## 阅读顺序

1. **`research-official-format-and-imports.md`** — 官方 SKILL.md 格式 + 各宿主导入机制细节（字段全集 / 目录约定 / 安装命令 / lock 与哈希）
2. **`research-aggregators.md`** — 顶尖聚合站（skills.sh / SkillsMP / LobeHub / agentskills.io / anthropics/skills）收录与展示格式逆向 + 10 条可抄清单
3. **`research-showcase-design.md`** — 顶尖"效果橱窗"市场设计调研（Civitai/HF/CapCut/即梦/PromptBase/Figma/Envato/SeaArt）+ 12 条可抄清单 → 三层渐进展示规格
4. **`collection-schema.md`** — 收录格式（catalog entry schema v0.1：kind/preview/title/两区）+ **展示格式 v0.1（效果橱窗三层渐进）**
5. **`catalog.sample.json`** — 首批 57 个第三方创作类技能样例（已迁移 v0.1：kind/preview/title + 两区，过结构校验）
6. **`showcase.html`** — 展示格式可点击 mockup（v0.1 数据，打开即看"列表卡片 + 详情页"）
7. **`hf-minimax-lora-scan.md`** — HF Minimax LoRA 生态扫描（601 命中 / 111 LoRA / license 分布 / 底座兼容 / NSFW 治理）
8. **`prototype/`** — **P0 可运行原型**：catalog-entry schema JSON / validate-skill.mjs（对齐 agentskills.io）/ collect.mjs（GitHub+HF 采集管线）/ hf-sweep.mjs（HF 全量扫描）。见 `prototype/README.md`
9. **`curation-policy.md`** — **收录策略 v1（市场认可度门槛）**：MarketScore 公式 / S-A-watch 分档 / 红线一票否决 / 全量执行计划
10. **`catalog.json`** — **全量合并 catalog v1：174 条**（GitHub 技能 45 + HF LoRA 129，真实 stars/downloads/likes，市场认可打分分档），结构校验通过
11. **`catalog.hf-lora.json`** — HF 全量 LoRA 目录（142 条 + watchlist 23），`catalog.hf-lora-watchlist.json` 为低分观察池
12. **`shop.html`** — **效果橱窗商店页 v1**（双击即开，数据内联）：按 S 档/官方/开放区/类型筛选、市场分排序，实时渲染 174 条真实数据

## 扩展方向（2026-09-07 追加 · 用户拍板"三类全做"）

- Registry 不止收技能，扩展为**创作资产 Registry**：`kind: skill | effect-pack | lora` + modality（形象/声音/风格），统一外层（来源/license/安全/预览/接入指令），分型接入（skill→拷目录 / effect-pack→铺画布 / lora→本地 ComfyUI 检测+落位）。
- HF LoRA 走**开放目录收全量**（civitai 式分级/声明/免责），内置策展区红线不动（只收自有/授权/无真人内容）。数据依据见 `hf-minimax-lora-scan.md`。

## 三条核心结论（30 秒版）

1. **格式权威已收敛且不在我们手上**：生态只认 `SKILL.md`（必填仅 `name` + `description`），agentskills.io 是规范站并提供官方校验器 `skills-ref validate`。Nomi 内部多一份 `skill.json` 是**唯一特例**——对外收录/展示必须以 SKILL.md 为准（呼应 `docs/plan/2026-08-27-skills-knowledge-distribution.md` 与 `prior-art.md` 的既有结论）。
2. **一键安装 CLI 是 Vercel 的 `npx skills`，不是官方**：Claude Code 无 `skills add`，Codex 也无 `codex skills add`。Nomi 已有的 `skills-lock.json`（source/sourceType/skillPath/computedHash=SHA-256 内容哈希）**与 Vercel lock v1 同构**——桌面端"目录订阅"直接复用这套，不要自造。
3. **聚合站的差异化卖点是"策展 + 安全 + 机器可读"**，不是收录量：安全审计结果公开在每页、`收录 ≠ 官方推荐` 脚注、review-first 安装、每 repo 限样防止单一厂牌霸榜——这些直接抄进我们设计。

## 现状盘点（决定 P0 从哪起步）

| 资产 | 位置 | 状态 |
|---|---|---|
| 内置技能 20+（SKILL.md v2 双文件） | `skills/` | 已有，`docs/skill-pack-format.md` 定义 |
| 本地技能库（list/import/export/drop/parse） | `src/workbench/skillLibrary/` | 已有 |
| 外部源锁定 | `skills-lock.json` | 已有，与 Vercel lock v1 同构 |
| 技能转写能力 | `skills/skill-author/SKILL.md` | 已有 |
| **Registry catalog + 聚合站** | — | **本次设计的对象** |

## 样例数据快照（详见 catalog.sample.json）

- 首批 **57 条**第三方技能（按 domain 归并后无重复 id）：提示词工程 8 / 编剧 4 / 分镜故事板 5 / 短视频口播 7 / UGC 广告 6 / 配音音乐 6 / 剪辑字幕 7 / 角色一致性 5 / 合集工具 9
- 生态空缺（Nomi 可自建差异化栏目）：**角色一致性/数字人无行业标准**、**调色/转场美学方法论独立技能几乎不存在**、**中文内容技能稀缺**
- 高价值货源：`samuraigpt/generative-media-skills`（60 技能聚合池）、`digitalsamba/claude-code-video-toolkit`（11 技能视频包）、`anthropics/skills`（官方 17 技能）
