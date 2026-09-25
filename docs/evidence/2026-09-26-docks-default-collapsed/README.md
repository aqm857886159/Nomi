# 画面小窗与小地图默认收起 · 真机证据（2026-09-26）

最终构建（Windows 开发版 Electron），核心冒烟 `used` 夹具：Agent 面板开着、时间轴 6 段视频、25 张卡。
1280×800 与 1280×720（Windows 1920×1080 @150%）× zh-CN / en，四组各一份。截图全部人眼看过。

| 文件 | 看什么 |
|---|---|
| `<尺寸>-<语言>-01-default-collapsed-composer.png` | 没表过态：画面小窗收成右下小签、小地图不显示；选中卡后把浮框拖进舞台，↑ 与模型钮都露在外面 |
| `<尺寸>-<语言>-02-expanded-by-user.png` | 用户点「展开画面小窗」「显示地图」之后（即改动前的默认样子：两块压在浮框上） |
| `<尺寸>-<语言>-03-reopened-remembers.png` | 回项目库再打开：两块仍是展开的（记住了用户的选择） |
| `<尺寸>-<语言>-report.json` | 每一步的状态与 elementFromPoint 命中数据 |

命中数据（四组一致）：拖进舞台前，浮框底栏在时间轴底下（舞台之外，与停靠层无关）；拖进舞台后 `send.hit = true`、`model.hit = true`；打开时 `miniPreviewPill = true`、`minimapShown = false`；重开后 `miniPreviewExpanded = true`、`minimapShown = true`。
