# 供应商模型雷达（apimart / kie）

**日期**：2026-08-27
**触发**：用户要求「给 apimart 和 kie 设计一个类似论文雷达的东西，每天看他们文档有没有更新新模型，告诉我，确认之后自动接入」。
**拍板**（2026-08-27 用户选）：
- 自动深度 = **先出接入方案，再写码**（不直接出 PR；档案分合这类决策用户要提前介入）。
- 盯的类别 = **生图 + 生视频 + 音频/TTS**（不含 LLM、不含 3D —— kie 索引里 `chat/gpt-5-*`、`claude/*` 十几个且更新极频，开了就是噪音）。

---

## 一、核心判断：把「发现」和「判断」拆成两层

论文雷达是纯 LLM 活（arxiv 每天几百篇，只能靠模型分诊）。**模型雷达不是**——「这家文档有没有多出一个模型」是**可判定的集合差**，不是判断题。

所以拆两层：

| 层 | 是什么 | 谁干 | 成本 |
|---|---|---|---|
| **发现层** | 抓两家索引 → 归一 → 与上次快照做差 → 与我们目录交叉引用 | `scripts/model-radar.ts`（确定性脚本） | **无新增额度**，纯网络 + 本地计算 |
| **判断层** | 这个新模型对 Nomi 有没有用？怎么建模？和现有档案合还是分？ | `nomi-model-radar` 技能（agent） | 只在**真有新东西时**才花 |

这个拆分是本设计的要点：**没有新模型的日子，雷达零额度成本**。用 LLM 去比对两个字符串集合既贵又不可靠（会「看漏」「看错」），而脚本比对是确定的、可测的、可回归的——与本仓「门岗用脚本、判断用 agent」的既有分工一致。

## 二、数据源：两家都有机器可读的完整索引

实测（2026-08-27）：

| 供应商 | 索引 | 体积 | 结构 |
|---|---|---|---|
| kie | `https://docs.kie.ai/llms.txt` | 75KB / 516 条 | `- 分类 > 家族 [标题](url): 描述` —— **分类就在行里** |
| apimart | `https://docs.apimart.ai/llms.txt` | 49KB / 164 条 | `- [标题](url): 描述` —— 分类由 URL 路径段派生（`/images/` `/videos/`） |

体积小到可以直接把快照提交进仓库（`docs/research/model-radar/<vendor>.json`）——快照进 git 的价值：差异可 review、换机器不丢、「上次见过什么」有权威出处而不是某台机器的本地状态。

**apimart 另有 `GET /v1/models?expand=…`（带 capability/parameter schema，官方标注 for automation）**，比文档索引更权威。但它要 API key，而 key 是 safeStorage 加密存在 Electron 里、独立脚本解不开。故本轮**统一用 llms.txt**（两家同构、免凭证、零成本），把 `/v1/models` 记为后续增强。

## 三、三个必须处理的坑（都是实测出来的，不是预想）

1. **文档路径 ≠ 模型 id**。kie 的文档路径是 `market/flux2/pro-text-to-image`，而真实 model id 是 **`flux-2/pro-text-to-image`**（带横杠）。按路径直接比对会把已接的模型报成「新的」。
   → 覆盖比对**两边都归一**（小写 + 去掉所有非字母数字）后再比。
2. **本地化镜像**。kie 索引里每个页面都有 `/cn/` 镜像（`market/wan/3-0-video.md` 与 `cn/market/wan/3-0-video.md`）。不去重 = 每个模型报两遍，且文档结构一动就诈胡。
   → 归一时剥掉语言段。
3. **「我们有没有」不能只看 catalog 行**。很多模型是以**档案 identifierPatterns / variants.modelKey / modes.modelEnum** 的形式被覆盖的（如 kie Seedream 5 的改图是独立 id，走 modelEnum；Wan 3.0 高速版走 variant）。只比对种子 catalog 行会把它们全报成未接。
   → 覆盖集 = 种子 modelKey ∪ 档案 identifierPatterns ∪ variants.modelKey ∪ modes.modelEnum，**全部从代码 derive**，不手写清单（手写必漂）。

## 四、脚本契约

`scripts/model-radar.ts`（tsx 跑，可 import 仓库 TS）：

- `pnpm run radar:models` —— 抓 → 归一 → 与快照做差 → 与覆盖集交叉引用 → 打印人类可读摘要 + 写 `docs/research/model-radar/latest.json`
- `--update-baseline` —— 把本次索引写成新快照（确认过之后才更新，否则「新」会被吃掉）
- `--offline <dir>` —— 用本地样本跑（单测与离线复现用，不打网络）

输出三类：
- **new**：本次索引有、上次快照没有 → 「他们上新了」
- **removed**：上次有、本次没有 → 「他们下架了」（同样重要：我们可能还在种一个已下线的模型）
- **uncovered**：在盯的类别里、但我们覆盖集里没有 → 「存量缺口」（首次跑会一大批，属正常）

**网络**：本机 apimart/kie 需走本地代理，脚本读 `HTTPS_PROXY`/`https_proxy` 环境变量。取不到就直连，失败明确报错——**不静默当成「没有新模型」**（那会让雷达永远绿，是最坏的坏法）。

## 五、技能契约

`.claude/skills/nomi-model-radar/SKILL.md`，仿论文雷达：
1. 跑脚本拿结构化结果。
2. 对 new / uncovered 做**三档分诊**（🟢 值得接 / 🟡 观望 / ⚪ 忽略），每条说清「对 Nomi 哪个痛点」。
3. 写 `docs/research/<date>-model-radar.md`。
4. 向用户汇报 1-2 句：今天上了什么、最该接哪个。
5. 用户确认某个 → **先出接入方案**（契约摘要 + 档案设计 + 与现有档案合/分的理由），点头后才写码。

## 六、不做 / 已知限制

- **不自动改代码**（用户拍板：先出方案）。
- **不覆盖 LLM 与 3D**（用户拍板）。类别过滤是配置化的，将来要开只改一处。
- llms.txt 是否**及时**反映新模型，无法从外部证明——它由各家文档站生成，新模型通常伴随新文档页。这是本设计的基础假设，明着标；若某次上新没进索引，雷达会漏。缓解：`removed` 也报，索引本身异常（条数骤降）会被察觉。
- 首次跑 `uncovered` 会很多（存量缺口），不是 bug。

## 七、验收

1. 脚本单测：归一（横杠/大小写/语言镜像）、diff、覆盖集派生，全部用离线样本，不打网络。
2. 真实跑一次两家，人眼核对：已接的模型不出现在 uncovered 里（抽查 Wan 3.0 / Nano Banana 2 / Seedream 5）。
3. `pnpm run gates` 全过。

## 八、2026-08-31 增补：apimart 索引改版适配 + 供应商级失败隔离

**事发**：08-31 apimart 把根 llms.txt 改成「索引的索引」（71 行：集成指南 + FAQ + 9 个语言
镜像子索引，0 模型页；自述「Follow each `/_llms/` index recursively until you reach
documentation pages」），模型页全部移入 `/_llms/en/api-manual.md`（143 条 api-reference，
行格式与旧根完全一致）。0 条守卫按设计抛错，但 main 串行循环无隔离 → kie 陪葬、
latest.json 不写、整轮 abort。

**改法**（同 commit 落地，无并行版；根因合同
`docs/fixes/2026-08-31-model-radar-vendor-isolation.root-cause.json`）：

1. **采集抽象**：`VENDORS[v].parse(text)`（单 URL 单文本）→ `VENDORS[v].collect(fetchText)`。
   apimart 的 collect 从根索引出发**有界跟进**（≤8 次、visited 去重、只跟英文份 `/_llms/en*`
   ——其余 9 份语言镜像是同册复本），沿途文本合并后走原行解析器；根里若直接列模型页
   （旧扁平结构）同一算法照收，不是 fallback 分支。
2. **失败隔离边界 `collectVendors`**：per-vendor try/catch + 0 条守卫。单家失败 = 该家显式
   「没查成」（摘要 ⚠️ + latest.json `failures[]`），其余照常出差异；快照只在查成的家更新。
   退出码：任一家查成 → 0；全部失败 → 1（failures 先写进 latest.json 留档）。
   「没查成」永远不许被读成「没有新模型」。
3. **`--offline` 命名**从 `<vendor>.txt` 改为 URL 派生（`offlineFileName(url)`，如
   `docs.apimart.ai__llms_en_api-manual.md`）——两级索引下一家可能要多份样本。

**验收（08-31 实跑）**：真网一轮 apimart 新增 0 · 下架 0（两级跟进还原出的 127 个 slug 与
08-27 基线完全重合，证明改版纯属文档重组）、kie 正常报出真新增 1（gemini-omni-flash-1-1）；
离线制造单家失败 → 该家标「没查成」、另一家照常、退出码 0；双家全失败 → 退出码 1。
