# PR #720 · 8 条用户可见修复真机复验（R13/R16）

> 2026-09-11。真实 Electron 构建（`wip/pr720-cifix` @ f81c7025c 之上，未改任何生产代码），
> 隔离 profile，像真人一样点：建项目 → 进「生成」→ 用界面控件操作。截图在
> `tests/ux/shots/pr720-walkthrough/`，脚本在 `tests/ux/pr720-*.mjs`（走查脚本本身可复跑）。
> 花费：两次真实文本模型对话（DeepSeek V3.2）+ 一次 apimart `max_tokens:1` liveness 探测；
> **没有**真生成任何图/视频。

**结论：6 绿 / 2 红 / 1 跳过。两条红都是本轮新修的那一半没修全，不是新引入的回归。**

| 条目 | 可机器判定的断言 | 结果 | 截图 |
|---|---|---|---|
| **#1** 提示词出英文 | 中文界面：助手写出的生成提示词 CJK≥20 且无 ≥6 连续英文词（实测 267 字 / 最长英文串 2）；**英文界面冷启动**：回复是英文（最长英文串 24）而提示词仍中文（192 字） | ✅ 绿 | `01a-prompt-zh-ui.png` · `01c-prompt-en-ui.png` |
| **#4** apimart 填 key | 全新无 key profile 粘贴真实 key → `vendor.enabled` 保持 `true`、`hasApiKey` false→true；agent 对话下拉 **0→5 项**且 5 项全是 apimart curated 文本模型；填 key 前列得出的 106 项填完后**仍在 106 项**（回归时这里会掉一大截） | ✅ 绿 | `04b-apimart-connect-page.png` · `04c-apimart-key-saved.png` · `04d-after-key-model-list.png` |
| **#5** 左缘「+」hover 菜单 | ①z 序：节点 composer 在场时 menu `z=13` > composer（绿）；②指针斜着移进菜单仍开且可点 —— **奔菜单顶项在 (112,589) 提前关闭、菜单项点不到**；奔底项（与按钮同高）全程保持可点 | ❌ 红（半修） | `05-more-menu-diagonal.png` · `05-more-menu-hover-hold.png` · `05-node-composer-present.png` |
| **#7** 聊天框 | ①连打 128 字不带回车：98→158px 且 ≤上限 338（绿）；②**删空后仍是 158px，等 5s／失焦／重打再删都不缩**（红）；③权限弹层点外部即关（绿，`proveProbe` 先证弹层真的开过，再 `expectAbsent` 证它持续消失）；④发送钮右锚，`composer.right 1253` / `send.right 1248`（绿） | ❌ 红（4 条中 1 条） | `07a-composer-grown.png` · `07b-composer-shrunk.png` · `07c/07d-permission-popover-*.png` |
| **#13** 时间轴长条 | agent 面板拖到最宽（520px）后，「时间轴 · N 段」长条 `[440,624]` 与左下工具组 `[76,428]` **不相交** | ✅ 绿 | `13-timeline-pill-widest-panel.png` |
| **#15** 生成钮不漂移 | 在对话下拉里换 `GPT-5.5`(7 字) ↔ `moonshot-v1-128k-vision-preview`(31 字)，底栏文案确实跟着变，`send.right` 两次都是 **1248** | ✅ 绿 | `15a-model-popover.png` · `15-model-1.png` · `15-model-2.png` |
| **#16** 文本节点 | 左缘常驻 6 个含「添加文字节点」；对偶：「更多」菜单里只剩 3D 场景/3D 模型/全景图/画板，无文字 | ✅ 绿 | `16-text-node-resident.png` |
| **#14** 左右拉环 | **跳过** —— 用户 2026-09-10 已改判属 PR #656（节点连线磁吸悬停把手），本轮不含该改动，合 #656 才闭环 | ⏭ 跳过 | — |

## 两条红的现象与根因（只诊断，未改生产代码）

### #5 后半：8px 桥只补了按钮那条横带，菜单高出按钮的 133px 没有 hit-area
实测几何：「更多」按钮 `x[83,115] y[591,623]`，菜单 `x[123,271] y[458,623]` —— 菜单**向上**高出按钮 133px，
4 个菜单项里有 3 个在按钮上沿之上。`CanvasToolbar.tsx` 的 `before:inset-y-0 before:-left-2 before:w-2`
只覆盖 `x∈[115,123]` 这条 8px 缝，而 wrapper 的 `onPointerLeave` 是**立即** `setMoreOpen(false)`（无关闭延时）。
于是指针从按钮中心斜着奔顶项时，会先离开按钮上沿（y<591）又还没进菜单左沿（x<123），落在
`(112,589)` 这类空白点 → 立刻关。慢走（1px/20ms）、快走（8px/4ms）都关，只有沿着按钮那条横带
平着过去（奔最底那项）才走得通。**用户报的「hover 上去点不到」这一半没修好。**

### #7①：自适应高度是只涨不落的棘轮
`AgentPanelV4Composer.tsx:132-145` 的测量法是「把 textarea 瞬时压到 `height:0px` 再读 `scrollHeight`」。
但这个 textarea 是 flex 拉伸项，`height:0` 被 flex 覆盖、元素并不真的缩到 0 —— 实测清空后
`textarea.value.length=0` 而 `scrollHeight` 仍是 116（正好等于它被撑开后的自身高度）。
所以 `measuredRows` 只增不减，`minHeight` 卡在 158px 不回落。等 5s、失焦、重新打字再删都一样。
计划文档里「删字时也能正确缩回」这句与真机不符。

## 顺带记下的两条观察（不属这 8 条，不阻断）
1. **#4 的成功卡文案落后于新行为**：direct-key 验过之后模型已经出现在下拉里，卡片却仍写
   「密钥已保存，**等待验证** …点「继续验证」后…通过的模型会出现在画布可用列表」（`04c` 截图）。
   诚实门的老文案没跟着 B2 改，用户会以为还没接上。
2. **界面语言中途切换不改变当前 lane 的回复语言**：在设置里从中文切到 English 后开新对话，助手
   仍整段中文；冷启动即英文才走到 `buildLanguageRule` 的英文分支。第一版走查脚本因此误判过 #1，
   最终版改成两次界面语言各起一次 App。
3. **图片/视频两行模型下拉不看凭据**：全新无 key profile 里就已列出 52/54 项，因此它们对 #4 没有
   鉴别力；真正被凭据门卡住的是文本这一族，断言只以文本族判（对偶已证前态为 0）。
