# 验收与走查证据分级留存与 Cloudflare R2 外置方案

> 状态：📋 方案待拍板
> 协作看板：`#1586`（`Q-evidence-r2`） · 线/负责人：`gemini-q-evidence-r2` · 类别：[其他]（纯工程基础设施与仓库减负方案，不改桌面端产品界面、花钱链路或用户数据格式）
> 统一规矩对齐：小桌面应用，只守创作者常走的路及这条路上的钱和数据安全；工程留档走极简现成标准（Cloudflare R2 + SHA-256 内容寻址 + Node 24 内置模块），不造后台服务、不碰生产桶配额、边角记一行不写代码。

---

## ★0 先查别人

- https://github.com/git-lfs/git-lfs/blob/main/docs/spec.md · Git LFS 指针规范用纯文本 `oid sha256:<64位hex>` + `size <字节数>` 替代工作树大二进制，但强耦合代码托管商的 LFS 存储与出站带宽配额，客户端必须额外安装 `git-lfs` 过滤器，且在 GitHub PR 评审页常退化为不可直看的指针文本 · **改了**：借用其 `sha256` 不可变寻址与字节长度自校验语义，但**不引入 Git LFS**，直接采用「公开只读 HTTPS 链接 + `sha256:<64位hex>`」纯文本行，零客户端扩展、GitHub PR 原生渲染图片。
- https://developers.cloudflare.com/r2/pricing/ · Cloudflare R2 提供账号级每月 10 GB 标准存储、100 万次 Class A（写/列）操作、1,000 万次 Class B（读/HEAD）操作免费额度，且公网出站流量（Egress）全档位免流量费 · **确认了**：存量约 329 MiB（0.34 GB）重证据加每月约 0.22 GB 增量长期处于 10 GB 免费线内，PR 评审刷图与 CI 探活零流量账单；同时确认免费额度按**账号级汇总**，必须与同账号现有桶统筹配额上限。
- https://developers.cloudflare.com/r2/api/tokens/ · Cloudflare R2 API Token 支持把权限最小化收窄至「指定单桶（Specific bucket）+ Object Read & Write」，公开读可通过绑定自定义域名（Custom Domain）挂接 Cloudflare CDN 缓存并只暴露 `GET` / `HEAD` · **确认了**：上传侧严禁申请账号全局令牌，只签发仅限新桶 `nomi-evidence` 的单桶读写凭证；读取侧与 CI 合并档门岗走公开只读域名匿名校验，零密钥进仓库、零 Fork PR 泄密面。
- https://playwright.dev/docs/test-snapshots · Playwright 官方视觉回归将「自动化测试进程本地同步像素比对的黄金快照（baselines）」与「单次运行产出的截图/录屏报告（test-results / traces）」严格分家：前者小而稳随测试目录管理，后者走外部存储归档 · **确认了**：「被单测/视觉门岗运行时直接读取的黄金快照（`tests/ux/design-lab/__baselines__/`）与轻量文本夹具留仓，一次性 PR 验收截图/录屏与超限原始抓包一律外置 R2」的切分边界。
- `workers/nomi-asset-relay/wrangler.toml:10`（及 `workers/nomi-asset-relay/src/index.mjs:13`、`infra/feedback-worker/wrangler.jsonc:16`） · 实查仓库现有两套 Cloudflare R2 设施：`nomi-assets` 为创作者生成素材的 24h 兜底中转桶（配 `MAX_STORAGE_BYTES=8000000000` 硬停机锁，无 `expiresAt` 的对象永不删除且计入 8 GB 账本，超限即 `507` 阻断创作者上传）；`nomi-feedback-intake` 为用户脱敏反馈只写桶 · **改了**：工程证据**绝不混入** `nomi-assets` 或 `nomi-feedback-intake`，必须新建独立桶 `nomi-evidence`，物理隔离创作者花钱/生产链路配额与用户反馈边界。
- `scripts/check-quality-gate-workflow.node-test.mjs:855`（及 `scripts/check-board-parity.mjs:238`） · `PR Body` 工作流钉死「不跑 `pnpm install`、判据 import 闭包只许用 Node 24 内置模块」以保证改完 PR 正文几秒出结果；同时 `check-board-parity` R11 已跑通「同类产品截图不进仓库、只记 `screenshotSha256`」先例 · **确认了**：门岗校验与上传 CLI 一律用 Node 24 内置 `node:crypto` + `fetch` 实现，不引入 `@aws-sdk/client-s3` 等第三方包。

出口：不涉及：本方案为纯工程证据分级与 R2 外置方案文档，不改动桌面端产品路径，也不新增任何阻断创作者操作的运行时保护。

---

## 一、现状实查画像（基于 `origin/main` `cd33b197d` 实测）

### 1.1 `docs/evidence/` 体量与扩展名分布

对 `docs/evidence/` 全量跟踪文件逐字节统计与 SHA-256 去重扫描结果如下：

- **总体规模**：共 **228** 个顶层子目录（含根级报告），**3,783** 个 Git 跟踪文件，总计 **349,734,117 字节**（二进制 **333.53 MiB** / 十进制 **349.73 MB**，磁盘占用 `342M`）。
- **内容去重潜力**：共 **3,631** 个唯一 SHA-256 内容块（**328.39 MiB**），跨目录完全相同的重复文件 **152** 个（改用内容寻址后天然省去 **5.14 MiB**）。
- **重媒体 vs 轻量文本二八比**：
  - 二进制媒体与压缩包（`.png` / `.gz` / `.mp4` / `.jpg` / `.pdf`）共 **2,971** 个文件，合计 **327.13 MiB（占总体积 98.08%）**；
  - 纯文本与结构化文件（`.json` / `.md` / `.txt` / `.jsonl` / `.log` 等）共 **812** 个文件，合计仅 **6.41 MiB（占 1.92%）**；其中单文件 > 64 KiB 的大探针转储仅 **14** 个（共 **1.84 MiB**），其余 **798** 个轻量文本报告与小收据合计仅 **4.57 MiB**。

| 扩展名 | 文件数 | 字节数 | 体积（MiB） | 占比 | 性质归类 |
| --- | ---: | ---: | ---: | ---: | --- |
| `.png` | 2,933 | 327,007,986 | 311.86 | 93.50% | 二进制走查/验收/并排对比截图（最大头） |
| `.gz` | 2 | 11,007,877 | 10.50 | 3.15% | 压缩原始通信抓包（如 `q3-wire.jsonl.gz` 7.54 MiB） |
| `.json` | 492 | 4,551,794 | 4.34 | 1.30% | 探针摘要、成绩单记录与收据（含少量 >64 KiB 大转储） |
| `.mp4` | 13 | 2,878,192 | 2.74 | 0.82% | 交互录屏与生成结果留档 |
| `.jpg` | 22 | 2,113,316 | 2.02 | 0.60% | 真付费样本与截图留档 |
| `.md` | 186 | 1,301,603 | 1.24 | 0.37% | 独立验收报告、对账说明、体验成绩单页面 |
| `.txt` | 101 | 470,621 | 0.45 | 0.13% | 命令输出与延迟测量摘要 |
| `.jsonl` | 3 | 280,207 | 0.27 | 0.08% | Agent 真实轨迹原始记录 |
| 其余 8 类（`.log`/`.mjs`/`.xml`/`.mts`/`.pdf`/`.html`/`.py`/`.patch`） | 31 | 122,521 | 0.12 | 0.03% | 零星日志与历史一次性探针附件 |
| **合计** | **3,783** | **349,734,117** | **333.53** | **100.00%** | — |

### 1.2 Top 10 最大子目录

| 排名 | 子目录（`docs/evidence/<目录>`） | 文件数 | 体积（MiB） | 占 `docs/evidence/` 比例 | 主要构成 |
| ---: | --- | ---: | ---: | ---: | --- |
| 1 | `2026-11-24-t5-onboarding-s6` | 31 | 24.76 | 7.42% | 高清并排对照 PNG（单张 `board-vs-impl-o6.png` 5.14 MiB） |
| 2 | `2026-09-19-skill-reach` | 168 | 24.53 | 7.35% | 原始抓包 `q3-wire.jsonl.gz`（7.54 MiB）+ 走查截图 |
| 3 | `2026-10-08-shell-redesign` | 100 | 15.59 | 4.67% | 外壳重设计中英明暗全态 PNG |
| 4 | `2026-10-19-b1a` | 155 | 12.40 | 3.72% | 生成框 B3 四宿主 × 中英 × 明暗矩阵 PNG |
| 5 | `2026-10-08-canvas-handles` | 79 | 9.39 | 2.81% | 画布拉环交互全态 PNG |
| 6 | `2026-11-09-min-window-dialog-clip` | 88 | 8.74 | 2.62% | 最小窗口弹窗裁剪走查 PNG |
| 7 | `2026-10-08-generation-list-view` | 55 | 8.03 | 2.41% | 生成页列表视图走查 PNG |
| 8 | `2026-10-24-icons-f1-r3` | 140 | 7.80 | 2.34% | 图标语义普查截图 |
| 9 | `2026-10-10-no-accent-outline` | 66 | 7.39 | 2.22% | 去强调色描边前后对照 PNG |
| 10 | `2026-10-06-storyboard-reuse` | 108 | 7.13 | 2.14% | 分镜表复用画布底栏走查 PNG |

> 边角记一行（不纳入首轮清理范围）：全仓 `docs/` 下另有 `docs/design/`（158.33 MiB）、`docs/plan/*-evidence` 等非 `.md` 附件（约 55 MiB）、`docs/audit/`（45.36 MiB）含历史截图；先把最大头 `docs/evidence/`（333.53 MiB）的 R2 管道与门岗跑稳，其余目录后续按同一套工具归并，首轮不顺手扩面。

### 1.3 门岗、单测与走查对 `docs/evidence/` 的真实引用核查

逐一核查全仓非文档代码（106 个提及 `docs/evidence` 的代码/脚本/配置）与全仓 3,045 篇跟踪 Markdown，按**运行时真读盘**与**仅文本/输出路径引用**严格切分：

1. **自动化单测运行时真读盘（全仓仅 1 处，只读 4 个轻量文本文件，零二进制读取）**：
   - `tests/ux/experience/scorecard.node-test.mjs:45`：运行时读取 `docs/evidence/2026-10-21-ux-scorecard/{pr1264-rewrite,pr1181-node-guidance}.scorecard.{json,md}` 共 **4 个文本文件（合计 24.6 KB）**，断言 JSON 与渲染出的 Markdown 一致。核过 `tests/ux/experience/scorecard.mjs:21-73`，`validateScorecard` 只核 `card.evidence` 为非空字符串数组，**不调 `fs.existsSync` 检查同目录 `1264-shots/*.png`**。
   - 其余源码与单测（如 `electron/capabilityCore/generationDomainRefusalReachesModel.test.ts:3`、`electron/agentLane/laneRepeatedFailure.test.ts:35`）仅在注释里标明用例源自某次实测，测试数据早已内联为 TS 常量，运行时零读取 `docs/evidence/`。
2. **全仓死图门岗（`scripts/check-docs-index.mjs` + `scripts/docs-index-lib.mjs:107` `findDeadImageEmbeds`）**：
   - 门岗规则：全仓跟踪 `.md` 中凡是正文（非代码块、非行内反引号）写相对路径嵌图（如 `` `![说明](相对路径.png)` ``），目标文件必须存在（基线 0）；而 `https://` 外链不联网、直接放行。
   - 实扫全仓 3,045 篇 `.md`：`docs/evidence/` **外部**指向 `docs/evidence/` 的相对路径嵌图为 **0 处**；`docs/evidence/` **内部**仅有 **6 篇 `.md` 含 17 处相对嵌图**（`2026-09-10-thinking-rows/README.md` 7 处、`2026-10-11-video-edit-acceptance.md` 3 处、`2026-11-22-agent-slash-skill-popover/board-vs-impl.md` 2 处、`2026-11-22-kling-edit-auto-aspect/board-vs-impl.md` 2 处、`2026-11-22-spend-ask-split-r2/board-vs-impl.md` 2 处、`2026-11-24-mo-motion-slice1/window-acceptance.md` 1 处）。存量 PNG 迁出时同步将这 17 处替换为 R2 HTTPS 链接，死图门岗即零冲突。
   - 文档索引覆盖门岗 `scanDocumentIndex`（`docs-index-lib.mjs:19`）只管 `docs/plan`、`docs/superpowers/plans`、`docs/lessons`，不扫 `docs/evidence/`。
3. **PR 正文判据与合并前扫描（`check-pr-judgement.mjs` / `pr-body-criteria.mjs` / `pr-judgement-lib.mjs` / `prEvidenceInputs.mjs` / `merge-preflight.mjs`）**：
   - **证据行语法**（`pr-judgement-lib.mjs:293,334`）：`EVIDENCE_TOKEN` 与 `PAID_SAMPLE_PROOF` 均已原生认 `https?:\/\/\S+`。
   - **独立验收报告读取**（`prEvidenceInputs.mjs:74`、`merge-preflight.mjs:88`）：`readReport` 对仓内相对路径走 `git show <headSha>:<path>` 核对报告首行结论、验收 HEAD 与验收线编号；对 `https:` 返回 `null` 判红。因此**独立验收报告 `.md` 本体必须继续留仓（或协调本地报告目录），只把报告内引用的截图/视频外置 R2**。
   - **性能原始数据读取**（`prEvidenceInputs.mjs:73`、`perf-scenarios-lib.mjs:67`）：`perf-scenario` 证据行的 `readRaw` 默认读 `tests/perf/results/*.json` 轻量统计文件，与 `docs/evidence/` 二进制媒体正交。
   - **验收后补交证据免重验规则**（`prEvidenceInputs.mjs:88-133` `checkHeadAncestry`）：现行允许验收 HEAD 之后只追加 `docs/evidence/**` 下的不可执行文件（`EVIDENCE_EXTENSIONS = /\.(?:png|jpe?g|webp|gif|json|md|txt|csv|log)$/i`）免重验。外置 R2 后，补交轻量 `.md` 报告或 `manifest.json` 照旧免重验；同时将 `EVIDENCE_EXTENSIONS` 收紧去掉 `png|jpe?g|webp|gif`，堵住验收后往 Git 塞新图的旁路。
4. **账本、根因合同、拍板图清单与静态扫描**：
   - `tests/ux/full-walk/escapeLedger/*.json`（31 处提及）、`docs/fixes/*.root-cause.json`（14 处提及）、`docs/design/boards/**/*.json`（8 处提及）：实核 `escape-ledger-lib.mjs`、`root-cause-contracts.mjs`、`check-board-parity.mjs`，均只对 `rootCauseContract`、`classCheck.file`、`shared_boundaries`、`component` 等代码与测试路径做存在性检查，**不对说明文字或 `evidence[]` 里的历史截图路径调 `fs.existsSync`**。
   - `tests/system/walks-never-trash-projects.test.mjs:19`：扫描 `docs/evidence` 下脚本文件是否误调系统回收站，目录瘦身后零影响。
   - **36 个走查与真付费脚本**（`tests/ux/*.walk.mjs`、`*.paid.mjs` 等）：仅把 `docs/evidence/<日期>-<主题>/` 作为本机运行时的截图写盘输出目录，没有任何脚本从 `docs/evidence/` 读取测试输入。

### 1.4 仓库已有 Cloudflare / R2 基础设施只读盘点

只读检查仓库内跟踪的 `wrangler.json`、`worker/`、`workers/`、`infra/` 与 `.github/workflows/`（未触碰任何真实密钥、未读用户目录配置、未调外部 API）：

| 位置 | 服务 / Worker 名 | 绑定 R2 桶名 | 现行职责与配额护栏 | 能否给工程证据复用 |
| --- | --- | --- | --- | --- |
| `wrangler.json` + `worker/` | `nomi` | 无（仅静态 Assets `./marketing`） | 官网静态资源、视频 Range 请求与无状态回调 | **否**（官网生产流量入口） |
| `workers/nomi-asset-relay/` | `nomi-asset-relay` | `nomi-assets` | 创作者生成素材 24h 临时兜底中转；`MAX_STORAGE_BYTES=8000000000`（8 GB）且 `MAX_MONTHLY_BUDGET_USD=0`，每小时清理带 `expiresAt` 对象；无 `expiresAt` 对象永不删但计入 8 GB 硬停机线 | **严禁复用**（永久证据会吃掉创作者生产素材的免费配额与 900 次列表子请求预算，触发 `507/503` 拒传事故） |
| `infra/feedback-worker/` + `scripts/lib/intake-radar/cloudflare.mjs` | `nomi-feedback-intake` | `nomi-feedback-intake` | 桌面端脱敏反馈与白名单事件的只写收集桶；协调侧雷达通过 `npx wrangler auth token --json` 内存取短期 OAuth 令牌只读拉取 | **严禁复用**（用户反馈数据与公开工程截图必须物理隔离，且该桶严禁公开读） |
| `.github/workflows/*` | GitHub Actions（13 个工作流） | 未接 R2（暂用 `actions/upload-artifact@v7`） | `pr-body.yml` 只读权限、裸 Node 24、不跑 `pnpm install` | 合并档门岗保持**零密钥匿名 `HEAD`**，杜绝 Fork PR 密钥暴露 |

---

## 二、精炼设计卡（★ 5 格）

- **★1 用户怎么用**：
  - **场景**：当实现线、验收线或协调会话跑完真窗口走查 / 真付费验证 / 并排样张对账，需要在 PR 正文或独立验收报告里提交不可篡改的截图/录屏证据，同时保持 Git 仓库轻量快速时，运行一条 `pnpm run evidence:put <本地图或目录>`，自动完成敏感信息预扫、SHA-256 计算、R2 幂等上传，并在终端直接吐出带 `sha256` 的标准 Markdown 粘贴行与可选 `manifest.json`。
  - **步骤（5 步）**：① 走查脚本将截图写到仓库外或被 Git 忽略的本地目录；② 跑 `pnpm run evidence:put <路径>`（本地先过 `check-no-secrets` 规则，算 `sha256`，`HEAD` 查重后上传 `nomi-evidence` 桶）；③ 复制终端吐出的标准 `[文件名](https://.../cas/<前2位>/<sha256>.<ext>) (sha256:<64位hex>, <字节数>B)` 粘进 PR 正文 `## 验收证据` 或验收报告 `.md`；④ 推送分支时 `--stage=push` 离线校验格式与哈希自洽；⑤ 开 PR / 改 PR 正文时 `PR Body`（`--stage=merge`）与 `merge-preflight` 自动 `HEAD` 核验线上对象真实可读且字节数吻合。
  - **不做什么 + 已知坑**：不自建图床后台 UI、不做浏览器上传页、不改写 `main` Git 历史；已知坑是 `check-docs-index` 会把文档正文裸写的相对路径嵌图当真图检查，故规范文档中的示例语法一律放代码块或反引号内。
  - **真实任务（3 条）**：① 单次界面 PR 走查上传 8 张中英明暗对比 PNG 并生成粘贴行过 `PR Body` 合并档；② 验收线在验收通过后往分支补交一份纯文本 `docs/evidence/<日期>-<主题>/acceptance.md`（内含 R2 图链），验证 `checkHeadAncestry` 免重验放行；③ 一次性将 `main` 存量 2,985 个重文件（328.97 MiB）幂等迁入 R2、修正仓内 6 篇 `.md` 的 17 处嵌图并 `git rm` 瘦身。
  - **指标与量具（目标 → 信号 → 指标）**：
    - 主指标（新检出减负）：工作树 `docs/evidence/` 跟踪字节占比 → `git ls-files -z docs/evidence` 汇总字节 → 从 **333.53 MiB 降至 ≤ 5.0 MiB**（减负比例 ≥ 98%，量具：未来 `scripts/check-evidence-storage.mjs`）；
    - 质量指标（防假链/防死链）：PR 合并档引用的 R2 证据可解析且线上实存比例 → `check-pr-judgement.mjs --stage=merge` 校验通过率 → **100%（假哈希或未上传对象拦截率 100%）**（量具：`scripts/pr-body-gates.node-test.mjs`）；
    - 护栏指标（防新二进制回流）：新 PR 向 `docs/evidence/` 提交二进制媒体的放行数 → 门岗拦截测试 → **0 个**（量具：`scripts/check-evidence-storage.node-test.mjs` + `scripts/check-docs-index.node-test.mjs`）。
  - **★1b 连带界面**：桌面端产品界面零改动；工程侧连带露出仅 3 处：① `check-pr-judgement.mjs` 报错提示文案（写明缺 `sha256` 或 `HEAD` 404 的修复命令 `pnpm run evidence:put`）；② `check-no-secrets.mjs` / 新门岗拦本地误 `git add` 截图时的指引文案；③ 验收报告模板注释。
  - **★1c 老用户**：不适用：完全不触碰桌面端用户项目、设置、模型目录或本地资产文件，老用户升级与回退上一版均零感知。工程侧历史追溯兼容：存量轻量 `.md/.json/.txt` 原路径保留，迁出的 2,985 个重文件留存 `ARCHIVE-MANIFEST.json` 映射（`原路径 → R2 URL + sha256`），旧 PR / 逃逸账本 / 根因合同里的历史路径均可一键反查。
- **★2 谁说了算**：
  - **唯一 owner**：
    1. 「哪些证据允许进 Git、R2 证据 URL + `sha256` 格式怎么判」唯一归属：`scripts/lib/evidenceStorage.mjs`（纯函数库，仅用 Node 内置模块），由 `check-pr-judgement.mjs`、`merge-preflight.mjs` 与 pre-commit 门岗共用同一份判据（保持全仓 **1 份定义**，不在工作流 YAML 或多个脚本里各写一套正则）；
    2. 「本地文件上传 R2 与生成粘贴行」唯一归属：`scripts/evidence-r2.mjs`（`pnpm run evidence:put`）。
  - **读写与结束边界**：上传凭证只存在于本机用户态环境/钥匙串或受控 Nightly Secret，上传完成即输出不可变 `cas/` URL 结束，无后台轮询；`--stage=merge` 读取侧发现网络瞬断超时（非 404/403）按 `PreflightDataError` / 取数失败报明确重试提示，**绝不把「没连上」静默当通过，也不把瞬断谎报成哈希造假**。
- **★3 一致与复用**：
  - **以前定过什么**：① `check-docs-index.mjs:15`（2026-11-14）已写明「证据目录要整体搬出仓库，嵌图指向搬走的文件就是死图（基线 0）」——完全算数，本方案直接兑现该预设；② `check-board-parity.mjs:238`（R11）已定「截图不进仓库，只记 `screenshotSha256`（64 位 hex）」——完全算数，哈希口径同为小写 64 位 SHA-256；③ `pr-body.yml` 钉死「裸 Node 24 无 `node_modules`」——完全算数，严守内置模块闭包。
  - **三条路选哪条**：① 接 Git LFS（受 GitHub 免费 1 GiB 带宽配额卡脖子，刷几次 PR 就停服收费，且客户端需装扩展，否决）；② 复用现有 `nomi-assets` Worker 中转桶（会挤占创作者兜底素材 8 GB 免费安全垫并污染 24h TTL 清理，否决）；③ **新建独立 R2 桶 `nomi-evidence` + `cas/<前2位>/<sha256>.<ext>` 不可变寻址 + Node 内置上传/校验**（选此路：零出站费、与生产隔离、天然去重防篡改、裸 Node 可核）。复用仓库既有 `scripts/lib/transientRetry.mjs`（网络瞬断重试）与 `scripts/check-no-secrets.mjs`（上传前敏感扫描）。
- **★4 全状态**（CLI 与门岗终端状态，不涉产品 UI）：
  - 空输入：未传文件或目录为空 → 退出码 `2`，打印用法示例；
  - 上传中 / 命中去重：`HEAD` 命中远端同哈希对象打印 `⏭ 已存在（去重跳过 PUT）` 并直接吐出标准链接行；未命中则上传并打印进度；
  - 成功：输出标准 Markdown 行（及可选写出 `manifest.json`），退出码 `0`；
  - 失败（内容违规 / 403 / 404）：上传前命中 `check-no-secrets` 敏感规则立即本地拒传（退出码 `1`）；`--stage=merge` 发现 URL 哈希前后矛盾或远端 `404` 明确打印违规行与修复命令；
  - 部分成功：批量传多图时逐张幂等落地，失败项集中列尾并返回非 `0`，重跑自动跳过已成功项；
  - 取消中（`Ctrl+C`）：中断当前 `PUT` `AbortController`，因为 R2 `PUT` 原子生效且桶配置 7 天自动清理未完成分片，不留半截脏对象；
  - 过期：凭证过期打印 `R2 上传凭证无效或已过期，请检查 ~/.config/nomi/r2-evidence.env 或重新配置单桶令牌`；对象本身 `immutable` 永不过期；
  - 能力不可用（本机未配 R2 写凭证）：`evidence:put` 明确报错并给出两步下一步指引（① 向协调索取/配置 `nomi-evidence` 写凭证，或 ② `--dry-run` 先算本地 `sha256` 清单交有凭证的协调机代传），绝不退回把 `.png` 塞进 Git。
- **★9 验收与回滚**：
  - **动手前写定的实施验收清单与反例**（供后续实施 PR 自验与独立验收线逐条核对）：
    1. **目标拦截测试**：向 `docs/evidence/2026-12-01-demo/shot.png` 新增一张 PNG，跑门岗必须判红；把门岗换成「什么都不做」版本则漏放（证明判据有效）；向同目录新增 ≤ 64 KiB 的 `acceptance.md` 则正常放行（证明「全部拦下」通不过）。
    2. **反例 A（路径前缀/扩展名绕过）**：把 PNG 改后缀伪装成 `.txt`（文件头仍为 `\x89PNG` 魔数）或挪去 `docs/plan/xxx-evidence/shot.png` 提交 → 门岗同时查扩展名与常见媒体魔数（PNG/JPEG/RIFF-WEBP/ftyp-MP4/GZIP），照样判红。
    3. **反例 B（URL 与声明 `sha256` 篡改不一致）**：PR 正文写 `https://.../cas/4c/4cac...png` 但后面跟 `sha256:9999...`（或路径前缀写成 `cas/aa/4cac...`）→ `--stage=push` 与 `--stage=merge` 均当场判红。
    4. **反例 C（编造未上传的合法格式假链接）**：构造一条语法与前后哈希完全自洽、但从未上传到 R2 的 64 位 hex 链接放进 PR 正文 → `--stage=push` 放行（离线快检），`--stage=merge`（`HEAD` 返回 404）与 `merge-preflight` 必须判红拦住。
    5. **反例 D（验收后补交证据衔接）**：验收 HEAD 之后只追加 1 个提交修改 `docs/evidence/2026-12-01-demo/acceptance.md`（含 R2 图链）→ `checkHeadAncestry` 判 `ok: true` 免重验；若追加提交含 `shot.png` → `checkHeadAncestry` 判 `ok: false` 要求重验或移除二进制。
    6. **反例 E（裸 Node 闭包守卫）**：跑 `node --test scripts/check-quality-gate-workflow.node-test.mjs` → 断言 `check-pr-judgement.mjs` 全导入闭包仍只有 Node 内置模块（外部包 = 0）。
    7. **存量清理无损核验**：存量清理 PR 上跑全量 `check:docs-index`（死图 = 0）、`scorecard.node-test.mjs`（绿）、`ARCHIVE-MANIFEST.json` 条目数 == 被 `git rm` 文件数且随机抽检 20 个 URL 实下字节 `sha256` 100% 吻合。
  - **回滚**：本方案阶段仅 1 篇纯文档，直接 `git revert <commit>`；后续存量清理 PR 因严守不改写 Git 历史且 R2 桶只增不删，任何误删文件均可单条 `git checkout <merge-base> -- <path>` 或整单 `git revert` 秒级无损恢复。

---

## 三、架构方案：明确回答四件事

### ① 哪些证据留仓库 vs 哪些去 R2

按「**门岗/单测是否在本地同步读它 + 是不是纯文本小摘要**」一刀切，不留模糊地带：

| 类别 | 具体内容与典型路径 | 去向 | 大小 / 行数硬约束 | 理由 |
| --- | --- | --- | --- | --- |
| **A. 纯文本验收结论与成绩单** | 独立验收报告、走查结论摘要、体验成绩单（`docs/evidence/<日期>-<主题>/README.md`、`acceptance.md`、`*.scorecard.{json,md}`） | **留 Git 仓库**（或协调本地报告目录） | 单文件 **≤ 64 KiB**，且受 `Q-pr-weight` 整单净增 1000/2000 行门岗约束 | Git 可 diff、可行级评论；`prEvidenceInputs.mjs` 的 `readReport` 需要用 `git show <headSha>:<path>` 离线读取核对首行结论与验收 HEAD |
| **B. 自动化测试同步读取的小夹具 / 像素校准基线** | 性能当次结果 `tests/perf/results/*.json`、设计实验室校准基线 `tests/ux/design-lab/__baselines__/*.png`、旧版升级样本 `tests/fixtures/**` | **留 Git 仓库**（住 `tests/`，不住 `docs/evidence/`） | 文本夹具 ≤ 64 KiB；视觉黄金快照仅限 `check:design-lab` 纳管的校准目录 | 单测与 `perf-scenario` 门岗每次离线运行都要直接读盘比对，外置会引入测试网络脆弱性 |
| **C. 批次证据轻量清单（可选）** | 多图走查的映射表 `docs/evidence/<日期>-<主题>/manifest.json` | **留 Git 仓库** | 单文件 **≤ 16 KiB**（纯 JSON：`name` / `sha256` / `bytes` / `url`） | 让 20+ 张状态矩阵图不必刷屏塞爆 PR 正文，且支持验收后免重验补挂 |
| **D. 所有二进制媒体留档证据** | 走查截图、样张并排对比图、交互录屏、真付费产物样本（`.png` / `.jpg` / `.jpeg` / `.webp` / `.gif` / `.mp4` / `.mov` / `.webm` / `.pdf`） | **一律去 R2（严禁进 Git）** | 单文件上限 200 MiB（走 CLI 上传） | 占当前 `docs/evidence/` 体积的 **98.08%**；Git 无法文本 diff，每改一次永久膨胀 `.git` 历史 |
| **E. 超限原始探针抓包与长轨迹转储** | 压缩抓包 `.gz` / `.zip`、单文件 > 64 KiB 的 `.jsonl` / `.log` / `.har` / 原始大 `.json` | **一律去 R2（严禁进 Git）** | 超过 **64 KiB**（或 > 500 行）一律外置；仓内只留 ≤ 几 KB 的结论摘要 | 防止单份 `q3-wire.jsonl.gz`（7.54 MiB）这类原始转储撑爆仓库与 PR diff |

#### R2 不可变内容寻址路径（CAS Key 规范）

所有上传至 `nomi-evidence` 桶的对象统一采用纯内容寻址键名，**不把易变的分支名、日期或 PR 号编码进对象主键**：

```text
cas/<sha256前2位小写hex>/<sha256完整64位小写hex>.<规范化小写扩展名>
```

示例：

```text
https://evidence.nomi.video/cas/4c/4cac19622fc3ada9c0fdeadb33f88f367b541f38b89102a3f1261ac81fd5bcb5.png
```

**为什么选 `cas/<前2位>/<sha256>.<ext>` 而不是 `<pr号>/<文件名>`**：
1. **开 PR 前即可生成最终链接**：实现线本地自验跑完截图，在 `gh pr create` 之前就能上传拿到永久不变的 URL，无需拿到 PR 号再搬家重传。
2. **URL 自带防篡改承诺**：键名即文件内容的密码学哈希，任何人把图替换成另一张图，哈希必变、原 URL 内容不可抵赖；配合上传时写入 `Cache-Control: public, max-age=31536000, immutable` 与 `If-None-Match: "*"`（禁止覆盖写），实现零数据库防篡改。
3. **跨分支天然去重**：多轮 rebase 或多线跑出相同截图，上传前一次 `HEAD` 返回 `200` 即秒级跳过 `PUT`，零额外存储与写操作消耗；人类可读的文件语义（如 `board-vs-impl-zh.png`）保留在 Markdown 链接文本与 `manifest.json` 里。

---

### ② PR 正文与验收报告里怎么留链接和 `sha256`（及门岗两档校验衔接）

#### 2.1 唯一标准引用格式

由一键上传脚本 `pnpm run evidence:put <文件或目录>` 自动计算并向终端打印以下标准格式，直接复制粘贴（注：下方示例置于代码块内，遵守仓库死图扫描规矩）：

**格式 A：PR 正文 `## 验收证据` 单行条目（1–4 个文件时直接贴）**

```markdown
- ui-visual-walkthrough：[board-vs-impl-zh.png](https://evidence.nomi.video/cas/4c/4cac19622fc3ada9c0fdeadb33f88f367b541f38b89102a3f1261ac81fd5bcb5.png) (`sha256:4cac19622fc3ada9c0fdeadb33f88f367b541f38b89102a3f1261ac81fd5bcb5`, 142850B)
```

**格式 B：验收报告 `.md` 或 PR 正文内需要直接展开预览的关键对比图**

```markdown
![board-vs-impl-zh](https://evidence.nomi.video/cas/4c/4cac19622fc3ada9c0fdeadb33f88f367b541f38b89102a3f1261ac81fd5bcb5.png)
- 指纹：`sha256:4cac19622fc3ada9c0fdeadb33f88f367b541f38b89102a3f1261ac81fd5bcb5`（142850B）
```

**格式 C：多图矩阵（≥ 5 个文件时，避免刷屏 PR 正文）**
`pnpm run evidence:put <目录> --manifest docs/evidence/<日期>-<主题>/manifest.json` 自动生成轻量清单留仓，PR 正文只贴 1–2 张关键代表图 + 清单路径：

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-28T00:00:00Z",
  "files": [
    {
      "name": "board-vs-impl-zh.png",
      "sha256": "4cac19622fc3ada9c0fdeadb33f88f367b541f38b89102a3f1261ac81fd5bcb5",
      "bytes": 142850,
      "url": "https://evidence.nomi.video/cas/4c/4cac19622fc3ada9c0fdeadb33f88f367b541f38b89102a3f1261ac81fd5bcb5.png"
    }
  ]
}
```

#### 2.2 `check-pr-judgement.mjs`（裸 Node 24、无 `node_modules`）两档怎么核

严格遵守 `.github/workflows/pr-body.yml` 与 `check-quality-gate-workflow.node-test.mjs:855` 的硬约束——**只用 Node 24 内置模块（`node:crypto`、`node:https` / 全局 `fetch`），零 npm 依赖、零 R2 密钥**：

| 阶段 / 入口 | 运行环境 | 校验内容 | 失败判定 |
| --- | --- | --- | --- |
| **本地 `pre-commit` + CI `Contracts` 文件门岗** | 本机 Git 钩子 + Ubuntu CI | 扫描本分支相对 `merge-base(HEAD, origin/main)` 新增/修改文件（status `A`/`M`）：凡落在 `docs/evidence/**`（及 `docs/{plan,audit,fixes,research}/**`）且命中媒体扩展名/二进制魔数或单文件 > 64 KiB | **直接判红**，提示用 `pnpm run evidence:put` 外置到 R2 |
| **推送档 `--stage=push`** | 本机 `pre-push` + CI `Contracts` | **纯离线语法与自洽核验（0 网络请求）**：① 识别证据节/报告引用的 R2 链接主机名必须属于白名单域名；② URL 路径必须匹配 `/^\/cas\/([0-9a-f]{2})\/([0-9a-f]{64})\.[a-z0-9]+$/` 且 `$1 === $2.slice(0, 2)`；③ 同一条目或 `manifest.json` 必须带 `sha256:<64位hex>` 且与 URL 中的 `$2` 完全一致 | **格式不合或前后哈希矛盾直接判红**；未补齐独立验收报告照旧只打 `⚠` 提醒 |
| **合并档 `--stage=merge` + 本机 `merge-preflight.mjs`** | `.github/workflows/pr-body.yml`（裸 Node 24）+ 协调本机 | ① 先跑推送档全部语法自洽校验；② 用内置 `fetch(..., { method: 'HEAD' })`（并发 ≤ 4，单次超时 5s，复用内置 `transientRetry.mjs` 重试瞬断）逐条探活 PR 正文及本 PR 新增 `manifest.json` 里的 R2 URL：要求 `HTTP 200`、`Content-Length > 0`（若声明了 `<字节数>B` 则必须精确相等）；③ 协调本机 `merge-preflight` 可选对关键证据流式 `GET` 实算 `crypto.createHash('sha256')` 核对字节未被污染 | **`404/403` 或长度不符直接判红**（彻底堵死「手造 64 位假哈希链接但没真传 R2」）；纯网络超时报取数失败提示重跑 |

#### 2.3 与 `prEvidenceInputs.mjs` 验收后补证据免重验规则的衔接

1. **独立验收报告读取不变**：`prEvidenceInputs.mjs:74` 的 `readReport` 与 `merge-preflight.mjs:88` 的 `readReportRef` 继续从仓内 `docs/evidence/<日期>-<主题>/acceptance.md`（经 `git show <headSha>:...`）或协调本机报告目录读取 Markdown 文本，核对首行「通过 / 有条件通过」、`验收 HEAD` 与 `验收线`；报告里的截图已变成 R2 HTTPS 链接，Markdown 本体体积仅数 KB。
2. **免重验祖先链收紧不破链**：`prEvidenceInputs.mjs:88` 的 `checkHeadAncestry` 将允许在 `验收 HEAD` 之后免重验追加的 `EVIDENCE_EXTENSIONS` 从 `/\.(?:png|jpe?g|webp|gif|json|md|txt|csv|log)$/i` 收紧为 `/\.(?:json|md|txt|csv|log)$/i`（配合 ≤ 64 KiB 上限）。这样验收通过后把 `acceptance.md` 或 `manifest.json` 补交进分支**依然免重验直接放行**，同时从根上禁止在验收后顺手往分支塞未外置的大图。

---

### ③ `main` 上 333.53 MiB 存量怎么处理（不改写 Git 历史）

#### 3.1 为什么坚决不做 `git filter-repo` / 历史重写

严守「禁止 `git filter-repo` / `BFG` / `git push --force` 改写 `main` 历史」铁律：
1. 仓库多线并行（多个活跃 worktree 与在途 PR），改写 `main` 根提交 SHA 会导致所有在途分支与 `origin/main` 失去共同祖先，引发全员 rebase 灾难与旧文件误回退事故（参见历史 `#1032` 教训）；
2. 逃逸账本 `completionCommits`、根因合同、PR 验收 `HEAD` 收据（`delivery:verify-merged`）及已发布版本 Tag 均以真实 commit SHA 为防伪锚点，重写历史会直接击穿整套工程审计链。
> 远期可选项记一行：仅当未来大版本（如 v1.0）决定封存旧史另开新仓时，才考虑离线归档切分，现阶段明确不做。

#### 3.2 前向 `git rm` 的真实减负收益

在 `main` 上通过一次常规 PR `git rm` 移除 328.97 MiB 重文件后：
- 所有 CI 浅检出（`actions/checkout` 默认浅克隆）、新机器推荐克隆方式（`git clone --filter=blob:none` 按需拉 blob 或 `--depth=1`）、新建 sibling worktree 的工作区解包、全仓 `ripgrep` 搜索与编辑器索引，**立刻减负约 329 MiB（`docs/evidence/` 工作树从 333.53 MiB 降至 ~4.56 MiB，缩减 98.6%）**。

#### 3.3 四步无损迁移与清理执行方案

1. **第 1 步：锁定保留白名单（不动任何运行时依赖与历史文本说明）**
   - **单测运行时必留（4 个文件，24.6 KB）**：`docs/evidence/2026-10-21-ux-scorecard/{pr1264-rewrite,pr1181-node-guidance}.scorecard.{json,md}` 原路径保留（确保 `tests/ux/experience/scorecard.node-test.mjs` 零改动全绿）。
   - **轻量历史文本全留（794 个文件，约 4.55 MiB）**：`docs/evidence/` 下所有 ≤ 64 KiB 的 `.md`、`.json`、`.txt`、`.log` 等纯文本报告原位保留，确保逃逸账本（31 处）、根因合同（14 处）、拍板图清单（8 处）与源码注释引用的报告路径全部原位可读。
2. **第 2 步：批量幂等上传 2,985 个重文件并双端核验 SHA-256**
   - 迁移范围：`docs/evidence/` 下全部 **2,971 个二进制媒体/压缩包（327.13 MiB）+ 14 个 > 64 KiB 大文本转储（1.84 MiB）= 共 2,985 个文件（328.97 MiB，去重后约 323.8 MiB 唯一对象）**。
   - 迁移脚本逐个跑敏感扫描 → 计算 `sha256` 与 `bytes` → 幂等上传至 `nomi-evidence` 桶 `cas/<前2位>/<sha256>.<ext>` → 逐条 `HEAD` 核验返回 `200` 且远端 `Content-Length === 本地 bytes`（外加随机抽样 `GET` 复算 `sha256`）→ 写出总映射表 `docs/evidence/ARCHIVE-MANIFEST.json`（记录 `oldPath → { sha256, bytes, url }`，约 2,985 行纯文本，Git 压缩后 < 90 KiB；全部校验 100% 通过前绝不执行下一步删除）。
3. **第 3 步：原位替换仓内 6 篇 `.md` 的 17 处相对嵌图**
   - 按 `ARCHIVE-MANIFEST.json` 自动把 §1.3 查出的 6 篇 `docs/evidence/**/*.md` 里共 17 处相对路径嵌图替换为对应的 R2 HTTPS URL（并附 `sha256`），保证 `check-docs-index.mjs`（`findDeadImageEmbeds` 基线 0）一次全绿。
4. **第 4 步：常规 PR 提交 `git rm` + 门岗封口 + `.gitignore` 防脏树**
   - 同一清理 PR 内执行 `git rm` 移除上述 2,985 个重文件，提交 `ARCHIVE-MANIFEST.json` 与更新后的 6 篇 `.md`；
   - 同批合入「禁止往 `docs/evidence/` 新增二进制与 >64 KiB 大文件」门岗，并在 `.gitignore` 忽略 `docs/evidence/**/*.{png,jpg,jpeg,webp,gif,mp4,mov,webm,gz}`（使 36 个既有 `tests/ux/*.walk.mjs` / `*.paid.mjs` 在本机重跑落盘截图时不会弄脏工作树，同时在 pre-commit 与 CI 门岗双保险拦截 `git add -f`）。

---

### ④ 需要用户拍板与提供的权限清单（供协调统一请示用户）

本阶段**不碰任何密钥、不执行任何线上建桶操作**。请协调会话向用户一次性确认以下 4 项拍板与最小权限配置：

| 序号 | 需用户拍板 / 提供的事项 | 推荐方案（默认项） | 备选方案与取舍 | 安全与配额边界说明 |
| ---: | --- | --- | --- | --- |
| **1** | **R2 Bucket 命名（新建 vs 复用）** | **在现有 Cloudflare 账号下新建独立桶：`nomi-evidence`**（配一条「7 天自动中止未完成分片上传」规则，对象本身永久保留无 TTL） | 无合理复用项（**不推荐**复用 `nomi-assets` 或 `nomi-feedback-intake`） | 物理隔离创作者兜底中转桶 `nomi-assets`；建议同步把 `nomi-assets` 的 `MAX_STORAGE_BYTES` 从 `8 GB` 微调为 `6 GB`，给 `nomi-evidence` 预留 4 GB 缓冲，确保全账号永不越过 10 GB 免费线 |
| **2** | **公开只读访问域名策略** | **绑定自定义子域名（如 `https://evidence.nomi.video`）开启公开只读**（仅放行 `GET` / `HEAD`，开启 Cloudflare CDN 强缓存 `immutable`） | 临时开启桶自带 `https://pub-<id>.r2.dev` 受管公开读做过渡（官方限速，仅适合过渡期，后续迁自定义域需改白名单主机名） | 该桶**仅允许存准备发往 PUBLIC GitHub 仓的脱敏工程验收截图/录屏**；上传 CLI 强制前置跑 `check-no-secrets` 拦截任何隐私数据或密钥 |
| **3** | **上传凭证最小权限范围与注入方式** | 在 Cloudflare Dashboard → R2 → Manage R2 API Tokens 签发一枚**仅限单桶 `nomi-evidence` 的 `Object Read & Write` 令牌**（提供：`R2 Endpoint URL`、`Access Key ID`、`Secret Access Key`） | 本机协调会话若已 `npx wrangler login`，也可在协调本机复用 Wrangler OAuth 短期令牌上传，但伙伴机/独立上传仍建议用单桶受限令牌 | **严禁使用 Global API Key 或 Account Admin Token**；凭证只存协调机/伙伴机仓库外 `~/.config/nomi/r2-evidence.env`（`0600`）或系统钥匙串；**PR CI（`pr-body.yml`）零密钥**（只发匿名 `HEAD`）；仅当未来需 Nightly 自动传失败图时才配进 GitHub Actions Secrets |
| **4** | **月度存储与流量成本确认** | **确认接受（预计月账单 ≈ $0.00）** | 若未来数年累计超过 4 GB，可对 18 个月前已归档老版本的走查原图设归档清理策略 | R2 账号免费额度为 **10 GB-month 存储 + 100 万次写/月 + 1,000 万次读/月 + 公网出站流量 $0**；本次存量迁入 **0.34 GB**（一次性约 3,000 次写），日常月增约 **0.22 GB**（月写 < 2,000 次、月读 < 5 万次且命中 CDN 缓存），远在免费额度之内 |

---

## 四、明确不做

1. **不碰任何真实密钥与线上账号**：本方案提交不读取本机 Wrangler 登录态或系统钥匙串，不调 Cloudflare API，不在仓库任何文件写入真实凭证或账号敏感标识。
2. **不改写 `main` Git 历史**：不跑 `git filter-repo` / `BFG`，不做 `git push --force`，不破坏任何在途分支、PR commit SHA、逃逸账本与根因合同引用。
3. **不自建图床服务端、数据库或上传前端 UI**：不新增额外 Cloudflare Worker 鉴权后端、不引 D1/KV 存哈希映射表、不引 `@aws-sdk/client-s3` 等第三方重依赖；只用 R2 原生对象存储 + 公开只读自定义域名 + Node 24 内置模块。
4. **不混用生产与反馈桶**：绝不往创作者素材中转桶 `nomi-assets` 或用户反馈桶 `nomi-feedback-intake` 写入任何工程测试证据。
5. **不在首轮顺手扩大历史清理目录**：首轮实施只清理最大头 `docs/evidence/`（333.53 MiB）并建好上传工具与门岗；`docs/design/`、`docs/plan/*-evidence`、`docs/audit/` 的历史存量图片待首轮跑稳后按同一套脚本分批归并，不在同一单里大爆炸混改。
6. **不外置自动化单测同步读取的小夹具与视觉校准基线**：`tests/ux/design-lab/__baselines__/*.png`、`tests/perf/results/*.json` 与 `docs/evidence/2026-10-21-ux-scorecard/*.scorecard.{json,md}` 保持仓内本地同步读取，不让单测依赖外网。
