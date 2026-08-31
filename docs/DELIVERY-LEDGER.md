# 交付账本 — 已拍板但没交付的，都在这

> 🚧 长期维护 · **本文件由 `scripts/build-delivery-ledger.mjs` 生成，禁止手改。**
> 改状态请改各方案文档开头的状态标记，再跑 `pnpm run gen:ledger`；`check:ledger` 在 gates 链里拦漂移。

**登记制**：只有文件开头带状态标记的方案才进现役区。没标记 = 未登记 = 不打扰你。
要把一篇旧方案拉进来盯，就给它开头加一行状态；确认不做就标 `⛔` 并写明被谁取代；
远期但不砍的标 `🧊`——它会被列出来，但不会每天催你。

---

## 现役欠账（11）

| 状态 | 文档 | 标题 |
|---|---|---|
| 📋 方案待拍板 | [2026-08-13-video-deconstruction-storyboard-table.md](plan/2026-08-13-video-deconstruction-storyboard-table.md) | 视频拆解 → 分镜表 → 复刻生成（方案已拍板，待实施） |
| 🚧 进行中 | [2026-08-28-conversational-model-integration-verification.md](plan/2026-08-28-conversational-model-integration-verification.md) | 对话式模型接入与认证闭环验收记录 |
| 🚧 进行中 | [2026-08-28-editing-engine-uplift.md](plan/2026-08-28-editing-engine-uplift.md) | Nomi Editing Engine Uplift |
| 🚧 进行中 | [2026-08-29-root-cause-contract-v2.md](plan/2026-08-29-root-cause-contract-v2.md) | 根因合同 v2 与规则收敛 |
| 🚧 进行中 | [2026-08-30-issue-237-onboarding.md](plan/2026-08-30-issue-237-onboarding.md) | Issue #237: 接入请求与英文上手入口 |
| 🚧 进行中 | [2026-08-30-library-discovery-optimization.md](plan/2026-08-30-library-discovery-optimization.md) | Nomi 资源库发现与检索统一方案 |
| 🚧 进行中 | [2026-08-30-unified-model-integration-certification.md](plan/2026-08-30-unified-model-integration-certification.md) | Unified Provider And Model Integration Certification |
| 🚧 进行中 | [2026-08-31-library-discovery-slice.md](plan/2026-08-31-library-discovery-slice.md) | Nomi 资源库发现优化方案与交付 |
| 🚧 进行中 | [2026-08-27-release-media-pack-skill.md](superpowers/plans/2026-08-27-release-media-pack-skill.md) | Nomi Release Media Pack Skill Implementation Plan |
| 🚧 进行中 | [2026-08-28-conversational-model-integration.md](superpowers/plans/2026-08-28-conversational-model-integration.md) | Conversational Model Integration Implementation Plan |
| 🚧 进行中 | [2026-08-30-canvas-workflow-plugin.md](superpowers/plans/2026-08-30-canvas-workflow-plugin.md) | Nomi 固定流程与原生画布插件计划 |

## 远期 / 暂缓（6）

| 状态 | 文档 | 标题 |
|---|---|---|
| 🧊 暂缓/远期 | [2026-08-09-canvas-ux-feedback-round.md](plan/2026-08-09-canvas-ux-feedback-round.md) | 画布体验反馈第 1 轮迭代计划 |
| 🧊 暂缓/远期 | [2026-08-14-community-qr-refresh.md](plan/2026-08-14-community-qr-refresh.md) | 2026-08-14 用户群二维码刷新 |
| 🧊 暂缓/远期 | [2026-08-26-hyperframes-canvas-motion-node.md](plan/2026-08-26-hyperframes-canvas-motion-node.md) | HyperFrames 画布节点集成方案研究 |
| 🧊 暂缓/远期 | [2026-08-14-clip-node-infinite-timeline.md](superpowers/plans/2026-08-14-clip-node-infinite-timeline.md) | 剪辑节点无限时间轴样章 Implementation Plan |
| 🧊 暂缓/远期 | [2026-08-20-storyboard-execution-contract-v2.md](superpowers/plans/2026-08-20-storyboard-execution-contract-v2.md) | Storyboard Execution Contract v2 Implementation Plan |
| 🧊 暂缓/远期 | [2026-08-21-agent-editor-workbench.md](superpowers/plans/2026-08-21-agent-editor-workbench.md) | Agent Editor Workbench Implementation Plan |

## 其余

- **已结案**：32 篇（✅ 已交付 / ⛔ 已废弃 / 📎 交接日志）
- **未登记存量**：423 篇。这些是历史文件，**有意不进现役区**——其中很多离得很远、或已经不需要做。
  想分诊就挑一篇加状态标记；不分诊也不会有人催。`check:doc-status` 只拦**新增**文档缺标记，不逼你清存量。

<details>
<summary>按月份看这 423 篇存量（点开，便于分批分诊）</summary>

| 月份 | 篇数 |
|---|---:|
| 无日期 | 14 |
| 2026-08 | 186 |
| 2026-07 | 51 |
| 2026-06 | 161 |
| 2026-05 | 11 |

</details>

- 合计扫描：472 篇方案文档（docs/plan/ 与 docs/superpowers/plans/，不含 INDEX.md）

---

## 怎么让它每天顶到眼前

账本躺着没人看就等于没有——`docs/plan/INDEX.md` 的状态列就是前车之鉴：数据一直都在，
37 篇停滞 60 天+ 照样发生。**salience 才是关键。**

本仓已有验证过的机制：L0 hook（`.claude/hooks/self-check.sh`，每条消息自动注入）。
把下面一行加进去，每轮开头就会看到欠账：

```sh
# 交付账本提醒（现役欠账 + 最久停滞）。失败不阻塞，静默跳过。
node "$CLAUDE_PROJECT_DIR/scripts/build-delivery-ledger.mjs" --brief 2>/dev/null || true
```

> `.claude/` 被 gitignore，hook 不随 git 走——换机 / 新 worktree 需手动补。
> 不想动 hook 就手跑：`pnpm run ledger:brief`。
