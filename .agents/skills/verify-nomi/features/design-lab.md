# 设计实验室

`design-lab.html`：用生产组件 + 假数据把一屏的各个状态摆出来，不起应用、不连后端。拍板样张和视觉对账用它。

## Sub-features

- 屏：storyboard、node-composer-bar、agent-panel-v4、settings、canvas-add-menu 等（全表：`goto design-lab` 给一个不存在的屏名，报错里列全）。
- 每屏若干状态 id（例：storyboard 的 `sb-row-05-missing-required`）。

## How to get to it (user POV)

不是用户界面；开发时本机起 vite 打开 `design-lab.html?screen=<屏>&state=<状态>`。

## Driving it with ui.mjs

```bash
node tests/ux/ui.mjs goto design-lab storyboard                              # 整屏
node tests/ux/ui.mjs goto design-lab storyboard sb-row-05-missing-required   # 某个状态
node tests/ux/ui.mjs snap                                                    # 之后的命令落在实验室页上
node tests/ux/ui.mjs goto canvas                                             # 任何应用里的 goto 切回 Nomi 窗口
```

## Gotchas

- 第一次 `goto design-lab` 要起 vite 并冷编译，实测约 9 秒；之后换屏很快。实验室页在无头浏览器里，尺寸和主题跟 `up` 时要的一样。
- 实验室是假数据：它证明「长相」，不证明「真数据下会这样」；行为要回应用里验。
- `down` 会一起关掉实验室服务器。
