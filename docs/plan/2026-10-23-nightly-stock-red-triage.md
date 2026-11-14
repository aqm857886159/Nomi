# 夜跑存量红分诊清单（2026-10-23，只出清单、不改代码）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 来源：协调线 F-nightly-build-gate PR-3。只读 `gh run download`（nightly-walks-* artifact），未写 GitHub、未改任何代码和 `tests/ux/nightly-ci-exclusions.json`。排期归协调。

## 0. 先答三问

1. 这处近 14 天修过几次：本 PR 只加一份文档，不改热点文件。
2. 是不是我们独有的：分诊是一次性盘点，没有新机制，不适用。
3. 补、换、删：都不是，只出清单；各组的处理建议见第 3 节。

## 1. 数据与缺口

- 看了 4 次夜跑：10-18（39110201487）、10-19（39226781160）、10-20（39394827628）、10-21（39570934046）。10-21 是门岗提交 b414e0862 之前的最后一次，是「稳定红」的基线。10-08 / 10-09 之后到 10-17 的 artifact 本次没取（保留期 14 天，10-08 的已过期），**缺口：10-08 首次运行的逐条日志只能用 docs/research/2026-10-08-nightly-walk-triage.md 对账**。
- 4 次里每条走查的结果型态（P 过 / F 红）：
  - `PPPP` 173 条
  - `FFFF` 149 条
  - `FFF-` 2 条
  - `PPFP` 2 条
  - `FFFP` 1 条
  - `PPP-` 1 条
  - `PPPF` 1 条
  - `FPPP` 1 条
  - `PFFP` 1 条
- **稳定红 = 4 次（或可见的 3 次）全红 = 151 条**（FFFF 149 + FFF- 2，「-」是那天还没有这条走查）。另有 6 条时红时绿（flaky）和 1 条只有 3 次记录且全绿，不在本清单，先观察。
- 10-22 那次的 335 条里，292 条是构建门拦截（PR #1293 / #1294 处理），其余 15 条是原有的异构红，不新增存量。
- 分类依据：10-21 的逐条日志里第一条带错误的行，按规则初筛（第 2 节），**这是日志证据，不是本机复现**。凡标「候选」「待本机复现」的，在本机跑出来之前不许下「真产品 bug」的结论。

## 2. 分组总表（合计 151 条 = 稳定红 151）

| 组 | 归类 | 说明 | 条数 | 处理建议 |
|---|---|---|---:|---|
| director-topbar | 走查自身坏 | 导演台走查共用入口「顶栏·添加/＋/视图」点不到（同一个共享 helper） | 15 | **已由导演台走查迁移处理（分支 fix/director-walks-3dbox，10-24 复核）**。真因不是「没先选中导演节点」：10-16 起 3D-BOX 打开先落在「导演视图」，精修顶栏（添加 / ＋ / 视图 ▾）要先点顶栏正中的「精修」才出来，走查还当打开就在精修 |
| hardcoded-path | 走查自身坏 | 写死本机项目路径（/Users/…/Nomi Projects/…） | 3 | 修：改用走查自建的临时项目；不隔离（隔离会让它永远没人看） |
| module-load | 走查自身坏 | 走查自己加载不了模块（路径移了 / 缺 tsx 加载器） | 2 | 两条都是 director-*（裸 node 静态 import .ts / .tsx），已由导演台走查迁移处理（10-24 复核）。原建议：改 import 路径 / 用仓库约定的 tsx 入口跑；不属于环境（与汇总环境特征表把 ERR_MODULE_NOT_FOUND 归环境有出入，见「对账」） |
| walk-bug | 走查自身坏 | 走查代码自己的错（TypeError / strict mode 命中两个元素 / localStorage 在错误页读） | 3 | 修：逐个小修，每个一行定位器或页面时机 |
| design-lab | 走查自身坏 | 设计实验室走查（失败 N 条汇总） | 5 | 待本机复现；设计实验室是内部页，优先级低，可先隔离并写到期日 |
| real-data | 环境依赖 | 需要真实资料 / 真实模型配置 / 真 key / 付费演练 / 本机探针文件 | 6 | 隔离：进 tests/ux/nightly-ci-exclusions.json（B 类）并补 owner + 到期日；付费演练类改名 .paid.mjs 让选择器自然排除 |
| video-codec | 环境依赖 | CI 的 Chromium 解不了视频 / 取不到封面（疑似缺 H.264 编解码） | 6 | 待验证假设：在 CI 上跑一条只开视频的探针确认；确认后隔离并写到期日，不要靠修走查 |
| i18n-ui | 真产品问题候选 | 英文界面残留中文 / 英文相对时间（疑似真产品缺陷） | 2 | 真产品问题候选：本机复现后按产品 bug 修（i18n 词典），优先级高于走查修补 |
| agent-resident | 真产品问题候选 | Agent 常驻面板 / feel 记录类走查：data-agent-resident 面板断言失败 | 20 | 待本机复现：这一簇共享 Agent 面板，若本机同样红则是真回归（先 gate 在 D 类名单）；若本机绿则是 CI 渲染差异，加一次失败页截图诊断 |
| layout | 真产品问题候选 | 布局 / 几何断言（窄档、时间轴溢出、浮框定位） | 5 | 待本机复现：CI 窗口 / 字体与本机不同时可能是走查脆；本机红则按产品修 |
| generic-ui | 暂不可判 | UI 断言 / 点击超时，从日志看不出归属 | 84 | 待本机复现：先抽 5 条代表（含 notification-policy、comfy-workflow-multiref、prompt-picker）本机跑，分出走查脆 vs 产品；每条结论回写本表 |

按三大类合计：
- 走查自身坏：28 条
- 环境依赖：12 条
- 真产品问题候选：27 条
- 暂不可判：84 条

## 3. 建议与优先级（交协调排期）

1. **导演台走查（director-topbar）——已由导演台走查迁移处理（10-24 复核，分支 fix/director-walks-3dbox）**。15 条日志都是「点不到顶栏·添加 / ＋ / 视图」，共享 `tests/ux/_directorLab.mjs:204` 的 `clickOrFail(page.getByTestId('director-add-menu'), '顶栏·添加')`。原先写的嫌疑「走查没先选中导演节点」**不成立**。真因：2026-10-16 起 3D-BOX 打开先落在「导演视图」，精修顶栏（添加 / ＋ / 视图 ▾）要先点顶栏正中的「精修」才出来，走查还当打开就在精修。同批另有 3 条走查用裸 node 静态 import 了 .ts / .tsx，起不来；3 条写死了 5175 端口（director-fields / director-timeline-pointer / director-waypoint-aim）。迁移后 23 条里 21 条绿，余下 2 条红是真产品问题（站位参考图连不上目标镜头时静默失败；「视图 ▾」开关不进撤销历史），由协调另起修复。
2. **可以立刻隔离的（环境依赖，补 owner 与到期日）**：real-data 与 video-codec 两组。现有 `nightly-ci-exclusions.json` 的 29 条 B 类**没有 owner 和到期日字段**，隔离前先扩字段（owner、expires、reason），到期没人认领自动转回红。video-codec 先在 CI 上做一次只开视频的探针确认「缺 H.264 解码」这个假设。
3. **走查自身坏的小修**（hardcoded-path 3、module-load 2、walk-bug 3）：每个都是一行定位器 / 路径 / 加载方式，可打包成一个「走查小修」PR；hardcoded-path 修好后要同时让走查不再依赖本机的 `/Users/…/Nomi Projects`。
4. **候选真产品问题要先本机复现再定性**：i18n-ui 2 条（英文界面残留中文、英文相对时间）优先级最高——如果本机也红，这是用户可见的真缺陷，应按产品 bug 修词典，不是修走查。agent-resident 20 条（常驻 Agent 面板断言）和 layout 5 条，先各抽 2–3 条本机跑。
5. **84 条「UI 断言/点击超时」（generic-ui）日志看不出归属**。建议：先抽 5 条代表本机跑（notification-policy、comfy-workflow-multiref、prompt-picker、storyboard-strategy-resolve、telemetry-consent），分出「走查脆」和「产品」；同时在夜跑里**加失败页截图诊断**（失败时存一张页面截图 + DOM 概要进 artifact），否则 CI 上永远只有一行 Timeout，无法分诊。这是本清单最大的缺口，也可能是红了两周没人认领的原因之一：日志没有给出可行动的信息（推测）。
6. **删**：本次不建议删任何走查。要删必须先核 `nightly-ci-exclusions.json` 与 full-walk 目录有无其它入口引用（door-map / git grep）并写进该 PR；在没有复现结论前删等于把红藏起来。

## 4. 与 2026-10-08 分诊（docs/research/2026-10-08-nightly-walk-triage.md）对账

- 10-08 的口径是 A 走查漂移 56 / B 真实资源 30 / C 环境 13 / D 疑似真回归 25 / E 无法判 51（共 324 里的 169 失败 + 6 超时）。本清单按「走查自身坏 / 环境依赖 / 真产品」三类重排，目的是对应处理动作，不替换它的 A–E。
- 10-08 的 B 类 29 条已在 exclusions 里，本清单的 151 条里有 **0 条在 exclusions 中**（应为 0，非 0 说明排除未生效）。
- 稳定红中，10-08 标 A（漂移）的有 46 条、D（疑似真回归）17 条、E 43 条、C 12 条、10-08 之后新增的走查 33 条。这些在 10-08 就已标出，两周后仍稳定红；10-08 的清单没有 owner 与到期日，推测是它没被消化的原因之一（推测，未核对期间的修复记录）。
- 差异：模块解析失败（ERR_MODULE_NOT_FOUND）本清单归「走查自身坏」，而 PR #1294 的汇总环境特征表把它归「环境」。两者不矛盾（汇总只做粗筛、给出"不是产品回归"的信号），但建议下次调特征表时把 `module-not-found` 改成"走查自身"栏或拆出一栏，避免人以为是机器问题而不修。

## 5. 逐条清单（稳定红 151 条，按组）


### director-topbar（走查自身坏，15 条）

| 走查 | 10-08 分类 | 在 exclusions | 首个错误行（10-21 日志，已截断） |
|---|:---:|:---:|---|
| director-assets | E | 否 | ✗ 资产走查中断：Error: 点不到「顶栏·＋」：等满 Nms 它都没可见。 |
| director-electron | A | 否 | ExpectError: 点不到「顶栏·添加」：等满 Nms 它都没可见。 |
| director-j1-three-person-scene | - | 否 | ✗ j1-three-person-scene：3 项失败 —— 空工程·视口空态提示 / 空工程·时间轴空态 / 旅程中断：点不到「顶栏·添加」：等满 Nms 它都没可见。 |
| director-j2-walk-to-b | - | 否 | ✗ j2-walk-to-b：1 项失败 —— 旅程中断：点不到「顶栏·添加」：等满 Nms 它都没可见。 |
| director-j3-three-cameras | - | 否 | ExpectError: 点不到「顶栏·添加」：等满 Nms 它都没可见。 |
| director-j4-kneel-stand-look | - | 否 | ✗ j4-kneel-stand-look：1 项失败 —— 旅程中断：点不到「顶栏·添加」：等满 Nms 它都没可见。 |
| director-j5-splat-valley | E | 否 | ✗ j5-splat-valley：1 项失败 —— 旅程中断：点不到「顶栏·＋」：等满 Nms 它都没可见。 |
| director-j6-outputs | E | 否 | ✗ j6-outputs：1 项失败 —— 旅程中断：点不到「顶栏·添加」：等满 Nms 它都没可见。 |
| director-j7-skeleton | - | 否 | ✗ j7-skeleton：1 项失败 —— 旅程中断：点不到「顶栏·添加」：等满 Nms 它都没可见。 |
| director-j8-project-interactions | - | 否 | ExpectError: 点不到「顶栏·添加」：等满 Nms 它都没可见。 |
| director-mobile | - | 否 | ExpectError: 点不到「顶栏·添加」：等满 Nms 它都没可见。 |
| director-refine-tasks | E | 否 | ✗ refine-tasks：1 项失败 —— 旅程中断：精修顶栏没出来 |
| director-ual-crowd | A | 否 | ✗ ual-crowd：1 项失败 —— 旅程中断：点不到「顶栏·添加」：等满 Nms 它都没可见。 |
| director-ual-mannequin | C | 否 | ✗ ual-mannequin-zh：1 项失败 —— 旅程中断：点不到「顶栏·添加」：等满 Nms 它都没可见。 |
| director-windowbar | - | 否 | ExpectError: 点不到「顶栏·视图 ▾」：等满 Nms 它都没可见。 |

### hardcoded-path（走查自身坏，3 条）

| 走查 | 10-08 分类 | 在 exclusions | 首个错误行（10-21 日志，已截断） |
|---|:---:|:---:|---|
| new-models-20260729 | C | 否 | Error: ENOENT: no such file or directory, open '<path> Projects/未命名项目 N_N N_N-mqiyx4om-5eN/.nomi/project.json' |
| param-bar-geometry | C | 否 | Error: ENOENT: no such file or directory, open '<path> Projects/未命名项目 N_N N_N-mqiyx4om-5eN/.nomi/project.json' |
| param-bar-models | C | 否 | Error: ENOENT: no such file or directory, open '<path> Projects/未命名项目 N_N N_N-mqiyx4om-5eN/.nomi/project.json' |

### module-load（走查自身坏，2 条）

| 走查 | 10-08 分类 | 在 exclusions | 首个错误行（10-21 日志，已截断） |
|---|:---:|:---:|---|
| director-3dbox-shell | E | 否 | Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<path>' imported from <path> |
| director-clip-states | C | 否 | TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".tsx" for <path> |

### walk-bug（走查自身坏，3 条）

| 走查 | 10-08 分类 | 在 exclusions | 首个错误行（10-21 日志，已截断） |
|---|:---:|:---:|---|
| agent-panel-form | C | 否 | page.evaluate: SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for t |
| feedback-batch-hardening | A | 否 | locator.click: Error: strict mode violation: locator('[aria-label="添加图片节点"]') resolved to 2 elements: |
| vendor-connection-identity | E | 否 | page.evaluate: TypeError: rows.map is not a function |

### design-lab（走查自身坏，5 条）

| 走查 | 10-08 分类 | 在 exclusions | 首个错误行（10-21 日志，已截断） |
|---|:---:|:---:|---|
| design-lab-ask-card-in-panel | C | 否 | failures: zh/light/question：卡在待答态却没有那层同色描边光 | zh/dark/question：卡在待答态却没有那层同色描边光 | zh/light/spend：卡在待答态却没有那层同色描边 |
| design-lab-catalog-liveness | E | 否 | ❌ 设计实验室走查失败 6 条 |
| design-lab-node-composer-bar | E | 否 | ❌ 设计实验室走查失败 5 条 |
| design-lab-question-card-generality | C | 否 | failures: none |
| design-lab-settings | E | 否 | ❌ 设计实验室走查失败 6 条 |

### real-data（环境依赖，6 条）

| 走查 | 10-08 分类 | 在 exclusions | 首个错误行（10-21 日志，已截断） |
|---|:---:|:---:|---|
| agent-video-landing-paid.rehearsal | - | 否 | catch (error) { throw new Error('付费走查拒跑（一分钱没花）：${String(error?.message ?? error)}——构建产物过期或缺失（构建失败，或构建后源码又被改过）， |
| audio-timeline | E | 否 | 缺 .tmp/probe-tone-3s.mp3 |
| credential-connect-honesty | E | 否 | ✖ page.evaluate: Error: 密钥验证失败，请检查密钥和权限后重试。 |
| credential-redirect | E | 否 | if (!fs.existsSync(file)) throw new Error('真实资料目录缺 ${path.basename(file)}（${file}）——${why}') |
| narrowed-mode-guidance | E | 否 | throw new Error('真实 model-catalog.json 不存在(${profile.catalogPath})——被测 agent 需要已配置的模型与 key'); |
| paid-env-key-connect.rehearsal | - | 否 | catch (error) { throw new Error('付费走查拒跑（一分钱没花）：${String(error?.message ?? error)}——构建产物过期或缺失（构建失败，或构建后源码又被改过）， |

### video-codec（环境依赖，6 条）

| 走查 | 10-08 分类 | 在 exclusions | 首个错误行（10-21 日志，已截断） |
|---|:---:|:---:|---|
| asset-video-preview | A | 否 | 走查失败: locator.evaluate: Error: N 秒内未生成视频封面 |
| video-clip-direct | - | 否 | feel record: video-clip-direct/FAIL-N-real-Np-performance-and-keyboard-zh.png; findings=N; new-surfaces=2; evi |
| video-clip-reopen | - | 否 | feel record: video-clip-reopen/FAIL-N-close-the-app-in-the-middle-of-a-trim.png; findings=N; new-surfaces=2; e |
| video-depth-real-task | A | 否 | ExpectError: 派生节点上没有进度遮罩 |
| video-playback-heal | A | 否 | locator.waitFor: Timeout Nms exceeded. |
| windows-freeze-sweep | A | 否 | ✖ 新建图片节点 → 生成（等待动效在跑） — 帧间隔 Nms · 主进程 Nms · 报错 locator.waitFor: Timeout Nms exceeded.  [N.png] |

### i18n-ui（真产品问题候选，2 条）

| 走查 | 10-08 分类 | 在 exclusions | 首个错误行（10-21 日志，已截断） |
|---|:---:|:---:|---|
| first-launch-system-locale | - | 否 | 失败项： [en] 项目库相对时间英文（无中文时间串） |
| i18n-sweep | E | 否 | ✗ [en] 侧栏·Prompt library · 无残留中文 — Error: [en] 侧栏·Prompt library：英文界面不该有未翻译中文（EN-DOM 断言网）：找到 4 处 CJK 文本。 /   · |

### agent-resident（真产品问题候选，20 条）

| 走查 | 10-08 分类 | 在 exclusions | 首个错误行（10-21 日志，已截断） |
|---|:---:|:---:|---|
| agent-artifact | A | 否 | Timeout:  Nms |
| agent-domain-owners | - | 否 | feel record: core-smoke-fw-agent-domain-owners-empty/N-default-image-FAIL.png; findings=N; new-surfaces=4; evi |
| agent-inflight-shots-reload | A | 否 | feel record: pi-inflight-shots-reload/FAIL.png; findings=N; new-surfaces=4; evidence: <path> |
| agent-lane-deletion | D | 否 | feel record: pi-lane-deletion/FAIL.png; findings=N; new-surfaces=2; evidence: <path> |
| agent-panel-mechanics | E | 否 | name: 'Error' |
| agent-panel-system-prompt | D | 否 | feel record: pi-panel-system-prompt/FAIL.png; findings=N; new-surfaces=3; evidence: <path> |
| agent-process-tone | A | 否 | feel record: pi-agent-process-tone/FAIL.png; findings=N; new-surfaces=2; evidence: <path> |
| agent-queued-shot-not-regenerable | D | 否 | feel record: pi-queued-shot-not-regenerable/FAIL.png; findings=N; new-surfaces=3; evidence: <path> |
| agent-runtime-editing | D | 否 | feel record: pi-editing/FAIL.png; findings=N; new-surfaces=2; evidence: <path> |
| agent-runtime-production | A | 否 | feel record: pi-production/FAIL.png; findings=N; new-surfaces=2; evidence: <path> |
| agent-single-shot-skill-boundary | D | 否 | feel record: pi-single-shot-skill-boundary/FAIL.png; findings=7; new-surfaces=1; evidence: <path> |
| agent-thinking-overlap | D | 否 | feel record: pi-thinking-overlap/FAIL.png; findings=N; new-surfaces=2; evidence: <path> |
| agent-thinking-rows | A | 否 | feel record: pi-thinking-rows/FAIL.png; findings=N; new-surfaces=3; evidence: <path> |
| agent-timeline-ops | A | 否 | feel record: agent-timeline-ops/FAIL.png; findings=N; new-surfaces=3; evidence: <path> |
| agent-trace-log | C | 否 | "error": "Error: Timed out waiting for the actual Electron process to close\n    at Timeout.<anonymous> (file: |
| agent-ui-exception-states-runtime | A | 否 | feel record: pi-agent-exception-states-runtime/FAIL.png; findings=N; new-surfaces=3; evidence: <path> |
| agent-v4-retry-storm | D | 否 | feel record: pi-v4-retry-storm/FAIL.png; findings=N; new-surfaces=3; evidence: <path> |
| agent-v4-short-film | A | 否 | feel record: pi-v4-short-film/FAIL.png; findings=N; new-surfaces=3; evidence: <path> |
| focus-indication | A | 否 | feel record: pi-focus-indication/FAIL.png; findings=0; new-surfaces=0; evidence: <path> |
| stage4-switch | A | 否 | feel record: pi-stage4-switch/FAIL.png; findings=N; new-surfaces=2; evidence: <path> |

### layout（真产品问题候选，5 条）

| 走查 | 10-08 分类 | 在 exclusions | 首个错误行（10-21 日志，已截断） |
|---|:---:|:---:|---|
| arrange-draft-cta | E | 否 | ✗ 空时间轴没出现「拼成初稿」提示行（看 preview-empty-with-cta 截图） |
| layout-timeline-panel-span | D | 否 | ExpectError: ③ 两个都开：底部带没「在右面通过去」——右缘没到窗口右边（timeline.right=N viewport=N） |
| node-composer-placement | A | 否 | VERIFY ERROR: Error: 拉宽 Agent 面板后浮框位置必须落定（连续两次采样相同） |
| storyboard-narrow-row | E | 否 | failures: zh：左栏展开时行没有进窄档（density=wide，行宽 N） | zh：窄档视觉列只省下 0px（宽 N / 窄 N） | zh：窄档内容列 Npx，视觉列不缩时只有 Npx——缩视觉列没换来写 |
| timeline-toolbar-row | D | 否 | ExpectError: 压到 Npx 后没有产生横向滚动（说明被裁掉或换行了） |

### generic-ui（暂不可判，84 条）

| 走查 | 10-08 分类 | 在 exclusions | 首个错误行（10-21 日志，已截断） |
|---|:---:|:---:|---|
| anchor-real | A | 否 | ExpectError: 旧行为锚未消费 |
| asset-library-interactions | E | 否 | FAIL ⑤ 删两张：a-spare.png 没了 · 确认删除后 a-spare.png 不该还在（基线已证：删除前项目素材里有 a-spare.png） |
| asset-library-native-import | E | 否 | if (dropped.length !== 2) throw new Error('拖入后未落盘第二张图片，发现 ${dropped.length} 张') |
| asset-transport-settings | E | 否 | 资产上传设置走查失败: Error: 明确说明上传免费: 素材上传通道 |
| assisted-onboarding-entry | D | 否 | ExpectError: ② 技能正文里缺 nomi_integration |
| at-mention-edge | E | 否 | editor click err locator.click: Timeout Nms exceeded. |
| audio-reference-connect | A | 否 | Timeout: Nms |
| browser-overlay-interaction | E | 否 | 素材盒浮层走查异常: Error: overlay window never appeared |
| canvas-control-clarity | E | 否 | locator.click: Timeout Nms exceeded. |
| canvas-frame | E | 否 | ExpectError: 全选后浮条上出现「统一模型」 |
| canvas-handle-menus | - | 否 | feel record: canvas-handle-menus/FAIL-N-left-ring-on-video-adds-image-upstream-zh.png; findings=N; new-surface |
| claim-unsent-retry | - | 否 | [claim-unsent-retry] zh-CN: FAILED first-attempt-fails, face-says-why-not-generic, face-offers-retry, walk-err |
| clip-drop-zoom | - | 否 | FAIL P5 @N% 没悬停时，拖放把手那一点最顶层是把手本身；真鼠标拖它能发出画布节点载荷 {"box":{"w":N,"h":N},"top":{"isNotch":false,"tag":"SPAN"},"mim |
| clip-gesture-ownership | - | 否 | FAIL P7 @N% 画布片段拖动被 pointercancel 打断后干净结束并回到拖之前 {"draggingBefore":"false","draggingAfter":"false","draggingAft |
| comfy-workflow-feedback | D | 否 | ExpectError: expect(received).toBe(expected) // Object.is equality |
| comfy-workflow-multiref | A | 否 | ExpectError: expect(locator).toBeVisible() failed |
| composer-long-prompt | E | 否 | ✗ 4/N 项未过 |
| contextual-node-guidance | - | 否 | ExpectError: expect(locator).toBeVisible() failed |
| creation-flow-fixes | A | 否 | ❌ A 一次改全部镜头 — 只有 0 张镜卡变成视频镜，期望 N：Error: 期望 N 张镜卡都出现时长选择器（=全变视频镜） |
| creation-plan-delete-undo | - | 否 | Timeout:  Nms |
| dark-audit | - | 否 | locator.click: Timeout Nms exceeded. |
| dark-journey | A | 否 | ExpectError: 点不到「导出 MP4」：等满 Nms 它都没可见。 |
| deconstruction-panel | A | 否 | 走查异常： ExpectError: 基线不成立：「拆解面板占槽时这个定位器找得到它」应当能被探针找到，但一个都没找到。 |
| default-generation-model | A | 否 | if (!condition) throw new Error('WALK FAIL: ${label}${detail ? ' — ${detail}' : ''}') |
| director-ai | D | 否 | ✗ AI走查中断：Error: 点不到「AI 搭场景」：等满 Nms 它都没可见。 |
| director-fields | E | 否 | name: 'Error' |
| director-timeline-pointer | E | 否 | name: 'Error' |
| director-ual-migration | - | 否 | ✗ 旅程中断：locator.getAttribute: Timeout Nms exceeded. |
| director-waypoint-aim | E | 否 | name: 'Error' |
| editing-panel-system | E | 否 | if (failed.length > 0) throw new Error('剪辑面板系统走查有 ${failed.length} 条不达合同：${failed.map(([name]) => name).join(' |
| editing-real-user-pass | C | 否 | 剪辑面真实用户走查通过 |
| f3-f16b | A | 否 | ExpectError: 创作助手输入框可见 |
| feedback-loop-consent-and-report | E | 否 | FEEDBACK LOOP WALK FAIL: Error: 点不到「切到生成面」：等满 Nms 它都没可见。 |
| feedback-share-center | A | 否 | ExpectError: 点不到「关于页「反馈与分享」入口」：等满 Nms 它都没可见。 |
| grouping-optimization | - | 否 | ExpectError: 再次点击空白组框后工具条出现 |
| library-category-collapse | - | 否 | feel record: library-category-collapse/FAIL.png; findings=N; new-surfaces=5; evidence: <path> |
| library-cover-imported-video | - | 否 | locator.click: Timeout Nms exceeded. |
| library-load-error | - | 否 | ExpectError: 基线不成立：「首启空库引导屏「还没有项目」」应当能被探针找到，但一个都没找到。 |
| local-gateway-onboarding | E | 否 | WALK FAIL: 本地网关接入或失败后继续验证回归 |
| mcp-key-window | A | 否 | Error: propose regressed to credential state: {"schemaVersion":1,"id":"integration-NcN-e3e9-4de9-b9cf-7e0cbNaN |
| mcp-workbuddy-client-profile | - | 否 | ExpectError: expect(locator).toBeVisible() failed |
| mention-scope | E | 否 | ✗ 找得到 composer 里那个可见的提示词框 — -1 |
| model-availability-agreement | E | 否 | if (!condition) throw new Error('WALK FAIL: ${label}${detail ? ' — ${detail}' : ''}') |
| model-contract-limits | A | 否 | ExpectError: expect(locator).toBeVisible() failed |
| model-kind-misguess | A | 否 | 走查异常： locator.click: Timeout Nms exceeded. |
| model-pick-confirm | A | 否 | locator.click: Timeout Nms exceeded. |
| node-prompt-presets | D | 否 | feel record: node-prompt-presets/after-FAIL.png; findings=N; new-surfaces=5; evidence: <path> |
| node-toolbar-one-row | D | 否 | if (!cond) throw new Error('WALK FAIL: ${label}') |
| notification-policy | A | 否 | locator.click: Timeout Nms exceeded. |
| omni-video-reference-gate | A | 否 | Timeout: Nms |
| onboarding-auto-fetch | E | 否 | ✗ 走查异常 — locator.click: Timeout Nms exceeded. |
| onboarding-checkmark-honesty | A | 否 | ExpectError: 点不到「拆成镜头·落画布」：等满 Nms 它都没可见。 |
| plan-gate | E | 否 | ✗ FAIL: stdio MCP 服务起来了（探到运行中的 GUI） |
| preview-export-busy | C | 否 | busyNow={"busy":"true","disabled":true,"title":"正在导出（转码封装 · N%），这次导出完成后才能再点","label":"正在导出（转码封装 · N%），这次导出完成后才 |
| production-stalled-draft | E | 否 | ✅ ① 未实现的 playbook 当场被拒，且错误说清了「传的是什么」「可用的是什么」 —— Error invoking remote method 'nomi:production-runs:create-draf |
| project-asset-healthcheck | A | 否 | locator.waitFor: Timeout Nms exceeded. |
| project-location-settings | E | 否 | 项目位置走查失败: Error: 设置页显示当前自定义目录: <path> |
| prompt-picker | D | 否 | ExpectError: composer 里应当有且只有 1 个提示词选择器（一功能一个家） |
| provider-model-discovery | D | 否 | ExpectError: expect(received).toContain(expected) // indexOf |
| provider-proxy-field | A | 否 | PROVIDER PROXY WALK FAIL: Error: 点不到「添加请求头按钮」：等满 Nms 它都没可见。 |
| reference-capture | E | 否 | 预期失败原因写入控制台:       FAIL |
| reference-companion-required | - | 否 | ❌ 走查失败： locator.setInputFiles: Timeout Nms exceeded. |
| remove-background | - | 否 | ✗ 走查异常 — Error: expect(locator).toBeVisible() failed |
| runway-vendor-honest-modes | E | 否 | feel record: runway-vendor-honest-modes/N-FAIL.png; findings=8; new-surfaces=1; evidence: <path> |
| shell-redesign | - | 否 | ExpectError: Ctrl+J 打开后焦点不在 Agent 输入框 |
| shot-cut-empty-states | A | 否 | ExpectError: 点不到「node-strong 的「按镜头拆」」：等满 Nms 它都没可见。 |
| shot-cuts | A | 否 | locator.click: Timeout Nms exceeded. |
| skill-cover-wall | C | 否 | feel record: skill-cover-wall/wall-FAIL.png; findings=N; new-surfaces=5; evidence: <path> |
| skill-library-cards | D | 否 | ExpectError: expect(locator).toBeVisible() failed |
| skill-library-specimen | A | 否 | ExpectError: 真实 Electron 宿主已就绪 |
| storyboard-anchor-policy | A | 否 | ExpectError: 锚卡消费橙字 |
| storyboard-model-same-name | A | 否 | Timeout: Nms |
| storyboard-reference-slots | A | 否 | Timeout: Nms |
| storyboard-strategy-resolve | - | 否 | 走查失败： ExpectError: 拆条采纳后 shot-1 的超限警示应当消失，只剩 shot-4 的低于下限 |
| storyboard-table-exec | A | 否 | ✖ storyboard-table-exec 走查失败 2 项： |
| storyboard-table-phasec | A | 否 | Timeout: Nms |
| telemetry-consent | A | 否 | TELEMETRY WALK FAIL: locator.check: Clicking the checkbox did not change its state |
| telemetry-scope-reconfirm | - | 否 | ❌ page.waitForSelector: Timeout Nms exceeded. |
| timeline-context-menu | E | 否 | ❌ WALK FAIL: 第 2 项对账一致 — 创建副本/CtrlD/常规 |
| toolbar-order | A | 否 | locator.click: Timeout Nms exceeded. |
| vendor-connection-health | E | 否 | ✗ 面板没打开 |
| vendor-honest-variant-axis | E | 否 | feel record: vendor-honest-variant-axis/N-FAIL.png; findings=0; new-surfaces=0; evidence: <path> |
| volcengine-speech-credential | E | 否 | ✗ 没找到火山豆包语音卡 |
| whiteboard-refactor | - | 否 | throw new Error( |

## 6. 没做完的 / 不确定的

- 所有"候选 / 待本机复现"都没有本机复现；本机是 Windows，走查在 Linux CI（xvfb）上红，复现可能需要 CI 上的诊断 job，由协调决定是否值得。
- 规则初筛按日志第一条错误行归组，个别走查可能被误分到相邻组（例如名字含 agent- 的走查被并入 agent-resident）；各组处理动作前请先看该组逐条表。
- 6 条 flaky 与 10-22 的 15 条非构建门红未逐条分诊。
- 逐条数据来源在本机 D:/Nomi-tmp/nightly-gate/runs（不入库）；需要复核可按 4 个 run id 重新 `gh run download`。

## 7. 10-24 复核：run 40035294026（339 条，173 过、166 红）

> 来源：实现线 N-nightly（分支 fix/nightly-reds-triage）。读这次夜跑的逐条日志，本机（macOS）按夜跑顺序串跑复现。修法按共因一刀；分诊按「夜跑上为什么红」归类，一条只进一类。「本机复跑」列是修完之后在 macOS 上的结果，和夜跑（Linux）不完全等价；「没跑」是这一轮没排上，不是跳过了检查。第 1–6 节是 10-23 的口径，没有改动，只把导演台那两行的错误嫌疑改正了。

### 7.1 两个共因

- **共因 1：一条走查往源码树里写东西，后面整批被构建戳拒跑（23 条）。** b3 批第 60 条 node-toolbar-one-row 把 8 张截图写进仓库根下的 `.node-toolbar-one-row-lab/`（不在 .gitignore 里），构建戳的源码身份（`scripts/package-build-stamp.mjs` 的 `sourceIdentity`）跟着变了，它后面每一条起 App 都报「构建产物比源码旧」，日志里看不出是谁干的。
  - 修：走查输出改进被忽略的目录（同类 4 条一起改）；夜跑每条走查之后用 `scripts/nightly-walk-tree-guard.mjs` 核一次源码身份，变了就把**这一条**判红（退出码 96），逐个点名新增 / 改动 / 删掉的构建输入，CI 上还原到走查之前的树，后面照常跑；构建戳拒跑时也直接列出是哪些输入变了。
  - 本机复现：修前按夜跑顺序跑 node-composer-placement → node-toolbar-one-row → onboarding-auto-fetch，第二条跑完源码树 3a03a666 → 9d5b7fc3（多出 8 张 PNG），第三条被构建戳拒；修后同顺序再跑 5 条，每条前后都是 a7088494（= 构建戳）。
  - 去掉连坐以后，这 23 条里还有一部分各自红在别处（本机复跑列），那是它们自己的问题，不是共因 1。
- **共因 2：走查写死作者本机「文稿 / Nomi Projects」下的真实项目（3 条）。** param-bar-geometry / param-bar-models / new-models-20260729 直接读那台机器上的真实项目；`evals/lib/isoApp.mjs` 还会「本机有就顺手拷」真实目录。
  - 修：三条改成当场造的隔离夹具；isoApp 不再拷真实目录（必红单测）；同类扫出的 media-import-matrix / plan-gate / video-deconstruct.e2e 一起清掉；只有接真实资料才有意义的走查移出夜跑、写明手动跑法：夜跑上红的 credential-redirect / narrowed-mode-guidance / whiteboard-refactor，以及没资料就以「跳过」退出、一直被记成「过」的 draft-loop / storyboard-methodology / find-reference。本机复跑那三条全过。

### 7.2 分诊总表

类的代号：X1 / X2 = 上面两个共因；A = 走查落后于产品（A1 入口或文案改了、A2 功能删了或语义改了）；B = 夹具 / 环境（K1 假凭据、T 收尾挂死、E 机器前提）；C = 疑似产品回归；D = 要真实资料或真 key；另有归别的线的（DIR、LIB、B3C、AG）。

| 类 | 共因 | 条数 | 本机复跑（过 / 红 / 没跑） | 修了没 |
|---|---|---:|---|---|
| X1 · 共因 1 | b3 批里 node-toolbar-one-row 把截图写进仓库根下没被忽略的目录 → 源码身份漂移 → 后面每条起 App 都被构建戳拒跑 | 23 | 10 / 11 / 2 | 连坐已修 cffc4507f（走查输出改进被忽略目录 + 夜跑每条后核树、点名、还原）；去掉连坐后各条自己的结果见本机复跑列 |
| X2 · 共因 2 | 写死作者本机 ~/Documents/Nomi Projects 下的真实项目路径 | 3 | 3 / 0 / 0 | 已修 16741afdb（改隔离夹具；isoApp 不再顺手拷真实目录） |
| D · D | 要这台机器上配好的真实资料 / 真实素材目录 | 3 | 0 / 0 / 3 | 移出夜跑 16741afdb（登记 nightly-ci-exclusions，写明手动跑法）；同类不在红里、没资料就以「跳过」退出被记成过的 draft-loop / storyboard-methodology（16741afdb）、find-reference（529612e48）一并移出 |
| K1 · B | 占位 key 走产品的保存口（保存即验证）：开网 401「密钥验证失败」；关网存成「未验证、停用」 | 3 | 1 / 2 / 0 | 已修 a3a58cb89：假凭据默认关网；要「这家有可用 key」的起 App 前经保存口种好 |
| T · B | 断言全过，收尾挂到 600 秒（Electron 帮手进程攥着 stdio 管道 / npx 垫片的孤儿 vite） | 4 | 4 / 0 / 0 | 已修 38ad6698d：app.close() 有上限、超时按进程树强杀 |
| E · B | 走查要作者机器上的前提：手放的文件、Homebrew 路径、PowerShell、手开的开发服务、写死 ⌘ | 5 | 2 / 3 / 0 | 已修 9d0fe9ef9：前提由走查自己备、按运行的机器取 |
| A1 · A | 入口 / 文案改了，走查还按旧文案或位置找 | 4 | 2 / 2 / 0 | 已修 008dced5e：文案读词典、认数据属性 |
| A1L · A | 入口 / 文案改了（未修，列出）：等的文案或类名在 src/ 里零命中、撞上同名新按钮，或入口的出现条件变了 | 11 | 0 / 4 / 7 | 未修：照 A1 的改法逐条跟上 |
| A2 · A | 功能删了 / 语义改了：走查测的东西已不存在 | 8 | 0 / 3 / 5 | 未修：走查重写或删（建议删 deconstruction-panel） |
| AG · 待 agent 线 | Agent 面板 / 运行时走查：全是 UI 断言失败（无夹具错配），集中在面板块结构 | 18 | 0 / 0 / 18 | 未修：交 agent 线逐条分诊 |
| DIR · 别的线 | director-*（导演台走查迁移，分支 fix/director-walks-3dbox，协调在推） | 23 | 0 / 0 / 23 | 不碰 |
| LIB · 别的线 | 技能库 / 提示词库相关走查（归 I-libraries 线） | 5 | 0 / 0 / 5 | 不碰 |
| B3C · 在途只分诊 | 生成框 B3（#1269）/ 节点指向（#1301）在途：composer 控件、模式 tab、浮条结构 | 16 | 0 / 3 / 13 | 不改：等在途 PR 带走查一起合 |
| C · C 候选 | 产品行为和走查合同不一致、锚点还在源码里：疑似回归（复现步骤见下） | 2 | 0 / 2 / 0 | 不改产品码：写复现 |
| ? · 未细分 | 逐条看过夜跑证据，没来得及本机复现定 A / C（夜跑原文 + 本机复跑结果在这） | 38 | 0 / 21 / 17 | 待查 |
| 合计 | | 166 | | |

#### X1 · 共因 1：b3 批里 node-toolbar-one-row 把截图写进仓库根下没被忽略的目录 → 源码身份漂移 → 后面每条起 App 都被构建戳拒跑（23）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| onboarding-auto-fetch | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 红 1（12s）：去掉连坐后本机红：「弹窗打开」✗（点击 3 秒超时），待查 |
| paid-env-key-connect.rehearsal | catch (error) { throw new Error(`付费走查拒跑（一分钱没花）：${String(error?.message ?? error)}——构建产物过期或缺失（构建失败，或构建后源码又被改过），先在无人改动的专用工作树里 pnpm build 成功再跑`) } | 过（11s） |
| pending-install-pill | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 过（7s） |
| production-flow-fixes | "error": "Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f… | 过（20s） |
| project-switch-background-run | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 过（15s） |
| provider-proxy-field | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 过（11s）；夜跑上是构建戳连坐；本机复跑暴露文案过期，已随 008dced5e 修 |
| reference-companion-required | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 红 1（65s）：去掉连坐后本机红：setInputFiles 30 秒超时（文件选择器没出现），待查 |
| remove-background | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 红 1（41s）：去掉连坐后本机红：抠图 6 项过 5 项，有一个元素没找到，待查 |
| runway-vendor-honest-modes | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 红 1（22s）：凭据这关过了（Runway / APIMart 的模型都进了下拉），红在下拉里没有「Runway HappyHorse 1.0」：09-28 起渠道行并进模型身份，可「HappyHorse 1.0」（kie + runway）整行都不在下拉里，Runway 明明已接——是走查过期还是合并后丢了这一行，待查 |
| shell-redesign | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 红 1（46s）：去掉连坐后本机红：Ctrl+J 打开后焦点不在 Agent 输入框，待查 |
| skill-cover-wall | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 没跑 |
| skill-library-specimen | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 没跑 |
| storyboard-film-aspect-passthrough | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 过（28s） |
| storyboard-narrow-row | failures: 走查中断：构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92… | 红 1（13s）：去掉连坐后本机红：左栏展开时行没进窄档（density=wide，行宽 780），判据变了还是回归待查 |
| storyboard-table-exec | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 红 1（49s）：去掉连坐后本机红：镜 2 状态应为 waiting-refs、实为 ready，之后第 5 行的画面格找不到，待查 |
| storyboard-windowing | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 红 1（29s）：去掉连坐后本机红：滚走再回来 / 卸载再挂上之后 Ctrl+Z 撤不回原文（③、③b、⑬ 三项），疑似 C（虚拟化重挂丢了编辑器的撤销历史），未定位 |
| telemetry-consent | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 红 1（7s）：去掉连坐后本机红：点同意框的 checkbox 状态不变（locator.check 报没变），待查 |
| text-node-follow-agent-model | text-node-follow-agent-model 走查失败: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca72… | 过（10s） |
| timeline-transition-preview | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 过（12s） |
| update-reminder-host | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 过（24s）；夜跑上是构建戳连坐；本机复跑暴露写死「只给 Mac」，已随 9d0fe9ef9 修 |
| vendor-connection-identity | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 红 1（34s）：去掉连坐后本机红：page.evaluate 里「rows.map is not a function」，走查读的接口返回形状变了（A），待跟 |
| version-one-per-click | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 红 1（18s）：去掉连坐后本机红：选中节点后生成浮框里没有「↑」，和生成框 B3 在途改动相关的可能大 |
| video-frame-capture | Error: 构建产物比源码旧（或没有构建），先跑 pnpm run build——否则走查 / e2e / 性能量到的是旧代码。（dist: 构建产物缺失、过期或构建失败；先 `pnpm build`。（构建时 tree=21345fca725761c2b47d290add1f92d6a17179… | 过（34s） |

#### X2 · 共因 2：写死作者本机 ~/Documents/Nomi Projects 下的真实项目路径（3）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| param-bar-geometry | Error: ENOENT: no such file or directory, open '~/Documents/Nomi Projects/未命名项目 06_18 11_56-mqiyx4om-5e071915/.nomi/project.json' | 过（29s） |
| new-models-20260729 | Error: ENOENT: no such file or directory, open '~/Documents/Nomi Projects/未命名项目 06_18 11_56-mqiyx4om-5e071915/.nomi/project.json' | 过（30s） |
| param-bar-models | Error: ENOENT: no such file or directory, open '~/Documents/Nomi Projects/未命名项目 06_18 11_56-mqiyx4om-5e071915/.nomi/project.json' | 过（30s） |

#### D · D：要这台机器上配好的真实资料 / 真实素材目录（3）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| credential-redirect | Error: 真实资料目录缺 model-catalog.json（~/.config/nomi/model-catalog.json）——被测 App 需要这台机器上已配好的模型与 key | 没跑 |
| narrowed-mode-guidance | Error: 真实 model-catalog.json 不存在(~/.config/nomi/model-catalog.json)——被测 agent 需要已配置的模型与 key | 没跑 |
| whiteboard-refactor | Error: 真实素材缺失：环境变量 NOMI_REAL_MEDIA_DIR 未设置。 | 没跑 |

#### K1 · B：占位 key 走产品的保存口（保存即验证）：开网 401「密钥验证失败」；关网存成「未验证、停用」（3）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| vendor-honest-variant-axis | page.evaluate: Error: 密钥验证失败，请检查密钥和权限后重试。 | 红 1（22s）：凭据这关过了，前 8 项全过；红在「Runway Wan 3」：09-28 起并进「Wan 3.0」一行（下拉里是 Wan 3.0 · APIMart · Runway Dev），走查过期（A） |
| credential-connect-honesty | ✖ page.evaluate: Error: 密钥验证失败，请检查密钥和权限后重试。 | 过（11s）；关网后按产品语义判「未验证」，全过 |
| model-contract-limits | 密钥验证失败，请检查密钥和权限后重试。 | 红 1（13s）：凭据这关过了，进了参数条；红在摘要文案：期望「1080p · 6」，实际「6s」（A） |

#### T · B：断言全过，收尾挂到 600 秒（Electron 帮手进程攥着 stdio 管道 / npx 垫片的孤儿 vite）（4）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| design-lab-question-card-generality | （日志无断言行，退出码 124 · 600s） | 过（25s） |
| editing-real-user-pass | （日志无断言行，退出码 124 · 600s） | 过（166s） |
| preview-export-busy | （日志无断言行，退出码 124 · 600s） | 过（23s） |
| agent-trace-log | "error": "Error: Timed out waiting for the actual Electron process to close at Timeout.<anonymous> (file://<repo>/tests/ux/agent-runtime-walk-support.… | 过（23s） |

#### E · B：走查要作者机器上的前提：手放的文件、Homebrew 路径、PowerShell、手开的开发服务、写死 ⌘（5）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| audio-timeline | （日志无断言行，退出码 1 · 0s） | 红 1（145s）：前提备好后走到界面；按文案（hasText「新建空白项目」）找入口，点进的却是引导旅途：截图里是示例项目「修好一个小机器人」和「自动播放中」的引导浮层。该改用 _shell.mjs 的 newProjectEntry（A） |
| video-clip-reopen | {"name":"01-close-the-app-in-the-middle-of-a-trim","pass":false,"error":"spawnSync powershell ENOENT"} | 过（24s） |
| agent-panel-mechanics | page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:52793/tests/ux/fixtures/agent-panel-mechanics/ | 红 1（7s）：前提备好后 7 秒跑完；红在 340px 窄档模型名被截断（DeepSeek…），交 agent 线 |
| agent-panel-form | page.evaluate: SecurityError: Failed to read the 'localStorage' property from 'Window': Access is denied for this document. | 红 1（27s）：前提备好后走到界面；红在顶栏已经没有「分镜」段（只有创作 / 生成 / 预览），走查过期（A） |
| timeline-context-menu | ❌ WALK FAIL: 第 2 项对账一致 — 创建副本/CtrlD/常规 | 过（23s）；macOS 上期望 ⌘D 照旧；Linux 上期望改成 CtrlD |

#### A1 · A：入口 / 文案改了，走查还按旧文案或位置找（4）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| shot-cuts | ✗ 浮条上有「按镜头拆」 | 红 1（32s）：入口找到了，前 11 项全过（检测到 3 个镜头、滑杆过滤、取消勾选后按钮变「加入画布（2）」）；红在「落了 3 个新节点 — 实得 1」：按钮写 2、期望写 3、实际落 1，走查和产品至少有一边不对，待查（疑似 C） |
| shot-cut-empty-states | ExpectError: 点不到「node-strong 的「按镜头拆」」：等满 15000ms 它都没可见。 | 过（13s） |
| f3-f16b | ExpectError: 创作助手输入框可见 | 红 1（21s）：入口找到了；红在「点击选区入口后进入同一拆镜流程」找不到元素，当时页面上开着「帮 Nomi 变好」同意卡，待查 |
| default-generation-model | if (!condition) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`) | 过（51s）；夜跑那一行是走查自己的 throw 语句；真正的失败是工具条第二个按钮现在是「视频」，两张卡都开成了视频卡，设给「文生图」的默认继承不到。改认 button[data-node-kind="image"] 后过 |

#### A1L · A：入口 / 文案改了（未修，列出）：等的文案或类名在 src/ 里零命中、撞上同名新按钮，或入口的出现条件变了（11）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| notification-policy | locator.click: Timeout 30000ms exceeded. | 没跑；等的按钮「检查文件夹」在 src/ 里零命中 |
| comfy-workflow-multiref | ExpectError: expect(locator).toBeVisible() failed | 没跑；等的标题「确认接入并开始验证」在 src/ 里零命中 |
| mcp-workbuddy-client-profile | ExpectError: expect(locator).toBeVisible() failed | 没跑；等的按钮「一键接入 WorkBuddy」在 src/ 里零命中 |
| feedback-loop-consent-and-report | FEEDBACK LOOP WALK FAIL: Error: 点不到「切到生成面」：等满 15000ms 它都没可见。 | 没跑；按 role=button「生成」找顶栏分段，找不到；顶栏分段该经 _shell.mjs 的 switchWorkspace（data-mode）找（推测） |
| feedback-batch-hardening | locator.click: Error: strict mode violation: locator('[aria-label="添加图片节点"]') resolved to 2 elements: | 没跑；[aria-label="添加图片节点"] 现在命中 2 个元素（strict mode），撞上同名新按钮 |
| design-lab-settings | ✓ privacy-04-failed 516×600 导出失败 · 结果行说人话并请再试 | 没跑 |
| library-cover-imported-video | locator.click: Timeout 30000ms exceeded. | 没跑；等首启引导的「跳过」，没等到，待查 |
| model-kind-misguess | ✗ 设置页能力摘要显示「文本 3」（这家能干什么，一眼可见） | 红 1（49s）：等的「文本 3」在 src/ 里零命中（设置页能力摘要的写法改了） |
| local-gateway-onboarding | ✗ resultCopyMatchesUnlockedBehavior | 红 1（64s）：resultCopyMatchesUnlockedBehavior：结果文案和解锁行为对不上，接入流程改过（会填代理字段），要逐项跟 |
| dark-journey | ❌ 走查失败，失败现场已截图 → tests/ux/shots/dark-journey/99-failure.png | 红 1（24s）：本机同样红在「导出 MP4」：走查按类名 .workbench-preview-player__export-button 找，这个类名在 src/ 里只剩引导旅途的备选选择器还写着，没有元素再用它；导出钮在顶栏（data-shell-export） |
| focus-indication | "error": "locator.click: Timeout 30000ms exceeded. Call log: - waiting for getByRole('searchbox', { name: '搜索项目', exact: true }) at inspectText (<repo… | 红 1（50s）：本机同样红：在空项目库上找「搜索项目」框。10-08 外壳重设计（f59b38d80）起首启空库不画工具条（tab=projects 且 !firstRun 才画），走查要先造一个项目 |

#### A2 · A：功能删了 / 语义改了：走查测的东西已不存在（8）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| deconstruction-panel | 走查异常： ExpectError: 基线不成立：「拆解面板占槽时这个定位器找得到它」应当能被探针找到，但一个都没找到。 | 没跑；拆解面板（占槽）已经不在了：10-11 起「按镜头拆」收进视频浮条的「拆解▾」菜单（180c7be3c），建议删这条走查 |
| anchor-real | ExpectError: 旧行为锚未消费 | 没跑 |
| storyboard-anchor-policy | ExpectError: 锚卡消费橙字 | 没跑 |
| model-availability-agreement | if (!condition) throw new Error(`WALK FAIL: ${label}${detail ? ` — ${detail}` : ''}`) | 红 1（13s）：内置的「本地转写（离线）」现在总在「已接入」里，走查假设没 key 时「已接入」为空（截图 tests/ux/shots/model-availability-agreement/01-no-key-settings.png） |
| assisted-onboarding-entry | ExpectError: ② 技能正文里缺 nomi_integration | 没跑；技能正文里的 nomi_integration 09-18 改了名（4b43f3ac9），走查还按旧名找 |
| production-stalled-draft | ✅ ① 未实现的 playbook 当场被拒，且错误说清了「传的是什么」「可用的是什么」 —— Error invoking remote method 'nomi:production-runs:create-draft': Error: playbook「film.scene-recreatio… | 没跑；走查要「没有产生任何花费」这句，src/ 里零命中（界面已经不谈钱） |
| vendor-connection-health | ✗ 三家都已配好地址 + key | 红 1（12s）：本机同样只有 apimart hasApiKey=false，等 upsertVendorApiKey 落地再读也一样（本机实测，已撤回那一改）。apimart 是内置直连 key，09-22 起保存时的验证改打 baseUrlHint 上的免费余额口 GET /v1/balance（credential-probe-free 的夹具就答这个口，本机过）；这条走查的 mock 只在 /ok/ 下答模型列表，推测是 mock 落后于这次改动（未逐行验证） |
| arrange-draft-cta | ✗ 空时间轴没出现「拼成初稿」提示行（看 preview-empty-with-cta 截图） | 红 1（14s）：本机同样红：空时间轴的「一键拼成初稿」提示行 09-01 起删了（TimelinePanel 里的注释写明保留工具栏的 AI 拼片），门控函数 timelineHasVisualClips 只剩测试在用。建议删这条走查，连同只剩测试在用的门控函数 |

#### AG · 待 agent 线：Agent 面板 / 运行时走查：全是 UI 断言失败（无夹具错配），集中在面板块结构（18）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| agent-artifact | agent-artifact 走查失败: 这一轮没落地：产出迟迟没出现 | 没跑 |
| agent-lane-deletion | "error": "Error: expect(received).toBe(expected) // Object.is equality Expected: true Received: false at captureRawStack (<repo>/node_modules/.pnpm/pl… | 没跑 |
| agent-thinking-rows | "error": "Error: expect(locator).toBeVisible() failed Locator: locator('[data-agent-resident=\"true\"][data-agent-panel=\"true\"][data-agent-surface=\… | 没跑 |
| agent-v4-retry-storm | "error": "Error: expect(locator).toHaveAttribute(expected) failed Locator: locator('[data-agent-resident=\"true\"][data-agent-panel=\"true\"][data-age… | 没跑 |
| agent-process-tone | "error": "locator.evaluate: Timeout 30000ms exceeded. Call log: - waiting for locator('[data-v4-block=\"process\"]').locator('[data-v4-block=\"tool\"]… | 没跑 |
| agent-runtime-editing | "error": "Error: expect(locator).toContainText(expected) failed Locator: locator('[aria-label=\"创作文档编辑区\"] .tiptap[contenteditable=\"true\"]') Expecte… | 没跑 |
| agent-timeline-ops | ExpectError: 可撤销的改动才给到「不再问 →」 | 没跑 |
| agent-v4-short-film | "error": "Error: expect(locator).toHaveAttribute(expected) failed Locator: locator('[data-agent-resident=\"true\"][data-agent-panel=\"true\"][data-age… | 没跑 |
| agent-domain-owners | [full-walk] ✖ 铁律 6（surface-modal）@ 用户：点开左栏里 Agent 写好的分镜方案：「modal」自己从「none」变成了「文稿」——用户这一步「用户：点开左栏里 Agent 写好的分镜方案」没有声明它 | 没跑 |
| agent-panel-system-prompt | "error": "Error: system 里缺少专长层的「create_staging_reference」——像是只到了一部分，检查是否被截断 expect(received).toContain(expected) // indexOf Expected substring: \"crea… | 没跑 |
| agent-runtime-production | "error": "Error: 基线不成立：「Inline storyboard planning reaches the real Resident approval boundary」应当能被探针找到，但一个都没找到。 如果连它都找不到，说明面板没渲染 / 选择器写错了，那么后面任何「没看到坏… | 没跑 |
| agent-inflight-shots-reload | "error": "Error: 点不到「卡上的范围切到「全部」」：等满 15000ms 它都没可见。 要么这一屏根本没走到（上一步其实失败了），要么定位器已经过期—— 两种都必须报红：静默跳过一步再继续截图，就是假绿。 expect(locator).toBeVisible() failed Lo… | 没跑 |
| agent-queued-shot-not-regenerable | "error": "Error: en：第二镜挂着「排队中」 en：第二镜挂着「排队中」 expect(received).toBe(expected) // Object.is equality Expected: \"queued\" Received: \"stopped\" Call Log… | 没跑 |
| agent-single-shot-skill-boundary | "error": "Error: expect(received).toMatchObject(expected) - Expected - 1 + Received + 0 Object { - \"message\": \"agent_skill_unavailable\", \"ok\": f… | 没跑 |
| agent-thinking-overlap | "error": "Error: expect(locator).toHaveCount(expected) failed Locator: locator('[data-agent-resident=\"true\"][data-agent-panel=\"true\"][data-agent-s… | 没跑 |
| agent-ui-exception-states-runtime | "error": "page.evaluate: TypeError: Cannot read properties of undefined (reading 'open') at eval (eval at evaluate (:302:30), <anonymous>:14:66) at as… | 没跑 |
| stage4-switch | "error": "Error: expect(locator).toBeVisible() failed Locator: locator('[data-agent-resident=\"true\"][data-agent-panel=\"true\"][data-agent-surface=\… | 没跑 |
| telemetry-scope-reconfirm | ❌ page.waitForSelector: Timeout 15000ms exceeded. | 没跑 |

#### DIR · 别的线：director-*（导演台走查迁移，分支 fix/director-walks-3dbox，协调在推）（23）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| director-ai | ✗ AI走查中断：Error: 点不到「AI 搭场景」：等满 15000ms 它都没可见。 | 没跑 |
| director-fields | page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5175/.tmp/director-full-audit-20260907/inspector-fields.html | 没跑 |
| director-j4-kneel-stand-look | ✗ 旅程中断：点不到「顶栏·添加」：等满 15000ms 它都没可见。 | 没跑 |
| director-j8-project-interactions | ExpectError: 点不到「顶栏·添加」：等满 15000ms 它都没可见。 | 没跑 |
| director-timeline-pointer | page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5175/.tmp/director-full-audit-20260907/timeline-pointer.html | 没跑 |
| director-waypoint-aim | page.goto: net::ERR_CONNECTION_REFUSED at http://127.0.0.1:5175/.tmp/director-full-audit-20260907/waypoint-aim.html | 没跑 |
| director-assets | ✗ 资产走查中断：Error: 点不到「顶栏·＋」：等满 15000ms 它都没可见。 | 没跑 |
| director-j1-three-person-scene | ✗ 空工程·视口空态提示 | 没跑 |
| director-j5-splat-valley | ✗ 旅程中断：点不到「顶栏·＋」：等满 15000ms 它都没可见。 — 要么这一屏根本没走到（上一步其实失败了），要么定位器已经过期—— ⇐ 两种都必须报红：静默跳过一步再继续截图，就是假绿。 ⇐ | 没跑 |
| director-mobile | ExpectError: 点不到「顶栏·添加」：等满 15000ms 它都没可见。 | 没跑 |
| director-ual-crowd | ✗ 旅程中断：点不到「顶栏·添加」：等满 15000ms 它都没可见。 | 没跑 |
| director-windowbar | ✗ ② 顶部工具条整条落在拖拽带之外（这才是「点得动」的充要条件） — 0 个按钮，最高的 top=null 需 ≥ 40 | 没跑 |
| director-clip-states | throw new ERR_UNKNOWN_FILE_EXTENSION(ext, filepath); | 没跑 |
| director-j2-walk-to-b | ✗ 旅程中断：点不到「顶栏·添加」：等满 15000ms 它都没可见。 | 没跑 |
| director-j6-outputs | ✗ 旅程中断：点不到「顶栏·添加」：等满 15000ms 它都没可见。 | 没跑 |
| director-reference-attach | throw new ERR_MODULE_NOT_FOUND( | 没跑 |
| director-ual-mannequin | ✗ 旅程中断：点不到「顶栏·添加」：等满 15000ms 它都没可见。 | 没跑 |
| director-3dbox-shell | throw new ERR_MODULE_NOT_FOUND( | 没跑 |
| director-electron | ExpectError: 点不到「顶栏·添加」：等满 15000ms 它都没可见。 | 没跑 |
| director-j3-three-cameras | ExpectError: 点不到「顶栏·添加」：等满 15000ms 它都没可见。 | 没跑 |
| director-j7-skeleton | ✗ 旅程中断：点不到「顶栏·添加」：等满 15000ms 它都没可见。 | 没跑 |
| director-refine-tasks | ✗ 旅程中断：精修顶栏没出来 | 没跑 |
| director-ual-migration | ✗ 旅程中断：locator.getAttribute: Timeout 15000ms exceeded. | 没跑 |

#### LIB · 别的线：技能库 / 提示词库相关走查（归 I-libraries 线）（5）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| asset-surface-convergence | FAIL 旧提示词卡迁入主提示词库可见 | 没跑 |
| i18n-sweep | ✗ [en] 侧栏·Prompt library · 无残留中文 — Error: [en] 侧栏·Prompt library：英文界面不该有未翻译中文（EN-DOM 断言网）：找到 4 处 CJK 文本。 / · button.shrink-0.rounded-full “表情预设” / · b… | 没跑 |
| skill-library-cards | ExpectError: expect(locator).toBeVisible() failed | 没跑 |
| node-prompt-presets | locator.click: Timeout 30000ms exceeded. | 没跑 |
| library-category-collapse | ExpectError: expect(locator).toContainText(expected) failed | 没跑 |

#### B3C · 在途只分诊：生成框 B3（#1269）/ 节点指向（#1301）在途：composer 控件、模式 tab、浮条结构（16）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| canvas-control-clarity | locator.click: Timeout 30000ms exceeded. | 红 1（50s） |
| node-composer-placement | ✗ 视频节点有「每次生成几个」控件 | 红 1（30s）：✗ 视频节点有「每次生成几个」控件 |
| design-lab-node-composer-bar | ✗ composer-bar-v1-video 现役 composer 卡应有 1 张，实际 0 —— 这一格没渲染出真身 | 没跑 |
| omni-video-reference-gate | ❌ 点不到「全能参考 模式 tab」：等满 15000ms 它都没可见。 | 没跑 |
| audio-reference-connect | ❌ 点不到「全能参考 模式 tab」：等满 15000ms 它都没可见。 | 没跑 |
| composer-long-prompt | ✗ 提示词区中间正常向下滚动 | 没跑 |
| prompt-picker | ExpectError: composer 里应当有且只有 1 个提示词选择器（一功能一个家） | 没跑 |
| at-mention-edge | body head: @候选连线图走查 创作 生成 1/2 预览 文稿 目录 素材 流程 Skill 提示词 坏图（验占位） 加载失败 重试 角色图（连线来源） 视频 drone reference 视频 镜头（全能参考） 视频节点 已连接输入，等上游产出后继续 | 没跑 |
| mention-scope | ✗ 画布上有 2 张素材 + 1 个目标节点 — 实得 2 | 没跑 |
| model-pick-confirm | — 自动拉取（假地址失败）→ 端点没列出态 + 手动选择入口 — | 没跑 |
| node-toolbar-one-row | ExpectError: 浮条出现：视频操作 | 红 1（27s）：ExpectError: 浮条出现：视频操作 |
| canvas-frame | ExpectError: 全选后浮条上出现「统一模型」 | 没跑 |
| grouping-optimization | ExpectError: 再次点击空白组框后工具条出现 | 没跑 |
| canvas-handle-menus | {"name":"04-left-ring-on-video-adds-image-upstream","pass":false,"error":"h-video is hittable \| h-video is hittable \| expect(received).toBe(expected) … | 没跑 |
| clip-drop-zoom | FAIL P5 @50% 没悬停时，拖放把手那一点最顶层是把手本身；真鼠标拖它能发出画布节点载荷 {"box":{"w":16,"h":16},"top":{"isNotch":false,"tag":"SPAN"},"mimes":["application/x-tapcanvas-generat… | 没跑 |
| clip-gesture-ownership | FAIL P7 @50% 画布片段拖动被 pointercancel 打断后干净结束并回到拖之前 {"draggingBefore":"false","draggingAfter":"false","draggingAfterMove":"false","startBefore":408,"star… | 没跑 |

#### C · C 候选：产品行为和走查合同不一致、锚点还在源码里：疑似回归（复现步骤见下）（2）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| renderer-failure-diagnostics | ✖ 那一行带着真因（manifest 锁忙） [2026-10-23T23:17:53.121Z] ERROR renderer project-save-failed trigger=autosave Error msg#d559bf39 | 红 1（13s）：本机复现，一字不差（同一个指纹 msg#d559bf39）：隐私那几项全过，只红「那一行带着真因」 |
| asset-library-interactions | FAIL ⑤ 删两张：a-spare.png 没了 · 确认删除后 a-spare.png 不该还在（基线已证：删除前项目素材里有 a-spare.png） | 红 1（231s）：本机复现：确认删除后抽屉顶上出「选中的素材暂时无法删除」，选中数归 0，两张都还在（截图 09 / 10） |

#### ? · 未细分：逐条看过夜跑证据，没来得及本机复现定 A / C（夜跑原文 + 本机复跑结果在这）（38）

| 走查 | 夜跑证据（日志原文） | 本机复跑 |
|---|---|---|
| claim-unsent-retry | [claim-unsent-retry] zh-CN: FAILED first-attempt-fails, face-says-why-not-generic, face-offers-retry, walk-error: locator.click: Timeout 30000ms excee… | 红 1（140s）：[claim-unsent-retry] zh-CN: FAILED windows-offscreen-and-unfocusable, first-attempt-fails, face-says-why-not-g… |
| comfy-workflow-feedback | ExpectError: expect(received).toBe(expected) // Object.is equality | 红 1（14s）：本机同样红：一个 expect.poll 等满 5 秒还是 false（栈只到走查的 _collect 包装，看不出等的是哪一项），没细拆 |
| contextual-node-guidance | ExpectError: expect(locator).toBeVisible() failed | 红 1（44s）：本机同样红：等的模态框（role=dialog、aria-modal=true）5 秒没出，待查。它每跑一次会重写受控证据 docs/evidence/2026-10-11-node-guidance/（已还原） |
| design-lab-ask-card-in-panel | （日志无断言行，退出码 1 · 115s） | 没跑 |
| design-lab-catalog-liveness | ✗ catalog-liveness-light: expected one unlisted note | 没跑 |
| editing-panel-system | ❌ 左「镜头/素材」栏 ≥ 240（合同最小宽） — 32px | 红 1（13s）：本机同样红：左栏只有 32px（收成图标条）、找不到 Nomi 栏。布局合同和现在的默认收起态 / 栏位结构对不上，待查 |
| mcp-key-window | Error: MCP open_credentials should bring Settings to the front | 红 1（51s）：Error: MCP open_credentials should bring Settings to the front |
| onboarding-checkmark-honesty | ExpectError: 点不到「拆成镜头·落画布」：等满 8000ms 它都没可见。 | 红 1（27s）：本机同样红：8 秒内没出「拆成镜头·落画布」（data-action-run="storyboard" 还在 src 的 StoryboardActionCard），出现条件待查 |
| plan-gate | ✗ FAIL: stdio MCP 服务起来了（探到运行中的 GUI） | 没跑；「stdio MCP 服务起来了（探到运行中的 GUI）」——走查要求机器上没开着 Nomi，夜跑机器上为什么探到 GUI 待查（同批前面走查的残留进程？） |
| storyboard-reference-slots | 要么这一屏根本没走到（上一步其实失败了），要么定位器已经过期—— | 没跑 |
| storyboard-table-phasec | 要么这一屏根本没走到（上一步其实失败了），要么定位器已经过期—— | 没跑 |
| video-clip-direct | {"name":"09-real-1080p-performance-and-keyboard","pass":false,"error":"expect(received).toBe(expected) // Object.is equality \| Expected: 3 \| Received:… | 没跑；1080p 真视频那一格少一帧 / 一项（期望 3 实得 2）。可能属 10-23 第 2 节 video-codec 组的假设（CI 的 Chromium 缺 H.264），未在 CI 上验证 |
| video-playback-heal | locator.waitFor: Timeout 20000ms exceeded. | 没跑；视频播放等待超时，可能属 video-codec 组的假设，未验证 |
| windows-freeze-sweep | ✖ 新建图片节点 → 生成（等待动效在跑） — 帧间隔 50ms · 主进程 10ms · 报错 locator.waitFor: Timeout 30000ms exceeded. [06.png] | 没跑 |
| browser-overlay-interaction | 素材盒浮层走查异常: Error: overlay window never appeared | 没跑 |
| creation-flow-fixes | ❌ A 一次改全部镜头 — 只有 0 张镜卡变成视频镜，期望 12：Error: 期望 12 张镜卡都出现时长选择器（=全变视频镜） | 红 1（52s）：本机同样红：A「一次改全部镜头」0 / 12 张变视频镜；E 找不到 composer 档位钮（生成框 B3 在途改动相关的可能大）；D 的基线不成立。混在一起，待拆 |
| project-asset-healthcheck | locator.waitFor: Timeout 20000ms exceeded. | 没跑 |
| task-center | ❌ 节点没加够（读到 6 个）——后续状态摆不出来，停。 | 红 1（73s）：本机同样红：节点没加够（读到 6 个），后面的状态摆不出来；加节点的入口变了的可能大，待查 |
| agent-video-landing-paid.rehearsal | "error": "locator.waitFor: Timeout 15000ms exceeded. Call log: - waiting for locator('[data-key-only-vendor=\"apimart\"]').first().locator('[data-key-… | 没跑；填 key 后「已连通」（data-key-only-success）没出现。锚点还在 src（KnownVendorKeyConnectPage），agent-runtime-fixture 也答 GET /v1/balance，原因待查（未复现） |
| asset-transport-settings | ❌ 明确说明上传免费 — 素材上传通道 | 红 1（21s）：本机同样红：设置页「素材上传通道」那段没有「上传免费」的说明；推测同 production-stalled-draft——界面已经不谈钱（A，未核） |
| feedback-share-center | ExpectError: 点不到「关于页「反馈与分享」入口」：等满 15000ms 它都没可见。 | 红 1（41s）：本机同样红：关于页里找不到「反馈与分享」入口，入口挪了或改名的可能大（A），待跟 |
| layout-timeline-panel-span | ExpectError: ③ 两个都开：底部带没「在右面通过去」——右缘没到窗口右边（timeline.right=1272 viewport=1280） | 红 1（6s）：本机同样红、数也一样：底部带右缘 1272，窗口 1280。现在外壳四周有 8px 留白、面板是内嵌圆角卡，走查的「通到窗口右边」合同和现在的外壳设计对不上（A，待设计确认） |
| library-load-error | ExpectError: 基线不成立：「首启空库引导屏「还没有项目」」应当能被探针找到，但一个都没找到。 | 红 1（24s）：本机同样红：首启空库的「还没有项目」找不到（文案还在 src，只在「首次空库、无搜索、来源=全部」时出），待查 |
| project-location-settings | ❌ 设置页显示当前自定义目录 — /tmp/project-location-settings-kZZ0gI/projects | 红 1（21s）：本机同样红：设置页上找不到当前自定义目录的完整路径（本机在系统临时目录下，夜跑在 /tmp/ 下），像是设置页改了路径的显示法，待查 |
| provider-model-discovery | ExpectError: expect(received).toContain(expected) // indexOf | 红 1（16s）：ExpectError: expect(received).toContain(expected) // indexOf |
| reference-capture | 失败项不进网格且带重试/移除: PASS | 没跑；日志首行是一条 PASS，真正失败的那一项在后面，没细看 |
| storyboard-model-same-name | ❌ 同名模型走查失败（zh-CN）： | 红 1（21s）：本机同样红：起点「镜 1 应回显自定义那家（image2）」——镜 1 行里 15 秒没出「图片模型」框（行锚点 data-storyboard-row 还在 src），待查 |
| storyboard-strategy-resolve | 走查失败： ExpectError: 拆条采纳后 shot-1 的超限警示应当消失，只剩 shot-4 的低于下限 | 红 1（44s）：本机同样红：拆条采纳后 shot-1 的超限警示没消失（期望只剩 shot-4 的低于下限），待查 |
| timeline-toolbar-row | ExpectError: 压到 320px 后没有产生横向滚动（说明被裁掉或换行了） | 红 1（8s）：本机同样红：时间轴工具条压到 320px 没出横向滚动（被裁掉或换行了），布局合同待查 |
| toolbar-order | locator.click: Timeout 30000ms exceeded. | 红 1（48s）：本机同样红：点项目名「工具栏梳理回归」后 30 秒内画布上没有 img-node（data-node-id 锚点还在 src），是不是没进项目没核，待查 |
| video-depth-real-task | ExpectError: 派生节点上没有进度遮罩 | 红 124（600s）：本机没复现：要现场下载 47 MB 深度模型权重，本机 600 秒到点还在「下载模型 … 8%」，被停；前面 8 项全过。夜跑 76 秒就下完、红在「派生节点上没有进度遮罩」。这条要真网络，是否留在夜跑待定 |
| volcengine-speech-credential | ✗ 没找到火山豆包语音卡 | 红 1（9s）：✗ 没找到火山豆包语音卡 |
| asset-library-native-import | Error: 拖入后未落盘第二张图片，发现 1 张 | 没跑；拖入第二张图后只落盘 1 张，和 C2 同属素材库，疑似 C，未复现 |
| asset-video-preview | 走查失败: locator.evaluate: Error: 30 秒内未生成视频封面 | 没跑；30 秒内没生成视频封面，可能属 video-codec 组的假设，未验证 |
| creation-ai-rewrite-real.rehearsal | "error": "locator.waitFor: Timeout 15000ms exceeded. Call log: - waiting for locator('[data-key-only-vendor=\"apimart\"]').first().locator('[data-key-… | 没跑；同上一条（data-key-only-success 没出现），未复现 |
| creation-plan-delete-undo | Locator: locator('[role="dialog"]') | 没跑 |
| dark-audit | locator.click: Timeout 1600ms exceeded. | 没跑 |
| first-launch-system-locale | ✗ [en] 项目库相对时间英文（无中文时间串） — enTime=false zhTime=false | 红 1（32s）：本机 8 项过 7 项，同样红在 [en] 项目库相对时间：英文、中文时间串都没找到（enTime=false zhTime=false），像是项目库里压根没出相对时间，待查 |

### 7.3 C 类候选：复现步骤

不改产品代码，只写怎么复现。命令都在仓库根跑，先 `pnpm run build`。

**C1 · renderer-failure-diagnostics：诊断包里的那一行又说不出「为什么」了**
- 复现：`node tests/ux/renderer-failure-diagnostics.walk.mjs`（走查自己把项目 manifest 锁占成「别的机器在用」，再触发一次自动保存，导出诊断包）。
- 现象（夜跑原文，本机复跑一字不差，连指纹都一样）：`ERROR renderer project-save-failed trigger=autosave Error msg#d559bf39`；同一次的主进程报错是 `WorkspaceManifestLockBusyError: Workspace manifest is owned on another host`。同一条走查里「不含项目名 / 本机用户名 / 文档内容」那几项全过，只红这一项。它不在第 5 节 10-18 到 10-21 的稳定红里，是 10-22 之后才红的。
- 期望：日志那一行带着真因（类名 `WorkspaceManifestLockBusyError` 或 manifest 锁忙）。这是 2026-09-24 用户反馈后补的口子（诊断包里只有「保存失败」、看不出为什么）。
- 嫌疑：10-22 的落盘脱敏（8f684ebb9 / 170d2182a）规定只写类名、错误码，自由文本一律成 `msg#指纹`。可这个错误过 IPC 之后在渲染层只剩一个普通 `Error`，类名已经在报错文本里，于是连类名一起被指纹化。脱敏规则本身允许写类名，丢的是「过 IPC 时把类名当结构字段带过来」这一步。要在隐私和可诊断之间定口径，交协调。
- 截图：无（只看日志文件）。

**C2 · asset-library-interactions：多选删除，确认之后图还在**
- 复现：`node tests/ux/asset-library-interactions.walk.mjs`。第 ⑤ 步：素材库「项目素材」页签，勾选两张（一张图 a-spare.png、一条视频），点删除，弹窗里确认。
- 现象（夜跑原文）：`FAIL ⑤ 删两张：a-spare.png 没了 · 确认删除后 a-spare.png 不该还在（基线已证：删除前项目素材里有 a-spare.png）`。前面 ①–④（拖到画布、跨项目复制、勾选 / 取消、归入文件夹）全过，选中计数也对（selected=2）。
- 期望：确认后两张都从项目素材里消失。
- 本机复现：确认弹窗照常出现（「删除 2 个项目素材？…落盘文件会移到系统回收站。」），点「删除」后素材抽屉顶上出「选中的素材暂时无法删除」，选中数归 0，两张都还在。这句提示只在「移除的结果 / 删掉的文件 / 删失败的文件」三个计数全是 0 时出（`src/workbench/assets/AssetLibraryPanel.tsx`），也就是说删除口一张都没认出来：先答应删、再说删不了。
- 嫌疑提交没定位。它在第 5 节就是稳定红（10-18 到 10-21 四次都红在这一步），不是 10-23 的改动带进来的；删除走 `src/workbench/assets/deleteAssetResult.ts`，那个文件最近一次改在 10-07。
- 截图：`tests/ux/shots/asset-library-interactions-zh-CN/` 里的 09-confirm-delete-two（确认框）、10-after-delete-two（删后提示与两张仍在）。

**还没复现确认的疑似 C**（修掉连坐 / 前提之后才露出来，证据在 7.2 的本机复跑列）：
- storyboard-windowing：滚走再回来、卸载再挂上之后，Ctrl+Z 撤不回原文（三项都红）。
- shot-cuts：按镜头拆勾 2 个，按钮写「加入画布（2）」，结果只落 1 个节点（走查期望 3，走查本身也要改）。
- runway-vendor-honest-modes：Runway 已接，模型下拉里却整行没有 HappyHorse 1.0（09-28 起渠道行并进模型身份，并完应是「HappyHorse 1.0 · Runway」）。
- asset-library-native-import（只有夜跑证据）：拖入两张图只落盘 1 张，和 C2 同属素材库。

### 7.4 跟进

- **director-model-import 收窄排除，这次不动。** 它整条被排除，理由写的是「要私有 Mixamo FBX」。其实走查在没设 `NOMI_DIRECTOR_TEST_FBX` 时会自己跳过 FBX 半段，照跑 GLB 半段（用现场生成的立方体 GLB）。所以收窄不用改夜跑选择规则，删掉 exclusions 里那一行就行。但在 main 上，GLB 半段同样红在「顶栏·＋」点不到（和导演台其它走查同一个真因，本机 19 秒红），要等导演台走查迁移合进来才会绿。建议由导演台那条线在迁移合入时删掉这一行。另外，FBX 半段跳过时走查仍以 0 退出，夜跑只会记「过」，看不出少测了一半。
- **「跳过」被记成「过」。** find-reference、draft-loop、storyboard-methodology 没有真 key / 真资料就以「跳过」退出，夜跑一直把它们记成通过，这次已移出夜跑。同类还有 director-model-import 的 FBX 半段。建议约定一个「跳过」退出码，让夜跑汇总单列。
- **走查往受控的 docs/ 里写证据。** 这一轮本机复跑里，agent-panel-form（`docs/plan/b2c-form-evidence/`）、canvas-magnetic-handle（`docs/plan/canvas-magnetic-handle-evidence/`）、group-header-real-app（`docs/evidence/2026-10-10-group-header/`）、model-box-tidy（`docs/plan/2026-09-11-model-box-tidy-evidence/`）、vendor-card-locale（`docs/evidence/2026-10-08-money-copy/`）、contextual-node-guidance（`docs/evidence/2026-10-11-node-guidance/`）每跑一次都把受控截图重写一遍，project-location-settings 红了会把失败截图写进 `docs/design/mockups/2026-08-07-project-location/`（都已还原）；tests/ux 下有 36 个文件拼出受控的 `docs/evidence/…`、`docs/plan/…-evidence` 等路径（有读有写，没逐个分）。docs 不进构建身份，树核对不拦，后面的走查不会被连坐，但工作树会变脏。建议证据默认写被忽略的目录，要更新受控证据时显式带参数。
- **要真网络的走查。** video-depth-real-task 现场下载 47 MB 深度模型权重：本机 600 秒还在 8%，夜跑上 76 秒就下完、红在后一步。网络一慢它就挂到上限，红的原因和它要测的东西无关。建议权重走缓存或夹具，或者移出夜跑，交协调定。
- **死锚。** 走查里 25 个 `getByLabel` 字面量，有 5 个在 src 里零命中（editing-real-user-pass「音量数值」、image-grid-split-freeze「2 张堆叠图片」、param-panel-numeric.e2e「百万像素」×2 /「去噪强度」；有的可能是运行时拼出来的，要逐个看）。A1L 那一类大多是这么来的：走查等的文案在 src 里已经没了。建议把现有的「死 aria-label」静态检查扩到 `getByLabel`。
