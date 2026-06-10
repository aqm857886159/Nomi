# 完整用户测试方法 + 自动化 UI 工具调研（定稿 2026-06-10）

> 以后做「特别完整的用户测试」就按本文方法。结论先行：**用现有 Playwright `_electron` 常驻驱动 + AI 作 computer-use 智能体**，不引入外部工具。

---

## 一、方法：AI 作 computer-use 智能体（感知→决策→行动→再感知）

「点遍每个按钮、看遍每页」的自主测试，不需要外部工具——**那个自主点击的智能体就是 AI 本身**，驱动层用项目已有的 `tests/ux/ui-driver.mjs`。

### 标准动作（每次完整用户测试照做）
1. **清场**：`osascript -e 'quit app "Nomi"'` 关掉已安装的 Nomi.app（否则抢 single-instance 锁），杀残留 Electron/驱动进程。
2. **全新构建**：`pnpm build`（防 stale-chunk 伪 bug，见 [[r13-walkthrough-gotchas]]）。
3. **起常驻驱动**：`node tests/ux/ui-driver.mjs`（Bash `run_in_background:true`），等 `/tmp/nomi-ui/ready`。
4. **逐旅程走 J1–J5**（真实创作目标，不是功能探索）：每步 `ui.mjs snap`（看可点元素）→ 判断 → `click/fill/setfile` → `shot` + Read 截图人眼判断。
5. **交互态收尾**：逐个打开弹层/下拉/面板，看遮挡/溢出（R13 §交互态要求）。
6. **挖根因**：发现问题用 Explore agent 定位 file:line，分「症状/根因/地基」。
7. **落档**：`docs/audit/<date>-*.md`，问题分级 + 局部/地基拆分。
8. **收**：`ui.mjs quit`，别留后台窗口。

### 能覆盖 / 覆盖不到
- ✅ 渲染层交互 + 感知判断（~90%）、上传（`setfile` 绕过系统对话框）、跨项目状态、几何实测。
- ⚠️ 真实生成要额度（vendor HTTP 在主进程发，渲染层抓不到——要埋点见 `docs/workflow/2026-06-06-real-generation-e2e-loop.md`）；原生 OS 对话框需 `electronApp.evaluate` stub `dialog.*`。

---

## 二、外部自动化 UI 测试工具调研（2026）

| 类型 | 代表 | 谁写测试 | Electron 适配 |
|---|---|---|---|
| AI-native 自主探索 | Magnitude / Skyvern / Autonoma | LLM agent 读意图自动起草+执行+自愈 | 偏 Web |
| AI-assisted 脚本 | **Midscene.js** / Stagehand / Shortest / ZeroStep | 自然语言步骤，运行时编译动作 | **Midscene 支持 Desktop + CDP** |
| 跨端商用 | Autify Aximo / Test.ai / mabl | 视觉识别自主跑 | 覆盖桌面 |
| 开源探索器 | Explorbot | 自主爬 Web | Web |

### 为什么暂不接外部工具
- **Midscene.js** 是最强候选（MIT、视觉驱动、可视回放、`--cdp` 连 Electron 远程调试端口、有 Claude Code skill `npx skills add web-infra-dev/midscene-skills`）。
- 但它要 vision-model 的 API key/额度（属「需用户独有资源」的决策），且对 Electron 仍是视觉/CDP 旁路，不比现有 DOM 感知驱动更准。
- 现有 `ui-driver.mjs` 已是 Electron 正确工具：DOM 感知、免费、零额度、主进程+IPC 全在。
- **结论**：常规走查续用现驱动；若将来要「无人值守批量爬遍每个按钮」再评估接 Midscene（需用户拍板额度）。

来源：[QA.tech 13 Best AI Testing Tools 2026](https://qa.tech/blog/the-13-best-ai-testing-tools-in-2026)、[Midscene 官网](https://midscenejs.com/) / [GitHub](https://github.com/web-infra-dev/midscene) / [Skills](https://midscenejs.com/skills)、[testriq 桌面工具](https://www.testriq.com/blog/post/top-10-ai-powered-desktop-application-testing-tools-in-2026-boost-efficiency-and-catch-bugs)、[Autonoma 开源工具](https://getautonoma.com/blog/open-source-ai-test-generation-tools-2026)。
