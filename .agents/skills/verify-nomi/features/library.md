# 项目库

打开 Nomi 的第一屏：新建 / 打开项目，另有 Skill、提示词两个页签。

## Sub-features

- 空库：三张动作卡（新建空白项目 / 打开已有文件夹 / 重看一遍引导）+「创作助手尚未连接模型」提示条。
- 有项目时：项目卡网格、「全部 / 本地 / 文件夹」筛选、搜索、右上「新建项目」。
- 页签：项目 / Skill / 提示词。

## How to get to it (user POV)

启动就在这里；在项目里时点顶栏项目名 → 菜单里「回项目库」。

## Driving it with ui.mjs

```bash
node tests/ux/ui.mjs goto library                          # 在项目里会先回项目库；设置弹窗开着会先关
node tests/ux/ui.mjs up --data v0.24.0-library             # 带 3 个老项目起（老用户升级场景）
node tests/ux/ui.mjs shot lib
node tests/ux/ui.mjs snap
```

结果看 `doctor` 的 `where: library`，以及截图里的卡片。

## Gotchas

- 空库和有项目时「新建」入口长得不一样（动作卡 vs 右上按钮），出口 `newProjectEntry` 两种都认，自己别按文案猜。
- 英文 + 700×720 下，模型提示条第一行文字顶出了条的上沿（2026-11-15 截图所见，没修）。
- `--data` 只认登记过的夹具名；任意路径会被拒（不碰真实资料）。
