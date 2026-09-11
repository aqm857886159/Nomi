# 本次矩阵怎么跑的（探针脚本，不是回归走查）

这些是 2026-09-11 真机矩阵的**探索脚本**：只走界面（粘贴/点按钮/截图/dump DOM），
刻意采用「记录并继续」而不是断言即停——目的是一趟扫完 7 行、把问题全暴露出来。

**所以它们不放在 `tests/ux/`**：`check:walkthroughs` 要求每条走查 ≥2 条失败路径，
`check:test-waits` 禁止私有墙钟等待。这两条门岗是对的——一条没有断言的走查在别的门岗眼里
和一条严密的走查长得一样。为了过门岗往探针里塞凑数断言，比把它们放在这里更糟。

**真正该补的回归走查**见主报告「下一步收口清单建议」最后一节：
起本机 ComfyUI → 界面接入 → 导入官方 SD1.5 API 图 → 断言 catalog 里真有这条工作流 →
断言画布模型选择器里选得到它 → 断言生成出图。本次这三条断言全红。

跑法（需要本机 ComfyUI 在 127.0.0.1:8188，且仓库已 `pnpm run build`）：

    node docs/research/2026-09-11-comfyui-matrix-evidence/probes/comfy-real-matrix.mjs
    ONLY_ROWS=row4b,row7a node .../comfy-real-matrix.mjs     # 只跑某几行
    PROBE_MODE=skip node .../comfy-real-matrix-import-probe.mjs

| 脚本 | 证明了什么 |
|---|---|
| `comfy-real-matrix.mjs` | 主矩阵：每行粘贴 → 分析 → 记录②认输入 / ③缺件 |
| `comfy-real-matrix-connect.mjs` | 「启用 ComfyUI」后的确认路径（BUG-1） |
| `comfy-real-matrix-gate-probe.mjs` | 逐拍扫 12s，证明确认入口从未出现（BUG-1） |
| `comfy-real-matrix-import-probe.mjs` | 确认 / 不确认两种情况下工作流都不落盘（BUG-2） |
| `comfy-real-matrix-canvas.mjs` | 画布两个模型选择器里都没有 ComfyUI（BUG-3） |
