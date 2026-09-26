# 画面小窗与小地图默认收起 · 真机证据（2026-09-26）

最终构建（Windows 开发版 Electron，基于 main e64ccde8c，已含 #888「从项目库重开也摆全貌」），核心冒烟 `used` 夹具：Agent 面板开着、时间轴 6 段视频、24 张卡。
1280×800 与 1280×720（Windows 1920×1080 @150%）× zh-CN / en，四组各一份。截图全部人眼看过。

| 文件 | 看什么 |
|---|---|
| `<尺寸>-<语言>-01-default-collapsed-composer.png` | 没表过态：画面小窗收成右下小签、小地图不显示；选中一张图片卡后像用户一样把浮框拖进舞台，↑ 与模型钮都点得到 |
| `<尺寸>-<语言>-02-expanded-by-user.png` | 用户点「展开画面小窗」「显示地图」之后（即改动前的默认样子） |
| `<尺寸>-<语言>-03-reopened-remembers.png` | 回项目库再打开：画布摆了全貌，两块仍是展开的（记住了用户的选择） |
| `<尺寸>-<语言>-report.json` | 每一步的状态与 elementFromPoint 命中数据 |

命中数据（四组一致）：打开时 `miniPreviewPill = true`、`minimapShown = false`；拖进舞台后 `send.hit = true`、`model.hit = true`；重开后 `miniPreviewExpanded = true`、`minimapShown = true`。
