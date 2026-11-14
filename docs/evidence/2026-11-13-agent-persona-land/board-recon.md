# 拍板清单逐项对账（2026-11-13，并 main 后，真窗 zh / en）

量具：`shell-redesign` 的 persona 段（`_agentPersonaWalk.mjs`，逐格量计算样式 / 盒子，断言带 `board:AgentPersona/<id>`）+ 本轮临时脚本 land（五态 / 未读 / 未读极大 / 悬停 / 拖动中 / 减弱动效 / 四角四边 / 面板打开）+ 人眼看裁图对样张 `docs/evidence/2026-11-07-agent-persona/sheets/`。

| 元素 id | 清单写的样子 | 现在真窗里 | 一致 |
|---|---|---|---|
| persona.body | logo 底色圆角方形，空闲圆角 25%，干活变圆，连续形变 | 空闲身体 34.6px、圆角 8.64（=25%）、底色 = `--nomi-logo-ground`；在跑圆角 = 半径；过渡 0.55s cubic-bezier(.16,1,.3,1) | 一致 |
| persona.size | 44px；胶囊最宽 132px 右缘不动往左长；点击区不缩 | 球 44×44；胶囊右缘与球右缘同一位置、往左长；命中点仍是原生按钮 | 一致 |
| persona.eyes | 两只白眼 宽15% 高30% 上沿30% 左沿28%/56%；20 秒眨眼；160px 内跟随；减弱动效不动 | 眼 5.34×10.37（44 舞台上 15%/30%），白色；走查 ② 跟随 / 归位断言过；减弱动效段断言不跟不眨 | 一致 |
| state.idle | logo 形 + 两眼，几乎不动 | 同；空闲时小球上无持续动画（走查断言 animations=[]） | 一致 |
| state.running | 变圆，accent 弧转圈，眼低头扫；减弱动效静态环 | 变圆 + accent 弧 spin + 眼 scan；减弱动效下弧在、不转 | 一致 |
| state.needs-confirm | warning 胶囊带眼和「等你确认 N」，右缘不动往左长 | zh「等你确认 2」/ en「Confirm 2」，琥珀胶囊，字没截 | 一致 |
| state.done | 轻跳、眯眼笑，2.4 秒落回 | 眯眼笑（两道弧）+ hop 动画；2.4 秒计时代码没动 | 一致 |
| state.failed | 歪 9°、眼塌两条、右上 danger 点；读屏读出错 | 歪、眼成两条、右上红点；aria-label 带出错 | 一致 |
| variant.unread | 空闲 + 右上 accent 点、眼往屏幕里看 | 同；未读 99999 时点仍 8×8 正圆、不带数字 | 一致 |
| variant.long-task | 底轨 + 按镜头增长的弧 | 没有（清单本身标 missing，取舍第 2 条） | 未实现（按拍板取舍留 missing，不算新不一致） |
| variant.setup | 「先连一个模型」胶囊 | 没有（清单本身标 missing，随 D2-1） | 未实现（同上） |
| persona.tooltip | 悬停一行 = 现在的 title；移到身上抬眼 | title / aria-label 同一句带状态；悬停裁图眼上移 | 一致 |
| motion.morph-token | 550ms cubic-bezier(.16,1,.3,1)；减弱动效硬切 | 0.55s、同曲线；减弱动效 transition-none | 一致 |
| persona.on-dark | 深色画面 / 暗色加 1px 浅色描边（白 14–30%） | 浅色 1px 白 0.30、暗色 1px 白 0.14（本轮暗色形象段中英实测），身体色随 token | 一致 |
| ball.behaviors | 点开 + 聚焦输入框；拖动记位置；右键；⌘J；不自己弹开；探针照旧 | 全过（焦点改由主线 requestResidentComposerFocus 做，真窗中英都落进输入框） | 一致 |
| identity.face | 16px 静态脸 | 组件已换，单测过；生产无挂载点，真窗看不到 | 无法在真窗核（清单本身 in-progress，归 D2-1） |
| identity.wordmark | NomiWordmark 12px 照旧 | 同上 | 同上 |
| identity.old-mark | 身份行里不再出现 N 字标 | 身份行里已换；（另：Agent 面板头部 `NomiBrand` 仍是 N 字 logo，不在两板范围） | 一致 |
