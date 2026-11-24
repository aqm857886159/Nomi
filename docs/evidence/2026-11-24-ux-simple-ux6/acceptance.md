结论：通过 · 验收线：ux6-verify · 验收 HEAD：0c5704f4c8e28edb57796edf31856582675660ef

- 验收线：ux6-verify
- 实现线：fix/ux-simple-creation-library-and-context-ring
- 验收 HEAD：0c5704f4c8e28edb57796edf31856582675660ef
- 对应设计卡：`docs/plan/2026-11-24-ux-simple-ux6.md`
- 方向复盘：`docs/plan/2026-11-24-ux-simple-ux6-direction-check.md`
- 根因合同：`docs/fixes/2026-11-24-ux-simple-ux6.root-cause.json`
- 验收结论：通过（无阻塞缺陷）

## 1. 范围、设计与隐私核查

对照 `origin/main...5c500d5d4e253ade7c60056bf6ba5e65c164e204` 全部改动（`4e8ed701b`、`4d01a6eeb`、`5c500d5d4`）：

- **创作占位词、工具栏低频折叠与全文「拆成分镜 / To shots」**：`WorkbenchEditor.tsx` 与 `editorToolbarMenuItem.ts` 将行内代码、分隔线、插入表格统一折入 `⋯` 菜单（与 `NomiOverflowRow` 窄窗溢出项共用同一菜单，保留格式切换选中态），行尾固定保留撤销、重做与全文「拆成分镜 / To shots」（空文稿禁用，有正文即使只选末段仍交出全文）；空文稿占位提示与按钮名称中英一致。
- **选区动作浮条命名去重**：`SelectionGeneratePopover.tsx` 按 P1 删除 4 颗重复格式按钮，仅保留 4 个带明确动作名的分组按钮（中文「AI 编辑 / 拆成镜头 | 生成图片 / 生成视频」，英文 `AI edit / To shots | Image / Video`），格式命令只由唯一 owner 发出。
- **空会话 0 用量隐藏**：`AgentPanelV4Context.tsx#V4ContextRing` 在 `!expanded && !usage.used && !hasBreakdown && !hasCost` 时返回 `null`，冷启动空会话头部无冗余 `—` / 0 占位；有真实用量、分项、费用或显式展开时照常渲染。
- **项目库标题单击直进 + 铅笔独立改名**：`ProjectLibraryPage.tsx` 单击项目标题一次进入项目，卡片悬停/聚焦露出独立铅笔改名钮（支持鼠标与键盘 Enter 进入、Escape 取消且不误开项目，不可用项目隐藏改名动作）。
- **隐私与干净度核查**：`origin/main..HEAD` 全部提交信息及非 PNG 新增 diff 行扫描本机绝对路径、临时目录路径与私有工作树前缀均 **0 命中**。

## 2. 视觉证据逐张核验（亲眼 Read 全部 9 张核心真窗截图）

已通过 `read_file` 亲眼核对 `docs/evidence/2026-11-24-ux-simple-ux6/` 下的中英双轨 × 亮暗双模 × `1100×690` 窄窗真隔离 Electron 截图：

- `zh-light-empty.png`：空文稿占位词明确指引选段与右上「拆成分镜」，右上「拆成分镜」呈禁用态，右侧 Nomi 面板头部无空会话 `—` 用量圈。
- `zh-light-toolbar.png` & `en-dark-toolbar.png`：`⋯` 菜单清晰收纳低频格式项（`行内代码 / 分隔线 / 插入表格`、`Inline code / Horizontal rule / Insert table`），右端 `↶ ↷` 与「拆成分镜 / To shots」完整对齐无截断。
- `zh-light-selection.png` & `en-dark-selection.png`：选区浮条仅含 4 个命名动作按钮（`AI 编辑 / 拆成镜头 | 生成图片 / 生成视频`、`AI edit / To shots | Image / Video`），无任何重复格式按钮，文字与边框间距清晰无溢出。
- `zh-light-library.png` & `en-dark-library.png`：项目卡悬停呈现 `继续创作 / Continue creating`、清晰项目标题 `末班渡船 / The Last Ferry` 与右侧独立铅笔改名按钮。
- `zh-light-narrow-toolbar.png` & `zh-light-narrow-selection.png`（`1100×690` 窄窗）：窄窗溢出格式项与低频项合入同一 `⋯` 菜单，行尾撤销、重做与「拆成分镜」完整可见无横向溢出；选区 4 动作浮条完整可读无裁切。

## 3. 定向 Vitest、治理门岗与类型检查独立复跑（全部 `EXIT=0`）

严格按资源纪律在隔离验收工作树独立串行复跑（未跑全量 `gates` / 全仓 `vitest`）：

- 6 套定向 Vitest（`VITEST_MAX_WORKERS=2`：`WorkbenchEditorToolbar.structure.test.ts`、`selectionActions.test.ts`、`richTextActions.structure.test.ts`、`agentPanelV4ContextRing.test.tsx`、`agentSlashMenu.test.tsx`、`ProjectLibraryPage.folderMissing.test.tsx`）：**6/6 文件，51/51 passed**；
- `CONCEPT_OWNERS_BASE_REF=origin/main node ./scripts/check-concept-owners.mjs`：**PASS**（410 概念：converged 406 / pending 4 · 第二写口 0 新增）；
- `node ./scripts/check-root-cause-contracts.mjs`：**PASS**；
- `pnpm run check:self-written`：**PASS**（20/20 自测，177 领域目录 · 68 项登记 · 新增代码文件 2 个 · 0 未认领）；
- `pnpm run check:filesize`：**PASS**（0 新增红牌）；
- `pnpm run check:board-parity`：**PASS**（111/111 自测，12 张主板 + 43 张历史板全通过）；
- `pnpm run check:controls`：**PASS**（0 违规）；
- `NOMI_BASE_REF=origin/main node ./scripts/lint-changed.mjs`：**PASS**（21 个改动文件，0 错误，0 新增警告）；
- `./node_modules/.bin/tsc -p tsconfig.app.json --noEmit`：**PASS**（0 错误）。

## 4. ★9 真实故障变异验证（2/2 必红 → 还原 19/19 必绿）

| 编号 | 故障注入方式 | 变异实测（必红） | 还原验证 |
|---|---|---|---|
| M1（空会话 0 用量隐藏失效） | 在 `src/workbench/ai/v4/AgentPanelV4Context.tsx:53` 移除空会话隐藏判据 `if (!expanded && !usage.used && !hasBreakdown && !hasCost) return null` | `agentPanelV4ContextRing.test.tsx` 退出码 `1`（**4/13 失败**：4 组空会话/零计数用例均泄漏渲染 `<details data-v4-block="context">`） | `git checkout --` 后复绿 |
| M2（选区浮条恢复重复格式动作） | 在 `src/workbench/creation/SelectionGeneratePopover.tsx` 临时混入 `editor?.chain().focus().toggleBold().run()` | `richTextActions.structure.test.ts` 退出码 `1`（`格式命令只在 owner 里发` 精确捕获 `SelectionGeneratePopover.tsx`） | `git checkout --` 后两套复跑 **19/19 必绿（`EXIT=0`）** |

## 5. 设计卡 ★0 出处补齐增量复签（`0c5704f4c8e28edb57796edf31856582675660ef`）

- **增量审阅**：`0c5704f4c` 仅在 `docs/plan/2026-11-24-ux-simple-ux6.md` ★0 补齐 4 行出处行号（`:1`）与三段式 `出口：`，生产与测试代码 `0` 改动，`0` 本机路径泄露。
