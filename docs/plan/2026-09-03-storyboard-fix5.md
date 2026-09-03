# 分镜样张 FIX5 执行计划（2026-09-03）

📎 交接/日志——本轮范围内的具体 bug（内部标识符泄漏、镜头行定位歧义）已修复验证，但后续用户
对整体锚行/参数条设计方向判定不可用、已换人重做。完整交接见
[2026-09-03-storyboard-anchor-mockup-handoff.md](2026-09-03-storyboard-anchor-mockup-handoff.md)。

## 范围

- 修复参考区把 `slot.kind` 直接显示给用户的问题：所有参考槽文案必须是中文语义，不出现裸 snake_case 标识符。
- 修复走查/样张中对镜头行的歧义定位：精确使用 `[data-storyboard-rows] .shot-row` 或 `[data-storyboard-row]`；锚行不通过裸 `.shot-row` 寻址。
- 修正截图流程：默认态截图在参数面板收起、清单收起时拍；参数面板展开态单独留证。
- 按最新 `web-design-guidelines` 清单审计，结合 `frontend-design` 的“结构传递信息”和“复杂度匹配工具密度”视角做低风险修补。

## 不动项

- 不修改真实 Nomi 生产组件、模型档案或任何门岗基线。
- 不重画分镜表信息架构，不把高密度专业工具套成营销落地页。
- 不处理 `BRIEF-FIX3.md`。

## 验收

- 红灯探针：回退到旧渲染时，参考区裸 snake_case 断言必须报红；修复后通过。
- `node ./scripts/check-mockup-contracts.mjs`
- `pnpm run check:tokens`
- `pnpm run check:docs-index`
- `node tests/ux/storyboard-anchor-model-modes.walk.mjs`
- 生成默认态明暗截图、独立参数展开态截图，并用视觉检查确认主视觉不含大参数面板。

## 回滚

只回滚本计划涉及的样张、对应走查、契约说明、计划索引和报告；不触碰已有未跟踪截图及其他轮次文件。
