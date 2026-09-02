# Real Tutorial System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bilingual, evidence-backed Nomi tutorial system that teaches real user tasks through verified screenshots and recordings, and exposes the same truth in the App, website, and GitHub.

> 状态：🚧 进行中 · 2026-09-01 用户已确认方案与系统测试，进入真实走查、证据采集和内容交付阶段
> （原文写的是「▶ 执行中」，不在本仓认可的状态词表内，会被 check:doc-status 判为未登记；
> 2026-09-02 打捞入库时规范为 🚧，语义不变。）

**Architecture:** Treat the Feishu knowledge base as the primary reading surface and content source for the complete handbook. Each tutorial remains a user-task contract with one source package: goal, prerequisites, exact path, visible success state, failure recovery, raw evidence, annotated evidence, and optional recording. The Feishu handbook owns the long-form narrative and embedded images/videos/tables; GitHub mirrors versionable Markdown and evidence; the website is a lightweight entry/index and selected proof surface; App onboarding links to the relevant chapter in context. All four surfaces derive claims from the same verified acceptance facts. A tutorial cannot claim a downstream stage until that stage has been performed in the current Nomi build and captured.

## Feishu-first document architecture

飞书不是把现有网页再复制一份，而是教程的主阅读形态。目标结构参考真实的飞书手册：一个总文档作为入口，正文连续阅读，素材紧贴相关段落出现，必要时通过子文档拆分章节。

```text
Nomi 教程与指南（总文档）
├── 先完成一次：文字 / 图片 / 视频
├── 按任务学习：画布、批量、拆镜、时间轴、导出、模型接入
├── 参考与排查：Prompt、参数、状态、额度、错误恢复
├── 版本更新与已知边界
└── 示例素材与真实验证记录
    ├── 中文版章节
    └── English chapters
```

总文档正文使用标题、说明段、提示框、步骤、截图、视频、结果对比、参数表和 FAQ 的自然混排。不要把每一步拆成网页卡片，也不要让用户在“营销页 → GitHub → 另一个页面”之间来回跳。官网只提供“进入完整手册”和精选入口；GitHub 保留可审查的同步源和开发者参考。

### Feishu delivery rules

1. 先建立总文档骨架，再按章节顺序写入；每个章节写完后重新读取并审查，不一次性灌入整本手册。
2. 图片和视频必须插在对应步骤或案例附近，并标注版本、录制时间、语言和验证状态；不把素材堆到文末。
3. 中英文不是两套互相漂移的文章：共享同一个章节 ID、证据文件和状态收据，表达自然但事实等价。
4. 变化频繁的价格、模型、界面标签和版本能力单独放在“更新 / 参考 / 排查”章节，不污染首次成功路径。
5. 每个章节保留“下一步”和“仍未验证”区块，明确哪些是当前可用路径，哪些需要等待产品闭环。

## Document UX contract

这套手册的主要用户不是来“浏览功能”的，而是带着一个任务来找答案。每个章节开头先给结果和适用场景，再进入操作；用户不需要读完整本，目录和章节内链接都能让他在当前位置继续完成任务。

### 页面结构

1. **标题区**：章节名称、更新时间、适用版本、中文 / English 入口。
2. **结果先行**：一句话说明看完会得到什么；如果当前路径有前置条件，紧跟一句明确说明。
3. **目录导航**：总文档只保留三层主目录；章节内部最多再分两级，避免目录变成按钮墙。
4. **正文叙事**：用连续段落解释为什么这样做；只有真正的步骤、材料清单、参数对照才使用列表或表格。
5. **动作与证据相邻**：一个动作后立即放“你应该看到什么”，下面紧跟真实截图或视频，不把证据集中到文末。
6. **状态标识**：用“已验证 / 有边界 / 未发布”表达事实状态，不用装饰性颜色制造完成错觉。
7. **下一步**：每章结尾只推荐一个最自然的后续动作，另列排查入口；不把用户送回一个泛化首页。

### 素材编排规则

- 截图用于解释“点哪里、结果出现在哪里”；必须带简短图注，标出版本和语言。
- 视频用于解释连续动作、等待状态和结果变化；控制在解决一个任务所需的最短长度，正文中直接可播放或预览。
- 参数表只在用户需要做选择时出现，列“什么时候选、代价是什么、当前是否验证”，不把所有模型字段都塞进首次教程。
- 代码、Prompt、命令和配置放在可复制区域，并说明它解决什么问题；不给用户只剩一段无法判断用途的代码。
- 关键提醒最多使用一个高亮块；普通说明用段落，避免整篇变成警告框。
- 左右分栏只用于短的、信息量对等的对照，例如“操作前 / 操作后”或“中文 / English”；长正文和视频不放在分栏里。

### 三类读者路径

| 读者 | 首屏要回答的问题 | 默认入口 |
| --- | --- | --- |
| 第一次使用 | 我能不能先成功一次？ | 第一层：第一次成功 |
| 已经会用 | 我现在这个任务怎么做？ | 第二层：按任务学习 |
| 遇到问题 | 为什么没成功，下一步怎么办？ | 第三层：参考与排查 |

这三个入口在同一个飞书总文档里保持可见，但正文不互相复制。官网只显示入口和精选章节，GitHub 只同步可审查文本与证据索引，App 通过上下文链接直达章节。

## Reader-agent comparison loop

每次扩充飞书总文档后，用同一组读者任务与参考手册复查，不以字数或组件数量判断质量。固定检查三类读者：第一次使用、带着具体任务查找、遇到失败状态排查。检查顺序是：首屏是否知道是什么和从哪里开始；是否能按文字/图片/视频直接选路径；动作后是否紧跟真实证据和成功信号；失败是否有下一步；中英文是否事实等价。对照收据保存在 `docs/tutorials/feishu-ux-review-2026-09-01.md`。只有体验问题被修正、内容边界仍诚实时，才进入下一轮；未验证能力不得用增加篇幅来伪装完成。

## Issue-trace loop

真实走查期间发现的任何产品问题、体验问题、外部阻塞、验证缺口或文档漏项，都必须进入 `docs/tutorials/issue-traces/index.json`，并保留原始证据。每条记录要能回答“怎么发现的”：使用什么构建、从什么状态开始、执行了哪些动作、预期是什么、实际是什么、截图/录屏/代码/测试在哪里、用户受什么影响、当前如何绕行、下一步如何复验。`partial` 和 `blocked` 条目没有轨迹就不允许通过完整性门禁；问题关闭必须重复原始轨迹并留下新的复验收据。问题记录不等于根因修复，真正修生产代码仍按项目 root-cause 流程执行。

## Revised complete target

本轮的完成定义不是“有一页教程”，而是下面这个验收矩阵全部有内容、证据和入口：

| 层级 | 文字 | 图片 | 视频 |
| --- | --- | --- | --- |
| 第一层：第一次成功 | 从文字意图进入可检查的镜头状态 | 生成并回到图片镜头卡 | 生成并回到视频镜头卡 |
| 第二层：任务型 | 故事/镜头文字进入可编辑生产路径 | 图片节点、参数、参考与时间轴任务 | 视频节点、抽帧/拆镜、时间轴任务 |
| 第三层：参考与排查 | Prompt、状态、额度、失败恢复 | 模型/比例/清晰度/结果回卡与持久化 | 视频模式、播放器、抽帧结果、导出与持久化 |

每个单元必须同时满足：

1. 当前版本真实应用中的起始状态、操作过程和成功状态已记录；
2. 若涉及生成，已明确模型、供应商、参数、额度确认和真实结果；
3. 关闭/刷新后状态仍能确认，或明确记录为未验证；
4. 中文和英文有语义等价稿件；
5. App、官网、GitHub 都能从正确上下文找到它，并指向同一状态收据；
6. 有失败/阻塞路径时，第三层给出下一步，而不是用教程掩盖产品问题。

### 推进顺序

先完成“文字意图 → 画布镜头”的真实可用性审计，再完成图片和视频生成/回卡，随后完成时间轴、预览、导出与媒体拆解，最后补批量、Agent、连接失败和持久化。每一阶段都先留证据，再写稿，再接三端；不允许先用旧截图占位。

**Tech Stack:** Nomi Electron desktop app, Computer Use via `mcp__node_repl__js`/Sky, Markdown, SVG annotation script, MP4/MOV screen capture, TypeScript handbook content, existing marketing HTML generator, existing Vitest/UX/static checks.

**Spec:** `docs/tutorials/README.md` and the real-task evidence collected in `docs/tutorials/assets/raw/`.

## Global Constraints

- Use the current installed Nomi build and real UI state; do not reconstruct a flow from old plans, screenshots, or intended product copy.
- Every generated image/video/audio action must be explicitly confirmed during the tutorial capture; record the model, provider, quality, aspect ratio, count, and quota boundary.
- Separate “generation succeeded” from “material entered the timeline” and “MP4 exported”; each is a different acceptance gate.
- Keep Chinese and English content semantically equivalent; do not translate an unverified claim into a stronger claim.
- Reuse Nomi’s existing design system and marketing visual language; do not add a generic tutorial dashboard or invent a parallel interaction pattern.
- For every tutorial, keep raw screenshots immutable, add annotations as an overlay, and retain the capture date/build target.
- Do not change App or website entry points until the complete tutorial contract and its evidence have been reviewed.
- Any corrective production-copy change must include a root-cause contract under `docs/fixes/` and a regression check for the shared content boundary.
- Do not claim timeline, preview, export, video, or batch behavior until a current-build real-task walkthrough captures those states.

---

## Task 1: Freeze the real-task evidence contract

**Files:**
- Create/complete: `docs/tutorials/README.md`
- Create/complete: `docs/tutorials/first-image-shot.zh-CN.md`
- Create/complete: `docs/tutorials/first-image-shot.en.md`
- Create: `docs/tutorials/assets/raw/` evidence files from the current app
- Create: `docs/tutorials/assets/annotated/` overlay files
- Create: `docs/tutorials/media/nomi-image-node-walkthrough.mp4`
- Create: `docs/tutorials/scripts/annotate-screens.mjs`

**Interfaces:**
- Consumes: current `/Applications/Nomi.app` UI state, the approved one-image generation canary, and the exact visible labels exposed by Computer Use.
- Produces: a reviewable “first image shot” tutorial whose final proof is `09-generation-result.png` and whose preparation proof is the screen recording.

- [x] Capture the real path `Project → Generate → Add image node → Prompt → Model → Generation parameters → Aspect ratio → Confirm Generate asset`.
- [x] Confirm one single-image `Gpt Image 2 · 16:9 · 1K` generation and capture its returned image on the shot card.
- [x] Keep the timeline state explicit: the captured result is a generated image, not a timeline clip or exported video.
- [x] Generate bilingual Markdown and deterministic SVG callouts from the raw captures.
- [x] Review every screenshot against the same-build UI and remove any label that is not visibly supported.
- [x] Add the result screenshot to both language guides and state the exact quota-consuming action.

## Task 2: Define the tutorial catalog before expanding coverage

**Files:**
- Create: `docs/tutorials/catalog.zh-CN.md`
- Create: `docs/tutorials/catalog.en.md`
- Create: `docs/tutorials/tutorial-contract.md`

**Interfaces:**
- Consumes: Task 1’s evidence contract and the current product surfaces in `Creation`, `Generate`, `Preview`, project library, model setup, timeline, and Agent/Skill UI.
- Produces: the ordered tutorial backlog and a reusable acceptance template for every future tutorial.

- [x] Write the shared tutorial contract with these required sections: user problem, starting state, smallest path, visible success state, quota/irreversible boundary, recovery path, evidence files, and unverified boundaries.
- [x] Order the first catalog by real user value, not feature inventory: first image shot, first video shot, reference/identity continuity, frame extraction or shot splitting, timeline placement, preview/export, model/API setup, Agent-assisted production, and batch generation.
- [x] For each catalog item, name the exact task outcome and the state that must be captured before it can be published.
- [x] Mark “not yet captured” items as unpublished rather than filling them with old screenshots or product promises.

## Task 3: Produce each tutorial from a real current-build walkthrough

**Files:**
- Create one bilingual pair per catalog item under `docs/tutorials/`
- Add raw captures under `docs/tutorials/assets/raw/<tutorial-id>/`
- Add annotations under `docs/tutorials/assets/annotated/<tutorial-id>/`
- Add recordings under `docs/tutorials/media/<tutorial-id>.mp4`
- Extend `docs/tutorials/scripts/annotate-screens.mjs` only through data-driven specs

**Interfaces:**
- Consumes: `tutorial-contract.md`, a clean current-build task state, and the product’s visible controls.
- Produces: one self-contained tutorial with reproducible steps and evidence-backed success criteria.

- [ ] Start each walkthrough from a known project and record the starting state before the first action.
- [ ] Refresh Computer Use app state before every action, use accessible element labels where available, and capture the resulting state after each meaningful transition.
- [ ] Confirm generation actions when the task requires them; log provider/model/quality/ratio/count and do not silently substitute a mock or pre-existing asset.
- [ ] Capture the first success state, the most likely failure state, and the recovery action when the UI exposes one.
- [ ] Record only the shortest useful mouse path; annotate screenshots with bilingual labels without covering the product evidence.
- [ ] Run a reviewer pass that asks “could a new user complete this without guessing?” and “does every success claim have a visible proof?”

Current-build evidence completed so far: text-node creation/editing, image generation, and video generation. The catalog keeps timeline export replay, frame extraction, batch, API, and Agent paths explicitly unpublished until their own walkthroughs exist.

## Task 4: Integrate the verified facts into the Nomi App onboarding

**Files:**
- Modify only after Task 1–3 review: `src/workbench/onboarding/handbookContent.ts`
- Modify only if needed: `src/i18n/locales/onboardingProviders.ts`
- Modify only if media is embedded inline: `src/workbench/onboarding/HandbookPanel.tsx`
- Create if production copy is corrected: `docs/fixes/2026-09-01-truthful-tutorial-boundary.root-cause.json`
- Test: existing onboarding/handbook tests plus a new focused content-boundary test if no existing test covers the claims

**Interfaces:**
- Consumes: published tutorial contract facts from Tasks 1–3.
- Produces: App onboarding that points users to the real first win and never describes an unverified downstream stage as complete.

- [x] Compare every existing onboarding claim against the current evidence before editing it; list each changed claim and its proof file.
- [x] Replace only claims contradicted by the real walkthrough; preserve unrelated product guidance until its own tutorial evidence exists.
- [x] Decide whether App should embed media inline or link to the public tutorial pack; use the existing HandbookPanel layout and tokens if inline media is justified.
- [x] Add the root-cause contract for any corrective copy change, including the shared content boundary and same-class entry points.
- [ ] Verify the App handbook in a real Electron walk-through, including Chinese and English locale rendering and the visible link/media behavior. Source build and content checks pass; installed app evidence is still the pre-change build.

## Task 5: Publish the same tutorial pack on the website

**Files:**
- Create: `marketing/tutorials.html`
- Create: `marketing/en/tutorials.html` or a bilingual route according to the existing marketing routing convention
- Copy approved media: `marketing/assets/tutorials/`
- Modify: `scripts/marketing/content.mjs`
- Modify: `scripts/marketing/template.mjs`
- Modify: `scripts/marketing/site-manifest.mjs`
- Regenerate: `marketing/index.html`, `marketing/en/index.html`, `marketing/sitemap.xml` when their generators require it
- Test: `tests/ux/tutorials-page.static.mjs` and the existing marketing static/visual checks

**Interfaces:**
- Consumes: published Markdown facts and approved annotated assets from Tasks 1–3.
- Produces: a public tutorial page reachable from the existing marketing start section and present in the generated sitemap.

- [x] Follow the existing marketing shell, typography, tokenized color language, responsive breakpoints, and external-link conventions.
- [x] Give the page one job per section: what the user will make, the real path, proof screenshots, the result boundary, and the next tutorial.
- [x] Use the generated result image as the dominant proof; do not turn the page into a dense gallery or generic feature grid.
- [x] Add restrained interaction only where it improves comprehension: language switch, step reveal, and native video controls; avoid ornamental motion.
- [x] Assert that both locales load, all local media references resolve, the result screenshot is present, and the sitemap includes the public route.
- [x] Open the built page in a browser and inspect desktop and narrow viewport screenshots before calling it complete.

## Task 6: Publish and cross-link the GitHub documentation

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/README.md`
- Modify: `docs/tutorials/README.md`
- Add links from the tutorial catalog to the matching guide and media evidence

**Interfaces:**
- Consumes: the stable public routes and file names produced by Tasks 1–5.
- Produces: a discoverable GitHub entry point that does not require the user to know the internal directory layout.

- [x] Add a bilingual tutorial link beside the existing quick-start and documentation links.
- [x] Keep README claims limited to published tutorial evidence; do not advertise future catalog items as available.
- [x] Add the tutorial pack to the docs map with the capture date and current-build evidence note.
- [x] Check all relative links from the repository root and from the tutorial directory.

## Task 7: End-to-end verification and delivery gate

**Files:**
- Modify: `docs/tutorials/README.md` with the final verification receipt
- Create: `docs/tutorials/verification-2026-09-01.md`

**Interfaces:**
- Consumes: App, website, and GitHub outputs from Tasks 1–6.
- Produces: a delivery receipt that distinguishes verified, simulated, and still-unverified behavior.

- [x] Re-run the real first-image task in the current Nomi build and confirm the result returns to the shot card.
- [x] Run the focused code/content checks: `pnpm run check:handbook`, `pnpm run check:site`, `pnpm run check:sitemap`, `pnpm run check:docs-index`, `pnpm run check:doc-status`, and `pnpm run check:root-cause-contracts` when a corrective contract exists.
- [x] Run `pnpm run typecheck` and the affected UX/static tests after App or website source changes.
- [x] Compare App and website screenshots against the evidence pack; inspect media dimensions, playback, links, and locale parity.
- [x] Record quota use and any remaining unverified stages; do not report a tutorial as complete if its real task failed.
- [ ] Refresh `origin/main`, create/retain a task branch, commit only the scoped files, push the branch, and open a PR without merging it.

## Open gates before final completion

这些不是永久搁置，而是必须按推进顺序完成的验收闸：

- [ ] 文字意图真实进入画布镜头，并在中文/英文界面各确认一次可理解的入口与结果。
- [ ] 图片路径完成生成、回卡、加入时间轴、预览、导出和刷新持久化证据。当前已完成前五项与节点重开可见，MP4 文件回放仍待验收。
- [ ] 视频路径完成生成、回卡、播放器、加入时间轴、预览、导出和刷新持久化证据。当前已完成前四项与项目重开节点可见，MP4 文件回放仍待验收。
- [ ] 抽首帧、抽尾帧、按镜头拆完成“预览/选择/落节点/重开仍在”的证据。当前已完成首/尾帧和一镜到底均匀抽帧，真正多切点选择仍待验收。
- [ ] 批量生成、模型/API 接入、连接失败、Agent 推进分别有真实成功或明确失败恢复路径。
- [ ] 三层每一格都有中英文稿件、截图/录屏引用、状态收据，并在 App、官网和 GitHub 可达。

旧截图、旧产品 brief 或不同安装包只能作为待核对线索，不能作为任何一格的完成证据。
