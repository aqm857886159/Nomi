# 方向检查：Agent 对话「跟到底」换成现成库（协调代批 P1 例外）

日期：2026-11-09

## 命中了什么

动 `src/workbench/ai/v4/AgentPanelV4Panel.tsx`、`src/workbench/ai/v4/agentPanelV4ScrollMemory.ts`、`src/workbench/ai/ProjectAgentResidentShell.tsx`、`src/workbench/ai/resident/residentTranscriptScroll.ts` 之前，`node scripts/fix-churn.mjs` 报（原文）：

```
【方向检查 · RW】这一刀碰的地方已经被反复修，先别再补：
  · src/workbench/ai/v4/AgentPanelV4Panel.tsx：目录 src/workbench/ai/v4/ 近 14 天已有 2 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 3 个
  · src/workbench/ai/v4/agentPanelV4ScrollMemory.ts：目录 src/workbench/ai/v4/ 近 14 天已有 2 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 3 个
  · src/workbench/ai/ProjectAgentResidentShell.tsx：目录 src/workbench/ai/ 近 14 天已有 4 个 fix（只涉及 6 个文件，算同一概念），这一刀是第 5 个
  · 概念「Agent 面板流条目的身份（一次流式更新只重画变了的行）」：含 3 个文件，近 14 天已有 2 个 fix，这一刀是第 3 个
```

那几个 fix 提交：

| 提交 | 日期 | 改的是什么 | 和滚动有关吗 |
|---|---|---|---|
| `cdb2d35e1` | 11-07 | 工具失败行说「哪个字段 · 该填什么」（`useAgentPanelV4Data.ts` 等） | 无关 |
| `36028b4bf` | 10-27 | 任务卡不印金额（`AgentPanelV4Cards.tsx` 等） | 无关 |
| `faef843a8` | 10-27 | 服务商原话只认有来源证据的话（`lane/` 下测试） | 无关 |
| `86862197b` | 10-27 | 上游 HTTP 失败走统一结构化载荷（`lane/` 下测试） | 无关 |

目录 `src/workbench/ai/v4/` 的 2 个是前两行，`src/workbench/ai/` 的 4 个是全部四行，概念「Agent 面板流条目的身份」的 2 个是前两行。四个都和对话流的滚动位置无关。

## 命中的是目录口径，不是文件本身

- 要改的三个文件（`AgentPanelV4Panel.tsx`、`agentPanelV4ScrollMemory.ts`、`ProjectAgentResidentShell.tsx`）14 天内各 0 个 fix；要删的 `residentTranscriptScroll.ts` 也是 0 个。
- 命中只来自目录和概念口径。

## 改法是换和删，不是补

- 用户 2026-11-08 报了两件事：「每次切换agent都放到最上面了，我还得波动鼠标弄到最下面，太麻烦了」；「agent发送的时候感觉会卡一下，然后页面才变化。并且他不会自动滑动，而是卡在我的位置上」。11-09 又说：「我们遇到了这两个问题，背后是不是我们没有用一个通用的组件……找一个牛逼的方案，然后直接把这个方案挪过来」。
- 方向报告的结论：两件事是同一个根——「跟到底」是自己写的（三处直接写滚动位置、按条目数变化去跟），没有接聊天界面通用的那套做法；内容高度变了但条目数没变时就跟丢，切换对话时拿到的是上一条对话的记忆。
- 改法：换成现成库 `use-stick-to-bottom`（MIT，零依赖，按内容高度变化跟到底、人往上翻就松开、离底不远自动重新跟上）；同一提交删掉自写的跟到底逻辑（三处直接写滚动位置、按条目数跟）和已经没人调用的死代码 `residentTranscriptScroll.ts`；不加分支、不加特例、不留旧路或开关。
- 留下的只有两件本来就属于我们的事：「加载更早」时把人读到的那一行钉住；收起 / 展开回到原处（09-01 §11.2）。

## 批准

协调 2026-11-09 依 CLAUDE.md P1 例外代批，事后报用户。设计卡：`docs/plan/2026-11-09-agent-conversation-stick-to-bottom.md`。
