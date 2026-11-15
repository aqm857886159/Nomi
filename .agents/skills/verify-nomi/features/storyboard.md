# 创作页分镜

创作工作区里的分镜编辑器：上面「跨镜头要一致的」参考卡区，下面一行一镜（缩略格 + 提示词 + 模型 / 方式 / 参数 + 生成）。

## Sub-features

- 方案头：方案标题、镜数、「放入画布」。
- 参考卡区「跨镜头要一致的」：加参考卡、全部展开。
- 镜头行：拖动排序、勾选、镜头操作（⋯）、`@` 选参考、提示词、模型下拉（新镜是「默认模型」）、选了模型后出方式 / 参数、生成。
- 底栏：添加镜头、返回原稿、已生成 x / n、生成剩余；列头「顺播」「整片画幅」。

## How to get to it (user POV)

项目里点顶栏「创作」→ 左栏「文稿」→ 点方案行（新建的空白项目自带一份 2 镜的空方案）。

## Driving it with ui.mjs

```bash
node tests/ux/ui.mjs goto storyboard             # 没项目就新建；开左栏文稿、点第一份方案
node tests/ux/ui.mjs snap                        # 每镜的控件 aria 带镜号：「镜 1 提示词」「生成镜 1」「选中镜 1」
node tests/ux/ui.mjs click 'aria:模型'            # 第一镜的模型下拉（同名的取页面上第一个）
node tests/ux/ui.mjs shot storyboard
```

## Gotchas

- 新镜的模型是「默认模型」，这时行上没有方式 / 参数下拉；先选一个具体模型才出来。
- 每镜的模型钮 aria 都叫「模型」，`click 'aria:模型'` 只点第一镜；点别的镜按 `snap` 给的坐标 `xy:<x>,<y>` 点。
- 700×720 下 Agent 面板默认收成小球（宽度让给分镜）。
- 分镜编辑器的唯一入口是 `tests/ux/_creationResourceTree.mjs` 的 `openStoryboardEditor`（有静态守卫），别另写「点方案行」。
- 不要点「生成」/「生成剩余」：隔离实例没钥匙，验证不花钱。
