# #685 第二轮：恢复提示词内滚和固定底栏

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实现、八态 smoke、加强后的两走查×两尺寸已通过；完整 gates 与提交/推送收据以本轮最终交付记录为准。用户任务书已裁决交互，不另设样张审批。

修前证据：`/tmp/skillui-r2-smoke-before.log` 与 `outputs/skillui-r2/before/`。原 Electron smoke 的超长提示词内滚断言通过、生成钮 hit-test 失败。

症状是生成钮不可点，直接原因是整卡 overflow-auto 和固定控制区总高度超过可用空间；类根因是推荐项未承担让位责任。图片、视频共用 NodeGenerationComposer，NodeEffectChips 只有此宿主；参考区与底栏由真实模型驱动。

实施：外卡 overflow-hidden，输入滚动区保留 72px；更多入口放固定底栏，推荐 chip 保留一行，宽高不够时隐藏推荐项，完整列表仍由同一个菜单提供。删除旧整卡滚动，不新增状态/数据格式。按渲染内容测推荐行可用尺寸，不按供应商或节点种类设例外。

范围：composer、效果 chip 与 Electron 真实回归。保留已有 smoke hit-test 与两走查全部断言；新增空/短/长提示词、窄节点、light/dark 证据。基础依赖不变，无框架新层或外部协议变化。

验收：smoke；canvas-batch-production / group-baseline 两尺寸；pnpm run test -- skill；带锁完整 gates exit 0；正常 hooks 推原分支；SKILLUI-LAST 顶部更新并复制任务书目标。

回滚：仅回滚本次任务 commit，保留 main 合入与原技能库实现。

## 真机验收记录

`node tests/ux/smoke.e2e.mjs`：18 个原有/结构断言 + 八态几何与菜单可达验证通过；保留原长提示词内滚和生成钮 hit-test。

| 状态（light + dark） | 输入高度 | 推荐行 / 可见项 | 外卡滚动 | 生成 / 更多命中 |
|---|---:|---:|---|---|
| 短提示词 | 72px | 无推荐行 | 无 | 全通过 |
| 超长提示词 | 82px，内滚 | 无推荐行 | 无 | 全通过 |
| 拥挤空态 | 72px | 可用 4px，推荐全隐藏 | 无 | 全通过 |
| 240px 窄节点空态 | 72px | 24px / 4 项 | 无 | 全通过 |

[八张原始截图与几何读数](skillui-fixed-footer-evidence/README.md) 已人工逐态核对：光暗文字可读、长文截在输入区、底栏完整、拥挤时只剩更多入口；窄节点按真实拖拽得到，composer 仍按底栏内容决定宽度。

两旧走查：`canvas-batch-production`、`group-baseline` 在 1280×933 / 1680×1050 四次 exit 0。原有图片/视频输入、更多菜单、批量与分组断言全部保留。日志 `/tmp/skillui-r2-{batch,group}-{default,wide}.log`，截图副本 `outputs/skillui-r2/`。

零付费模型调用；批量走查使用原有 loopback 供应商。Agent/工具契约不变。日常模型雷达另存 `/tmp/skillui-r2-radar-latest.json`，不纳入此修复；apimart-llm 因本机密文凭据未查成。论文雷达技能在提供的技能目录中缺失，未生成论文报告。

## 同类漏网修正

人工复核 `group-default/07-composer-real.png` 发现旧走查绿但底栏裁切；点击更多会触发浏览器对 overflow-hidden 的程序滚动。新断言在任何编辑/菜单点击之前核对按钮 hit-test、卡片边界和 scrollTop=0。

分组后可用卡高仅 174px，参考区 + 72px 输入 + 底栏的刚性总高超过它；只隐藏 chip 已无法容纳。共享放置层按真实 DOM 最小高度先保留输入和底栏，剩余高度给参考区；推荐项先让位，连参考区也放不下时只在参考区内部滚动。卡片、输入下限与底栏契约不变，不通过移动节点/放宽碰撞制造可用空间。

严格复扫结果：`group-baseline` 在两尺寸均通过新增的点击前 hit-test，真实点击参考区里的文生图后仍保持外卡 scrollTop=0；`canvas-batch-production` 图片/视频在编辑前也验证生成钮已命中。先前假绿被新增断言复现为红：`/tmp/skillui-r2-group-hit-red.log`。修后 [默认尺寸](skillui-fixed-footer-evidence/group-default.png) / [宽屏](skillui-fixed-footer-evidence/group-wide.png) 已人工检查，底栏完整；参考区在极限高度里可独立滚动。

## 先查别人

- 依赖已有：`node_modules/typescript/lib/lib.dom.d.ts:26217` 声明浏览器原生 ResizeObserver；现役 `src/workbench/generationCanvas/nodes/useComposerViewportPlacement.ts:28` 已用它测真实几何。本修复延续同一测量边界，不引入另一套放置引擎。
- 仓库已有：`tests/ux/smoke.e2e.mjs:86` 已有长提示词内滚与生成钮 hit-test 契约；`src/workbench/assets/PromptEditor.tsx:152` 是真实编辑回写路径。优先恢复此契约，新增的八态和分组断言覆盖入口差异。
- 菜单已有：`src/design/menu.tsx:276` 的 WorkbenchMenu 使用既有 portal；效果列表继续复用它，推荐项与更多只共享一份内容来源。先前 [第一轮方案](2026-09-10-skillui-composer-cifix.md) 的整卡滚动决策已明确撤销。
- 生态与 TikHub：本轮是用户已明确裁决的内部布局回归，未做新的外部产品/自媒体调研；没有新增框架、协议或供应商行为。现役源码与失败 Electron 用例直接决定修复边界，不虚报外部检索。
- 结论：用已有编辑器、菜单和浏览器测量；只补布局预算与原有验收缺失的点击前证据，不自研控件系统。

## 合并后单测夹具修复

合入 `f68cf2c7b73d` 后，全量及单跑均在 `canvasWriteTarget.integration.test.ts:328` 失败。临时诊断证实 `onPrepare → addStoryboardDesign → ensureStoryboardShotTable → addNode → interruptPendingCanvasWrite` 抛出 AbortError；错误发生在选中变化检查之前。原测试想模拟切换选中，却夹带了现在新增的画布写入。

分类 `one_off`，仅测试夹具；全仓扫描 `onPrepare.*addStoryboardDesign` 只有此入口。生产选择 API `workbenchDocumentSlice.ts:169 setActiveStoryboardId` 已只切选择，生产锁应继续禁止回执中第二次写入，无需改 Agent/授权生产代码。夹具在请求前建好两个候选方案，回执回调只调真实选择 API；原 stale 错误码、两份 Original 与 commits=[] 断言完全保留，额外验证画布快照不变。诊断日志 `/tmp/skillui-r2-target-diagnostic.log`，单独复现 `/tmp/skillui-r2-target-red.log`。

交付采用 main 的同源修复 `0ca1816fa`（随 PR #619 合入），本任务不重复修改该测试；本地诊断与12测试通过结果保留为合并回归证据。
