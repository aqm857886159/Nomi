# 导演台 viewport 方向检查（2026-10-07）

`node scripts/fix-churn.mjs` 对 `panels/viewport/ViewportOverlays.tsx` 报「目录近 14 天 5 个 fix，这一刀第 6 个」。逐条核对，是目录级误报：

| SHA | 概念 |
| --- | --- |
| 36b64cf6f | 名牌错开 |
| cbd28023c | 开关握手 |
| bc21e8844 | 外壳按钮与小窗空态 |
| 5ace9be34 | 外部写场景落盘 |
| bc45ad4b3 | React 19 类型 |

本刀是 #1070（未合并的功能 PR）的验收收尾：放置群众时顶部提示补群众文案，不是修已发布的 bug。

结论：不是同一类缺陷反复冒出来，不做结构复盘。

另记：fix-churn 目录级计数今天第二次误报（另一次是 scene/character），建议后续收紧到文件级或同概念判定。
