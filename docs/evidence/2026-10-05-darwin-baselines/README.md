# Mac darwin design-lab baseline audit (2026-10-05)

环境：macOS arm64，分支 `chore/darwin-baselines`，基线平台 `darwin`，视口 1440×1000 @1x，基线起点 `origin/main` / `aacb7f626`。

## 23 屏首次结果

`pnpm run check:design-lab` 完成结构检查（23 屏、337 状态、299 基线）和视觉道（159 passed、34 pixel-diff；退出码 1）。34 个像素差全部保留为报告，未更新基线；日志见 [`logs/check-design-lab.log`](logs/check-design-lab.log)。括号为该屏 diff 状态数；像素数取 Playwright 输出中可用的代表值，视觉 diff 图由门岗生成后被后续定向运行清理，不能把当前目录当作 diff 图收据。

| 屏 | 结果 |
|---|---|
| find-reference | 通过 |
| creation-columns | 通过 |
| shot-table | 通过 |
| process-feedback | 像素差 14（代表 973 / 290 / 241 / 650，约 0.01） |
| settings-sound | 像素差 3（508/屏，约 0.01） |
| catalog-liveness | 通过 |
| agent-panel-v4 | pending，跳过视觉比对 |
| editing | 通过 |
| storyboard | 像素差 8（可见 3252、3568、3978，约 0.01–0.04） |
| host-config | 通过 |
| canvas-add-menu | 通过 |
| canvas-frame | 像素差 1（436，约 0.01） |
| node-composer-bar | pending，跳过视觉比对 |
| node-quick-actions | **额外 pending 漂移**，任务卡未列；跳过视觉比对 |
| settings | 像素差 4（10481–11278，约 0.05） |
| primitives-actions | 通过 |
| primitives-forms | 通过 |
| primitives-menu | pending，跳过视觉比对 |
| primitives-surfaces | 通过 |
| depth-action | 像素差 2（1659/1579，约 0.01） |
| vendor-order | 通过 |
| director-3dbox | 像素差 2（17583/18043，约 0.02） |
| director-refine | **pending；本轮更新阻塞，见下** |

34 个 pixel-diff 状态集中在 `process-feedback` 14、`settings-sound` 3、`storyboard` 8、`canvas-frame` 1、`settings` 4、`depth-action` 2、`director-3dbox` 2；全部只报告。

## 接触表

以下是当前登记中除 `director-refine` 外的三屏，中英文各一张。它们只是给用户拍板的接触表，没有录入视觉基线：

- [`node-composer-bar-zh.png`](contact-sheets/node-composer-bar-zh.png) / [`node-composer-bar-en.png`](contact-sheets/node-composer-bar-en.png)
- [`primitives-menu-zh.png`](contact-sheets/primitives-menu-zh.png) / [`primitives-menu-en.png`](contact-sheets/primitives-menu-en.png)
- [`agent-panel-v4-zh.png`](contact-sheets/agent-panel-v4-zh.png) / [`agent-panel-v4-en.png`](contact-sheets/agent-panel-v4-en.png)

生成命令（双语通过临时浏览器 localStorage 语言注入，仅生成证据，运行后已恢复源码）：

```text
DESIGN_LAB_LOCALE=zh-CN node tests/ux/design-lab-node-composer-bar.walk.mjs
DESIGN_LAB_LOCALE=en node tests/ux/design-lab-node-composer-bar.walk.mjs
DESIGN_LAB_LOCALE=zh-CN node tests/ux/design-lab-primitives-menu.walk.mjs
DESIGN_LAB_LOCALE=en node tests/ux/design-lab-primitives-menu.walk.mjs
DESIGN_LAB_LOCALE=zh-CN node tests/ux/design-lab-agent-panel-v4.walk.mjs
DESIGN_LAB_LOCALE=en node tests/ux/design-lab-agent-panel-v4.walk.mjs
```

`node-composer-bar` 走查自身报告 5 条「现役 composer 卡应有 1 张，实际 0」；这不改变接触表，也没有修改断言或产品代码。`primitives-menu` 4/4 通过，`agent-panel-v4` 112/112 通过。

## director-refine 阻塞

任务卡要求 Mac 上只更新 `director-refine` 后删除登记。按最小范围定向更新（没有按屏参数，使用 Playwright `--grep`，避免全量更新）时 27/28 状态可渲染；`d3a-clip-zh` 连续复现失败，故没有写入任何 director-refine 基线，也没有改 `calibration.json`。

原始复现命令：

```text
NOMI_DESIGN_LAB_UPDATE=1 npx playwright test -c tests/ux/design-lab/playwright.config.mjs --grep 'director-refine.*d3a-clip-zh'
```

将 ready 等待临时放宽到 30 秒后，原始页面错误为：

```text
Error: director3dbox lab: 等不到 [data-nomi-escape-layer="director-popover"] button 里的「黑衣侍卫」
```

真实截图显示「+ 添加轨道」菜单只有 `ground / wall_enclosure / wall east / gate / courtyard tree` 等场景件，角色「黑衣侍卫」不在候选；因此不能伪造该状态的基线。原始失败截图见 [`director-refine-d3a-clip-zh-actual.png`](director-refine-d3a-clip-zh-actual.png)，完整日志见 [`logs/director-refine-clip-timeout30.log`](logs/director-refine-clip-timeout30.log)。

## 登记漂移

`calibration.json` 当前 `pendingApprovalScreens` 完整列表为：

- `director-refine`
- `node-composer-bar`
- `node-quick-actions`（任务卡未列出的额外登记；其登记说明称用户已看过接触表但仍待 darwin 基线）
- `primitives-menu`
- `agent-panel-v4`

因此本分支保持登记原样，状态是「已实现未推送」且 director-refine 仍阻塞，不能声称 `check:design-lab` 全绿。
