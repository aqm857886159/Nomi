# 方向检查：分镜启动器的消息一处拼（申请协调代批 P1 例外）

日期：2026-11-12

## 命中了什么

提交「选区浮条动作收成一张表一条分派；拆成镜头按样张 B 换图标挪位」时，fix-churn 原文：

> src/workbench/ai/ProjectAgentResidentShell.tsx：目录 src/workbench/ai/ 近 14 天已有 5 个 fix（只涉及 5 个文件，算同一概念），这一刀是第 6 个
> src/workbench/generationCanvas/agent/storyboardLauncher.ts：目录 src/workbench/generationCanvas/agent/ 近 14 天已有 3 个 fix（只涉及 3 个文件，算同一概念），这一刀是第 4 个

## 命中的是目录口径，不是文件本身

- `git log --since='14 days ago' origin/main -- src/workbench/ai/ProjectAgentResidentShell.tsx src/workbench/generationCanvas/agent/storyboardLauncher.ts` 没有提交；两个文件本身未到热点线。
- 目录里的那几次修复是 Agent 起草拒绝原因、模型提示、工具失败行、节点指向几何，和分镜启动器拼消息不是同一件事。
- `node scripts/door-map.mjs storyboardPlannerLauncher`：启动器由常驻 Agent 外壳发布，选区浮条和分镜面板两处消费；本次不改它的发布与消费关系。

## 改法是换，不是补特例

- 外壳里原来内联拼「拆成镜头」那条消息的选项；现在换成 `storyboardLauncher.ts` 的 `storyboardLaunchMessage` 一处拼（带分镜规划的技能 key、显示文字、打开方案），外壳只调用后 `send`。内联那段同提交删掉，没有并行版、没有新分支或特例。
- 这一刀服务的是用户 2026-11-12 拍板的样张 B 和「对话里显示分镜规划」：消息带不带技能 key 由一处决定，`storyboardLauncher.test.ts` 钉住（反例：去掉 skillKey → 红）。
- 同 PR 第二个提交（技能名两处走同一份查找）也碰 `src/workbench/ai/v4/useAgentPanelV4Data.ts`，同样只是目录口径命中（文件本身 14 天内 1 个 fix，cdb2d35e1，与技能名无关）。改法同样是换：两处 `skills.find(skill => skill.name === key)` 换成共享查找 `skillForKey`，旧比较同提交删掉。
- 选区动作那半（`src/workbench/creation/`）未命中热点。

## 批准

协调 2026-11-12 代批（P1 例外：目录口径命中、文件本身未命中、换且同提交删旧）；事后报用户。

代批只管第一个提交（选区动作表 + 分镜启动消息一处拼）。第二个提交（技能名查找）若命中热点，另行请示。
