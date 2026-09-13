# 第二层：真实旅程体验量表

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

## 先查别人

调研日期：2026-09-09。先核对方法的适用边界，再定阈值；不是把代理指标包装成用户结论。独立反方已核对来源，并以设计/PM/真实用户审查；另一独立审查以 CTO/前端/后端覆盖执行身份、事件归属和完整性。

| 维度 | 别人怎么量 / 规范 URL | 直接采用什么 |
| --- | --- | --- |
| 链路长度 | Google HEART task success：https://research.google/pubs/measuring-the-user-experience-on-a-large-scale-user-centered-metrics-for-web-applications/ | 完成率、操作数、耗时；不能以操作数替代任务成功 |
| 每步理解 / 目标理解 | Nielsen：https://www.nngroup.com/articles/ten-usability-heuristics/；认知走查：https://www.nngroup.com/articles/cognitive-walkthroughs/ | 按任务目标审下一步、可发现、语义匹配、反馈；离线只给代理检查与待人工评审 |
| 图标 / 文案 | Apple HIG：https://developer.apple.com/design/human-interface-guidelines/accessibility；Material：https://m2.material.io/design/usability/accessibility.html（v3 静态抓取仅壳，采用已读 v2） | 可见标签与可访问名称分开；tooltip 存在不证明看得懂；图标盲猜不泄露真实功能 |
| 整齐 / 空间 | HIG 同上；WCAG：https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | 同父布局组量 gap/边缘；24 CSS px 只是目标尺寸检查起点，间距例外单列，不套触屏 44pt 给桌面 |
| 伸手 | Fitts：https://www.yorku.ca/mack/hci1992.html | log2(D/W+1)，记录运动方向上的有效宽度、无首点则不编造距离；没有通用指数上限 |
| 速度 | https://web.dev/articles/inp；https://developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time | INP 200ms、TBT 200ms 是各自口径参考；本地操作计时不冒充 INP/TBT，不跑 Lighthouse 总分 |
| 逐维判官 | https://arxiv.org/html/2604.25420v1#S3；https://doi.org/10.5281/zenodo.19498008（公开复现包） | 有锚点的逐维评分、理由与证据；离线与 VLM 分离，缺证据不评分 |
| 机械缺陷 | 第一层 PR #662 | 原样复用 `_feel.mjs`，记录其 findings，不另造几何缺陷扫描器 |
| 时序与截图 | Context7 `/microsoft/playwright`；https://github.com/microsoft/playwright/blob/main/docs/src/api/class-tracing.md；https://github.com/microsoft/playwright/blob/main/docs/src/api/class-page.md | 官方 tracing、addInitScript、exposeBinding、locator boundingBox、截图；不用私有 trace 格式作为计量真源 |

Nielsen 严重度一手出处：https://www.nngroup.com/articles/how-to-rate-the-severity-of-usability-problems/ 。0–4 综合频率、影响、持续性；单次离线扫描不伪造频率或严重度结论。

开源近邻：ComfyUI frontend 与 Nomi 同为创作用户、图像媒介、画布载体且开源。固定 commit `8a8fbda178b483b382f2f313226b0c6f4093dc6c`：
- https://github.com/Comfy-Org/ComfyUI_frontend/blob/8a8fbda178b483b382f2f313226b0c6f4093dc6c/browser_tests/fixtures/ComfyMouse.ts#L77 ：visible→boundingBox→真实鼠标，采用目标 rect 派生运动，不复制启动器。
- https://github.com/Comfy-Org/ComfyUI_frontend/blob/8a8fbda178b483b382f2f313226b0c6f4093dc6c/browser_tests/fixtures/helpers/PerformanceHelper.ts#L136 ：longtask observer 可复用方法，任意窗口不称 TBT。只证明测量原语，不证明跨产品步数优劣。

## 范围与分工

只改 tests/ux、scripts、docs、package.json scripts；UR-LAST.md 是用户明确要求的交付例外。不改生产代码、不读真实项目库、不加依赖、不调用付费模型。用户要求发现的问题只列不修，优先于通用的“扫到就修”。

第一层源 ref：origin/test/ux-feel-regression-mechanism-20260909。merge-base 已先核算。其 `_feel.mjs` 是扫描器；catalog 是唯一旅程登记；`feel-nightly.mjs` 目前只输出预填症状清单，walk 只断言登记，不证明真实执行。第二层将同入口接到真实执行，旧登记保留为明确未执行；不另起夜跑或目录。只通过 git show 读该分支，不访问别的 worktree。

复用现有 `_launchApp.mjs`（隔离启动）、`_assert.mjs`（可见断言/安定截图）、`agent-runtime-fixture.mjs`（loopback SDK 工具/图片）、model-access fixture（连接列表/认证），不引入 SDK、评测框架或生产协议。新增量表只是内部证据，不是外部交换标准。

## 维度与阈值

真相源 `tests/ux/experience/rubric.json`。每维保存问题、机械规则、主观锚点、来源、阈值性质与豁免。评分方向统一 0 最差到 3 最好；严重度另用 Nielsen 0–4，不混成一套数字。

- 路径：点击、填写（一次 fill 算一次输入操作，不算字符）、键盘、滚动、页面/面板切换、确认弹层操作单列；棘轮只减不增，不能把 setup 算成用户路径。
- 理解 / 图标 / 目标：只把主行动候选数、空态标记、可见标签/可访问名/tooltip 线索列成代理指标。离线规则输出 `needs-review`、score=null；VLM 才可给理解评分。每维主观目标 ≥2 是项目期望而非国际标准。
- 文案：按控件类型设项目启发式上限；术语扫描只用量表显式术语清单，`check:vocabularies` 是代码语义 owner 检查，不是用户词汇字典，不能把词表外所有词误判成术语。
- 对齐：只看同容器 flex/grid 的可比兄弟，1px 是项目候选偏差阈值，带缩放/容器证据，不默认所有边缘都应相齐。
- 空间：控件面积覆盖率为采样代理，不叫视觉留白率；不设所有场景通用“舒适区间”。小目标含 spacing 例外待审。
- 伸手：真实点击坐标相邻距离、目标 rect 与 Fitts ID；键盘动作不会虚构指针移动；基线绑定 viewport/DPR/主题/旅程脚本与量表版本。
- 速度：操作返回、显式反馈和任务完成分开；截图/扫描开销不计入动作延迟。长任务可观察 busy/status 反馈，未观察到则 null，不记零。loopback 不代表供应商真实延迟。
- 第一层：无 finding 才为零；扫描异常与 finding 分开，不能 catch 所有异常后当“已扫描”。

v1 不开放可执行豁免：rubric.exemptions 必须为空，非空直接拒绝。维度内解释哪些情况需人工排除，但不自动免除；后续如开放，必须登记维度/旅程/步骤/指标、原因、owner、到期日并拒绝未匹配/过期项。基线不得吸收失败旅程、缺图/缺步骤或未知结果，已有上限只可收紧；人工/VLM 判分保留独立来源，不覆盖机械事实。

## 实施与验收

运行身份含 runId、应用 SHA、量表/采集/扫描/旅程源 hash；每条 run 必须匹配 manifest。对比身份不绑定应用 SHA（否则无法比较产品改动），但绑定口径 hash、平台、viewport、DPR、主题。选中的任何任务失败则非零；未选中旧登记一律 not-selected。

1. 数据量表 → 采集（每步 before/after 截图、DOM、真实事件、目标与耗时）→ 可插拔判官 → Markdown 维度表/分诊清单与 JSON。
2. 在唯一目录登记三个独立任务：画布生成图片；Agent 对话执行工具并验证落盘结果；设置接入模型并验证目录模型启用。仅 loopback，结果来自真实产品处理路径，不 seed 完成态。
3. 共享启动器接受可选 observer，在窗口可用时挂采集；普通走查不受影响。旅程描述逻辑仍在 tests/ux/journeys，不在量表/判官里硬写产品分支。
4. 测试先覆盖事实判分、未知/失败、证据缺失、基线恶化、量表驱动和判官响应校验；负例必须红。实际三条执行并人眼查看截图，问题只列。
5. VLM 手动示例：用真实采集导出的 judge-request.json 做输入，显式 synthetic adapter 回应验证接口（零网络、零付费），不报告成模型评审。
6. `pnpm run gates` 排队直到结果，后续 scoped commit/push 与 PR，不合并。提交及 PR 尾注按用户指定。

回滚：revert 本任务提交即可撤掉第二层；不迁移生产数据。风险：第一层扫描器存在宽泛 DOM 扫描误报可能；以候选 findings 标明来源，不能把它当经人确认的产品 bug。VLM 未执行（零付费），人类理解仍待评审，不能宣称体验已全部达标。

## 根因检查（测试机制）

使用 root-cause-remediation 流程：症状是清单能被误读成“夜跑通过”；直接原因是入口不执行旅程；类根因是报告未绑定执行证据。recurring：agent/artifact/timeline 三个登记入口都受影响。共享边界放在夜跑执行/报告证据校验，失败、缺失、未执行都不得 baseline 通过。无生产修复，合同高风险生产 scope 不适用；依赖保留现有 Playwright，不改变依赖版本。用缺步骤、失败任务、缺截图三个独立负例证明约束。

## 验收记录

- 实测应用源版本：d566c99c3d87a5a0264955c161575a13b2e5d692；零付费 loopback，三条完整任务通过，25 阶段 / 50 张前后截图。
- `experience:test` 7/7；`vitest run tests/ux/_launchApp.test.mjs` 20/20；报告初始化与复算通过；synthetic VLM 接口示例一次通过。
- 真实截图看过接触表与三个放大终态；分诊与完整证据包见 [首轮验收](../audit/2026-09-09-ux-experience-rubric.md)。不修生产体验问题。
- 六角色审查后修正：数据驱动棘轮覆盖滚动/机械候选、事件真实计数、首步面板变化、已有反馈不计零、run/manifest 身份绑定、缺指标与缺图拒绝；独立终审未发现剩余阻断。
- gates 完整通过：75 个 contracts 中全部阻断项通过，文档索引/状态/调研来源为 advisory；Vitest 1290 文件通过 / 1 跳过、12058 测试通过 / 2 跳过；Agent runtime 306 项及附加测试通过，Vite + Electron 构建成功。正常 Ponytail 提交与推送，不合并 PR。
- 常规模型雷达独立运行：apimart 索引新增 gemini-omni-1.1-flash；apimart-llm 凭据路径未查成，未更新快照，不属于本 PR 接入范围。论文雷达技能当前目录未发现，未冒称已运行；本任务的体验量表一手调研已完成。

上游排队更新审查：c89bf70bb→d566c99c3 仅新增启动器可选 initialLocalStorage，本旅程未传；独立复核默认语义不变。三旅程重新采集后 33 个棘轮值逐项完全相同，只迁移未交付基线的 sourceHash metadata，未放宽任何指标。

## #662 最终形态合并（2026-09-09）

冲突范围：`tests/ux/_feel.mjs`、`tests/ux/journeys/catalog.json`、`scripts/feel-nightly.mjs`。扫描器完全采用 origin/main；保留 main 的状态夹具、record/ratchet 观察器、journey/screenshotName/rule 基线与账本。第二层仅补目录元数据和同入口 `--experience` 分道，采集直接消费共享观察器截图记录，删除旧扫描异常兼容路径。生产代码不改。验收：第二层单测、三条真实 loopback 旅程/报告、一层 nightly drift=0、完整 gates、正常 hook 提交推送；回滚用 revert 合并提交，不改 main。口径因最终扫描器与目录合并变化，先对照旧/新指标；操作/路径指标禁止放宽。扫描器及采样时机已换为 #662 最终口径，机械 finding 单独显式迁移并保留旧值，不称为同口径基线通过。

合并复验：三旅程 25 阶段/50 PNG，30 个操作/路径指标逐项完全相同；finding 峰值 12/61/78 → 16/63/27（新版扫描可见区及共享截图时机）。完整迁移对照见 `docs/audit/2026-09-09-ux-experience-merge-baseline.json`。新口径已复算通过，原判官的 incompatible/regressed 拒绝逻辑不改。浏览器共享观察器回归已接入 `test:feel:browser`；新目录允许有真实 runner/steps 的第二层任务无 DOM 夹具，旧一层任务仍要求完整状态。

复跑暴露的同类环境入口：三旅程内页高度一起从 842 漂到 840，源 hash 相同仍被判官正确拒绝。根因是设置 Electron 外窗 content size 不能保证内页 viewport；共享采集 attach 从量表读取固定 viewport，删除旅程外窗尺寸控制。Context7 已核对 Playwright `Page.setViewportSize`，官方实现 `packages/playwright-core/src/server/page.ts` 会等待 viewport 更新；本仓近邻 `tests/ux/production-mcp-journey.e2e.mjs:58` 已采用该接口。浏览器回归直接验证 attach 后实际 innerWidth/innerHeight。只迁移新增固定 viewport 代码的 sourceHash，保持 33 项指标阈值不变。
