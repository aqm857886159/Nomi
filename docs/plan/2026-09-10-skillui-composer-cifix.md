# #685 composer 输入区被效果行挤没

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：已被第二轮纠正。整卡滚动违反既有 Electron smoke 契约，现由 [固定底栏方案](2026-09-10-skillui-fixed-footer.md) 取代；以下保留上一轮决策记录。

范围：NodeGenerationComposer 的 flex/overflow 边界，以及 canvas-batch-production、group-baseline 两条验收。保留四 chip、更多、模型参数与断言语义；不改等待预算、不改其他技能功能。

证据：原脚本在 addNodeWithPrompt:177 / 调用 :355 超时，Playwright 报 empty effect chips 与 composer-card intercepts pointer events；outputs/skillui-cifix/before-original 保存日志和截图。原脚本覆盖共享启动器尺寸为 1680×993，先移除覆盖并支持共享 --wide，另跑 1280×933 修前证据。

根因分类 recurring：共享 composer 的提示词 flex 子项 min-h-0 可缩为零，而新增 shrink-0 效果行消耗剩余高度；固定 150px 卡片阈值并不代表动态参考区、效果行、参数行能容纳输入。图片和视频都经同一边界；与节点选择器无关。

方案：提示词滚动区至少保留现有三行（72px），卡片在内容超过几何上限时滚动，避免把输入高度让给附属操作。保留原空间放置算法、依赖版本、存储格式。旧 min-h-0/按固定阈值切 flex 路径同改删除。

验收：两条走查 × 1280×933 / 1680×1050；图片与视频输入区高度及实际点击/填字；group 的 @ 输入不得吞点击错误。pnpm run test -- skill；完整 python3 scripts/with-gates-lock.py -- pnpm run gates exit 0；正常 hooks 推原分支。截图人眼确认输入区与操作可达。

回滚：只回滚此任务提交，不撤销 main 合并和原技能库设计。付费调用零（批量走查使用本地供应商夹具）。

修前补证：1280×933 group-baseline 新断言实测输入滚动区高度 0（/tmp/skillui-cifix-group-before.log）；原批量走查尺寸的新断言实测图片输入区 36px（/tmp/skillui-cifix-red-original-height.log）。1680×1050 修前未触发塌缩，说明几何相关，不是 DOM 顺序选错。1280×933 批量继续到设置面板发现通知断言只验 x 轴：截图通知底 167px、设置顶 186.5px，实际不相交；改为 x/y 两轴矩形相离判断，保留 8px 间隔要求。

最终合并树走查：batch/group 在 1280×933、1680×1050 四条全部 exit 0。日志为 /tmp/skillui-cifix-{batch,group}-{ci,wide}-final.log；完整截图保留 outputs/skillui-cifix/。分组后真实输入 @，真实点击更多并打开效果菜单，无 force 点击，无增加等待预算。修前与修后关键截图及红断言文本见 [证据目录](skillui-cifix-evidence/)。人眼确认输入与效果菜单/参数栏可达；原技能 chip 内容和分组未改。

## 先查别人

- 仓库已有避障边界：[useComposerViewportPlacement](../../src/workbench/generationCanvas/nodes/useComposerViewportPlacement.ts) 的 recompute（第 44 行）已测内容自然尺寸，再交 [composerObstaclePlacement](../../src/workbench/generationCanvas/nodes/composerObstaclePlacement.ts) 分配空矩形。本次沿用，不另写定位器或几何算法。
- 仓库已有提示词最小内容：[PromptEditor](../../src/workbench/assets/PromptEditor.tsx) 第 223 行的 EditorContent，以及 [NodeGenerationComposer](../../src/workbench/generationCanvas/nodes/NodeGenerationComposer.tsx) 的三行 min-h-[72px]。缺的是其父滚动区同样不能塌缩；无需替换 Tiptap 或引入新依赖。
- 现有走查经验：[真实光标几何教训](../lessons/walkthrough-geometry-must-reverify-under-the-real-cursor.md) 要求按实际命中取证，[走查真信号](../lessons/walkthrough-assertions-need-a-real-signal.md) 禁吞点击错误。此次按真实报错和截图修复共享布局，同时移除 group 的吞错路径。
- 结论：用已有组件、原生 flex min-height 与 overflow；这是本分支新增效果行引发的内部布局回归，不涉及框架选型/升级或外部契约。未开展生态、自媒体搜索；它们不能替代此分支的修前真实几何证据。
