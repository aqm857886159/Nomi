# 外部助手交卡后走到确认卡 · 修前修后真窗口两遍（2026-11-21）

走查：`tests/ux/mcp-declared-model-gate.e2e.mjs`（真 Electron 开发构建，测试网闸开着，假密钥，两张确认卡都点「忽略」，生成请求 0）。

| | 哪份代码 | 结果 | 原始输出 |
|---|---|---|---|
| 修前 | 主分支 b75325253 的构建（走查脚本从本分支拷过去） | 退出 1：应用内宿主交卡、起草都成功，**预览回 `Unknown model: muse-video-x`**，中间没有重启 | `walk-before-main.txt` |
| 修后 | 本分支 7b2af07b7 的构建 | 退出 0：两个宿主各走一遍，17 条断言全过，都不重启走到确认卡 | `walk-after-fix.txt` |

截图（修后，中文界面）：`01-inapp-confirm-card.png` 应用内宿主、`02-stdio-confirm-card.png` 独立进程宿主——确认卡上的模型分别是 `apimart/muse-video-x`、`apimart/muse-video-y`，费用「未知」，有「忽略」「确认生成」两个按钮。

没做：英文界面没走；没有在 0.24.0 的旧资料上真窗口冷启动升级（旧盘只在单测里用真实旧文件重放）；没有真付费。
