# 技能库改版落地

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

状态：实施中。用户已批准 2026-09-08 样张；以 library-cards.html、style.css、node-effects.html 为结构与间距依据，PNG 用于验收。

## 范围与既有实现
- 技能库：两列真实封面卡片，全部/技能/提示词/效果分面，详情大窗（44% 媒体、56% Markdown）。
- Composer：替换现有 Skill picker 布局，真实封面、可用分面、完整 hover 预览。
- 节点：空提示词四个常用效果 chip；更多分组包含效果与已有用户提示词。已有内容仅显示更多；追加可撤销。
- 复用 skillStore → skillIpc、skillPreviewUrl/resolveSkillPreview、curatedPrompts、NomiMarkdown、DesignModal 与现有浮层组件。不会引入新 UI 框架。
- 冻结 electron/agentLane、src/workbench/ai/lane、reactFlow；不改任何技能正文。

## 先查别人 / 规范链接 / 我们的偏差 / 理由
- Agent Skills：https://agentskills.io/specification；官方夹具 tests/fixtures/standard-formats/agent-skill/。
- 原仓：https://github.com/PicoTrex/Awesome-Nano-Banana-images；原始产物已由 #655 随技能保存。
- 现役标准扩展为 SKILL.md 的 metadata.nomi.library.preview（electron/shared/skillCuration.ts:8），复用而非再引入 cover 清单。DTO cover/preview 是此声明的媒体 URL 投影。
- 已登记的偏差：metadata.nomi 使用嵌套结构，领域理由与参考读取器行为见 docs/engineering/standard-formats.json 的 agent-skill；本次不改变外部格式。
- 共享媒体协议 electron/skills/skillPreview.ts:7；只暴露已声明内置媒体，保持路径穿越和符号链接边界。
- 详情复用 src/workbench/common/NomiMarkdown.tsx；获批 capture-detail.tsx 已使用同一渲染器。

## 控件层级
卡片只承担发现/打开详情；导出删除归详情。引用/用到节点为详情动作。节点效果是一簇，四个 chip 为无内容时的起手加速器；更多是唯一全量入口，替换旧提示词钮，保留用户提示词及参考素材应用能力。附属信息紧随内容。

## 验收与回滚
- 真实数据 specimen 与获批图逐项对账；Electron 技能卡片、详情、composer 筛选/悬停、节点空/非空/更多截图。
- 真实任务：发现技能并引用；筛选效果并追加节点及撤销；无封面/长说明/导入旧技能兼容。
- DTO/筛选/追加边界测试；完整 python3 scripts/with-gates-lock.py -- pnpm run gates exit 0 后 push/PR；提交通过 Ponytail hook，完整 gates 收据绑定任务提交。
- 回滚整个任务 commit，不保留旧新两套生产 UI。

## 真机发现的菜单坐标问题
节点更多菜单红测：虚拟锚点与触发 chip 横向相差 507px。内容虽然 Portal 到 body，Trigger 仍在 transform 祖先内，fixed 坐标被再变换。共享 WorkbenchMenu 将 Trigger 同样 Portal 到 body；保持原菜单 API、键盘与关闭行为。验证普通画布与额外祖先平移两种场景，菜单左边距触发点 <32px。其它点位菜单同用这个边界，不做节点专用定位器。

## 视觉对账收据
逐项结果与四面 Electron 截图：`docs/design/verification/2026-09-09-skill-library/README.md`。
