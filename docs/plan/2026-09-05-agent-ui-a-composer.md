# Agent UI A 段：composer 与模式弹层

> 🚧 进行中

## 范围
- composer 常驻入口收敛为 `[+资料][模型][Skill] … [模式][发送]`；提示词库归入 Skill 菜单。
- 模式弹层只保留工作模式分段控件；审批与花费继续由 store/请求链承载，入口留给 B 段介入槽。
- 运行中输入框 token 呼吸描边，停止按钮持续可见。
- 删除 Creation 中列的 StoryboardPlanCard；文稿列表分镜条目直接进入 storyboard；Agent 流补一条分镜方案收据。
- 更新可计算合同与零额度真实 Electron 走查。

## 不动项
- 不实现介入槽、审批三档 UI、排队/中断三态、结果条或全屏输入框。
- 不改审批/花费 store 字段及 Host 请求契约。

## 根因与回滚
- 根因合同：`docs/fixes/2026-09-05-agent-composer-mode-popover.root-cause.json`。
- 回滚按 commit 粒度撤销本段五个 scoped commits；不改持久化 schema。

## 验收门
- `check:root-cause-contracts`、`check:tokens`、`check:i18n`、`check:boundaries`、`check:filesize`、`pnpm run gates` 全绿。
- `CONFORMANCE_TARGET=app node tests/ux/agent-ui-conformance.walk.mjs` 通过或明确记录合同随拍板更新。
- 零额度 Electron 走查保存 `.tmp/agent-ui-a/` 截图并人工 Read；报告写入 `.tmp/REPORT.md`。
