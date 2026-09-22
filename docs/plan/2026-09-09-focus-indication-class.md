# 文本编辑与操作控件的焦点指示分层

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已实现并验证，待 PR 评审。用户已明确指定交互：文本框鼠标/键盘一致使用细边框；按钮等非文本控件保留键盘环。

## 原因与范围

输入光标本身就提示编辑位置，给 textarea 再画外扩厚环会把注意力从内容拉走。先用真实 Electron 计算样式区分 UA outline 与应用 token outline，再替换 tailwind.config.ts addBase 的旧统一环规则。
覆盖 input 的文本/数字类型、textarea、contenteditable；非文本 input、button、链接、select、summary、tabindex 自定义控件继续得到键盘指示。组合输入的边框归容器所有，不能给无边框内层再造矩形。
不碰 electron/agentLane/** 或 src/workbench/ai/lane/**；不加依赖；不复制 #662 的扫描器。滚动条/表单 appearance 先实扫并用反例夹具描述边界，不能把 appearance:auto 一概当作视觉 bug。

## 先查别人

- 现役共享边界：tailwind.config.ts:401，设计系统焦点环章节；SearchInput 已有容器 focus-within，而 composer 内层 textarea 没有 border。
- #662（仍 OPEN）：已用 git show 读取远端 tests/ux/_feel.mjs；scanFeel(root,{rules,label}) 返回 findings 或抛带 findings 的 Error。此 PR 只交规则提案、夹具和本修复的定向回归，不复制它。
- Apple HIG：https://developer.apple.com/design/human-interface-guidelines/text-fields —— 核对原文，强调合理 Tab 顺序；不能声称它禁止文本框外环。
- Material：https://m3.material.io/components/text-fields/guidelines ，官方实现 https://github.com/material-components/material-web/blob/main/tokens/_md-comp-outlined-text-field.scss ：字段容器 focus-outline-color/width 是语义 token。
- GOV.UK：https://design-system.service.gov.uk/components/text-input/ ：优先焦点易辨，其黑边/黄外环是不同取舍；不是“所有主流系统都无外环”的佐证。

结论：区分文本容器与键盘操作控件是合理设计；三家没有统一禁止文本框外环的共识。本次按 Nomi 密度与用户指定的视觉约束选细边框，并保持可辨认焦点。

## 验收与回滚

先红：真实 composer 鼠标点击 outline>0；无焦点指示的键盘按钮反例也必须红。修后文本控件鼠标/Tab outline 为 none，边框 token 指示可见；按钮 Tab 有 token 环、鼠标无环，浅/暗主题与 disabled/readOnly/错误态保持正确。
真实走查：画布 composer、设置输入、项目库搜索、分镜单元格截图；实读计算样式并保存覆盖数量。共享 CSS 夹具从真实 Tailwind 编译产物加载，覆盖新增/未来调用者，不模拟生产 CSS。
pnpm run gates 全绿后走提交/推送 hook，开 PR，不合并。回滚为 revert 本 PR，恢复唯一原规则，无旧新并存实现。

## 实测判定（修前）

隔离 Electron 43.4.1 的真实画布 composer 鼠标点击：outline-style=solid，width=2px，color=`color(srgb 0.163175 0.457844 0.728752 / 0.42)`，与 --nomi-focus 完全相同；-webkit-focus-ring-color=`rgb(0, 0, 0)`。:focus-visible=true。因此是应用全局环误施于文本编辑，不是 UA 默认环。
截图：`.tmp/pi-focus-red-development-1788897822444/01-composer-mouse-before.png`；计算值：`.tmp/focus-evidence/before.json`。textarea 本体 0px border，直接 form 容器 1px border，故高亮必须到 form。

## 同类覆盖清单

TypeScript JSX AST 静态扫描 src（排除 devlab）：220 文件、831 个原生/显式可聚焦声明点：button 640、input 119、textarea 14、a 7、select 6、summary 20、custom tabindex 24、contenteditable 1。包含条件/disabled/hidden 声明，不等于运行时可见数；Mantine/TipTap 等运行时生成控件额外由同一 CSS 语义选择器覆盖。逐文件明细 `.tmp/focus-evidence/source-inventory.json`。

## 真机同类补漏与视觉基线

第一次四面走查发现：分镜 contenteditable 外有三层无边框包装，只有直接父层高亮不足。新增嵌套编辑器负例（浅/暗两条先红），基础 CSS 选最近 `.border` 容器并保留显式错误边框，两条转绿。
设计实验室 122 项：118 通过，4 张差异均属本次焦点更正：searchable 下拉搜索的底边高亮，catalog-liveness/modal/confirmDialog 的关闭按钮由 Mantine 黑环变为统一 token 环。逐图并排检查（`.tmp/focus-evidence/baseline-comparison.png`）后只更新这四张基线；没有更改阈值。

## 最终真实任务收据

`node tests/ux/focus-indication.walk.mjs` passed；四面截图 `.tmp/pi-focus-indication-development-1788901489621/`，JSON `.tmp/focus-evidence/final-walk-report.json`。library 10、canvas 44、settings 199、storyboard 42 个可见候选（滚动区屏外项仍计入，非逐个交互总数）；本轮实际交互覆盖各面文本字段与鼠标/Tab 双模态、按钮键盘环、搜索输入与草稿保留、分镜文字编辑。无真实模型付费调用。

第二轮视觉基线 121/122 通过；剩余差异揭示普通输入焦点不应跨层高亮展示面板。加普通 input 位于有边框面板内的浅/暗反例，先红；将跨层 `.border` 查找限定到 contenteditable，普通 input/textarea 只控制自己与直接容器。该限制避免染蓝搜索下拉的外部页面壳，未更新那张错误副作用基线。

最终 pnpm run gates 通过：75 contracts（72 通过、0 阻断、3 advisory）、122 视觉项、1290 测试文件通过/1 跳过、12058 用例通过/2 跳过，附加 agent-runtime/统计测试与最终构建通过。日志 `/tmp/nomi-focus-final2.log`。
