# 创作页分镜

创作工作区里的分镜编辑器：上面「跨镜头要一致的」参考卡区，下面一行一镜（缩略格 + 提示词 + 和画布同一只底栏「模型｜方式｜参数｜高级设置」+ 生成）。

## Sub-features

- 方案头：方案标题、镜数、「放入画布」。
- 参考卡区「跨镜头要一致的」：加参考卡、全部展开。
- 镜头行：拖动排序、勾选、镜头操作（⋯）、`@` 选参考、提示词、模型下拉（新镜是「默认模型」）、选了模型后出方式、参数两格（各占一格）、生成。
- 底栏：添加镜头、返回原稿、已生成 x / n、生成剩余；列头「顺播」「整片画幅」。

## How to get to it (user POV)

项目里点顶栏「创作」→ 左栏「文稿」→ 点方案行（新建的空白项目自带一份 2 镜的空方案）。

## Driving it with ui.mjs

```bash
node tests/ux/ui.mjs goto storyboard             # 没项目就新建；开左栏文稿、点第一份方案
node tests/ux/ui.mjs snap                        # 每镜的控件 aria 带镜号：「镜 1 提示词」「生成镜 1」「选中镜 1」
node tests/ux/ui.mjs click 'aria:模型'            # 第一镜的模型下拉（同名的取页面上第一个；英文 aria:Model）
node tests/ux/ui.mjs click 'aria:生成方式'        # 第一镜的方式那一格（英文 aria:Mode），菜单里点 role:option=改图 / role:option=文生图
node tests/ux/ui.mjs shot storyboard
```

## Gotchas

- 新镜的模型是「默认模型」，这时行上没有方式 / 参数下拉；先选一个具体模型才出来。
- 每镜的模型 / 方式钮 aria 都同名，`click 'aria:…'` 只点第一镜；点别的镜按 `snap` 给的坐标 `xy:<x>,<y>` 点。
- 700×720 下 Agent 面板默认收成小球（宽度让给分镜）。
- 分镜编辑器的唯一入口是 `tests/ux/_creationResourceTree.mjs` 的 `openStoryboardEditor`（有静态守卫），别另写「点方案行」。
- 图片镜的方式是底栏单独一格（带字，`aria:生成方式` / 英文 `aria:Mode`），菜单两项「文生图 / 改图」，按 `role:option=改图` 点（英文 `role:option=Edit image`）；别用 `text:改图`——模糊匹配会先撞上模型菜单里藏着的说明「文生图/改图 · 最高 4K」。点一项菜单自己收起，不用 `press Escape`。
- 改图缺参考图时，缩略格变红框「缺输入图参考」（英文 Missing Input image），底栏多一句「1 缺参考（不进批量）」（英文「1 missing required refs (excluded from batch)」）；读这句判有没有红框，比认颜色稳：
  `node tests/ux/ui.mjs read "[...document.querySelectorAll('*')].map(e=>e.childElementCount===0?e.textContent:'').find(t=>/缺参考|missing.*refs/.test(t||''))||'none'"`
- 从模型菜单挑模型会顺带勾上这一镜（底栏出「已选 1 镜」），截图前留意。
- 读回落盘：`goto library` 后点那张卡的「继续创作」（悬停才出，按 `snap` 坐标 `xy:` 点），再 `goto storyboard`。直接在项目库 `goto storyboard` 会**新建**一个空白项目，读到的是新项目。
- 不要点「生成」/「生成剩余」：隔离实例没钥匙，验证不花钱。
