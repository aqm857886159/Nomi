# S-A / S-B / S-C 探索设计材料包汇总（Issue #1586 · C.1 / C.2 / C.3）

> **阶段标记**：`exploration`（拍板前探索设计包，供协调会话上 Claude Design 画布评审；生产仓库 `src/` 与 `electron/` 零改动）
> **基线提交**：`origin/main` @ `1730b7ea3` · **日期**：`2026-11-24`
> **视觉硬约束全量核验**：全套 10 张探索稿 PNG 均通过 Playwright 自动几何审计（`overflowCount === 0`，整页字号严格锁定 `11px / 12px / 13px / 14px` 四档）并逐张肉眼审阅；所有选择菜单勾选 `✓`（`14px`，`--nomi-accent`）一律居右；所有状态色均采用亮/暗双模四阶 `-soft / -edge / -ink` token；选中与待确认卡片一律中性描边（无蓝框）。

---

## 目录与交付物速览

| 专题 | 探索稿画板（HTML + 2x PNG） | 清单草案 | 解决的一句话核心问题 |
| --- | --- | --- | --- |
| **S-A · Agent 面板一批** | `S-A-agent-panel/sa-compare-zh-light.{html,png}` (`1440×900`)<br>`S-A-agent-panel/sa-states-zh-light.{html,png}` (`1440×900`)<br>`S-A-agent-panel/sa-states-en-dark.{html,png}` (`1440×900`)<br>`S-A-agent-panel/sa-narrow-1100x690.{html,png}` (`1100×690`) | `AgentPanelBatch.draft-board.json` | 指向卡留呼吸间距且 28 字模型不挤丢比例时长、前 3 格全露 + 第 4 个起底栏原地折叠；已执行命令即刻收成 1 行回执、错误人话只说 1 处（原码收进折叠区）；编号列表回归 `13px` 等宽挂排正文，模型返回的 PNG/SVG 按四档安全边界展示。 |
| **S-B · 图片标注里打字** | `S-B-whiteboard-text/sb-overview-zh-light.{html,png}` (`1440×900`)<br>`S-B-whiteboard-text/sb-en-dark.{html,png}` (`1440×900`)<br>`S-B-whiteboard-text/sb-narrow-1100x690.{html,png}` (`1100×690`) | `WhiteboardText.draft-board.json` | 删掉底部工具栏里 `96px` 窄输入框，选 `T` 点击画面 `(x, y)` 直接原位浮出可拖拽文本框打字；底部浮条恒定单行 `40px`，「完成」在 `1100×690` 窄窗下也稳居同行最右绝不折行。 |
| **S-C · 节点上方生成中胶囊收进节点内** | `S-C-node-generating/sc-overview-zh-light.{html,png}` (`1440×900`)<br>`S-C-node-generating/sc-en-dark.{html,png}` (`1440×900`)<br>`S-C-node-generating/sc-narrow-1100x690.{html,png}` (`1100×690`) | `NodeGeneratingStatus.draft-board.json` | 删掉悬在节点标题上方的外挂胶囊，状态安静收进节点卡片内部底栏（空卡与重生成新版本通用不挡主体），并与顶栏任务中心、指向卡、时间轴共读唯一纯函数状态真源。 |

---

## 今日真实界面与组件现状基线（`current-app/`，2026-11-24）

| 基线截图文件 | 对应现役代码位置 | 现状事实与 SHA-256 |
| --- | --- | --- |
| `current-sa-agent-panel.1440x900.zh-CN.light.png` | `src/workbench/ai/ProjectAgentResidentShell.tsx` | 常驻 Agent 面板 `1440×900` 中文亮色真窗现状 · `ed5620c151c07c3b1743f23f21c5cde1f59763ab87f3d990b346bacd1c85a1ca` |
| `current-sa-agent-panel.1100x690.en.dark.png` | `src/workbench/ai/ProjectAgentResidentShell.tsx` | 常驻 Agent 面板 `1100×690` 英文暗色窄窗现状 · `6f1b28e3632574e2da483e53c4811e3fef036167c3fabfc4b567824ed14dff31` |
| `current-sa-error-duplicated-lab.zh-CN.light.png` | `src/workbench/ai/v4/AgentPanelV4Receipt.tsx:49,91,249` | 工具行失败摘要 + 下方粉色 `V4ErrorBar` 重复印同一句错误 · `e119d08bf35747a2977353b7e9c2db921795ca0e2daf13dc6d627a4b24ff4d16` |
| `current-sa-task-card-1234-lab.zh-CN.light.png` | `src/workbench/ai/v4/AgentPanelV4Cards.tsx` | 任务卡深底大号 `1 ✓ / 2 ✓ / 3 / 4` 标签与蓝色描边 · `b189a9253da397cf5553e8c7e1c78b6303bda4e48233555be63bf84760650925` |
| `current-sa-plan-card-blue-border-lab.zh-CN.light.png` | `src/workbench/ai/v4/AgentPanelV4Cards.tsx:214` | 待确认卡片蓝色强调描边与高占位 · `92ff8cdd09f31f5b307b49a1bb95a6571c084ea5097012c38ff4ef3a13f39fdc` |
| `current-sb-whiteboard-toolbar-wrap.zh-CN.light.png` | `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardEditingToolbar.tsx:98` | 画板底部浮条过宽导致「完成」折到第二行真窗现场 · `9dee19b86de6518dae03ad0f4fa807d15f1342bf7a5481490259fa1e20d43268` |
| `current-sb-whiteboard-layers.zh-CN.light.png` | `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardDrawingTool.tsx:570` | 画板图层面板与双行折行浮条真窗现场 · `c0da0f5a57763beec92126cceefd4b98a2fd7be1b4b7d79024cb6c55e15bebe3` |
| `current-sc-node-top-pill-and-topbar.zh-CN.light.png` | `src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:284` | 节点头顶外挂「生成中 · 已等 2 秒」胶囊悬在标题上方并与浮条叠架 · `1e440cdc51c0f4d8e6005d20a8c3939e0ce9acf1cff754f9fb7edef38d2dfa63` |
| `current-sc-process-feedback-3way-lab.zh-CN.light.png` | `src/workbench/taskCenter/TaskCenterPanel.tsx:406` | 节点顶外挂胶囊 / 任务中心行 / 时间轴槽位（漏空格 `镜 1生成中`）三处并列 · `e41ea9b0fe53bfbbc878d24e7bd156139181a5be4b56830785cbf3b5bca1d57d` |
| `current-sc-process-feedback-late-lab.zh-CN.light.png` | `src/workbench/observability/generationFeedback.ts` | 软超时「比平时久」外挂胶囊与任务中心行 · `da1cb20a335ed547db1de35322d88f15cfabb890cf185b725182bedecb49b749` |

---

## 专题一：`S-A Agent 面板一批`（C.1）

### 1. 代码根因核查
1. **① 回复内 `NodePointer` 卡片挤、长模型名截断比例时长、第 4 个起折叠死角**：
   - `src/workbench/ai/pointer/GenerationReceiptPointers.tsx:43` 外层仅 `px-2`，无垂直外边距（`my-0`），紧贴上下 `NomiMarkdown` 紧凑段落（`my-1`）。
   - `src/workbench/ai/pointer/NodePointer.tsx:522-533` 与 `NodePointerGroup.tsx:218-233` 把 `[模型名, 比例, 时长]` 拼成单条字符串塞进单个 `truncate` `<p>`。当目录模型名达上限 **28 字符**（如 `Grok Imagine Video 1.5 官方`、`GPT Image 2.6 Sunburst Official`）时，在 `320px–360px` 窄侧栏内会把尾部的 `16:9 · 5s` 完全挤成 `…`，与 `NodePointer` 板「竖版必须带比例」自相矛盾。
   - `NodePointerGroup.tsx:88-195`（旧 D5）在超过 3 个镜头时直接征用第 3 格的缩略图画框显示「还有 N 个」：既把第 3 镜的画面遮掉了，又没有展开开关让创作者在对话里查看第 4–6 镜。
2. **② 命令/工具确认做完滞留 & 同一错误三处复读 + 裸露 `generation_input_invalid`**：
   - 待确认卡 `V4Intervention`（`AgentPanelV4Cards.tsx:214`）目前带蓝色强调描边（违反设计系统 §8 中性描边），且多步命令/工具过程展开体 `V4Process` 在失败或长输出时持续撑高对话流。
   - 一次工具调用失败在现役面板上最多同时出现 **3 处**：(a) `V4ToolReceipt`（`AgentPanelV4Receipt.tsx:49`）行尾印 `receipt.summary` + `⚠ 失败`；(b) `V4Process`（`line 205`）强制自动展开 `<details open>`，里面的 `ReceiptBlock`（`line 91-108`）把 `laneToolFailureDetail` 的首行原因再印第 2 遍，若回包带 JSON 还直接印出 `"code": "generation_input_invalid"`；(c) 回合级 `V4ErrorBar`（`AgentPanelV4Receipt.tsx:249` / `AgentPanelV4Panel.tsx:204`）在下方粉色红框里把同一句话再印第 3 遍。
3. **③ 编号列表 `1234` 标签过大 & 模型返回 `png / svg` 渲染策略**：
   - `src/workbench/common/NomiMarkdown.tsx:29-46` 中，`compact` 模式下 `h1/h2` 仍用 `text-title / text-body`（`18px / 15px` 粗体），模型输出 `## 1. …` 时序号显得巨大；同时 `streamdown` 内置 `ordered-list` 默认注入 `list-inside list-decimal`，与 `li > p` 块元素组合时破坏悬挂缩进；任务卡 `V4TaskCard` 则用深黑底粗体牌印 `1 ✓ / 2 ✓ / 3 / 4`。
   - `NomiMarkdown.tsx:63-70` 当前对一切 `img` 一刀切替换成静态小标签 `[🖼 图片]`（连本机 `nomi-local://` 已落盘受控图都不显示），而 `skipHtml` 下模型输出的 `` ```svg `` 代码块只能看 XML 源码。

### 2. ★0 先查别人（准入同行与开源标准）
| 出处 | 它怎么做 | 对本设计的具体影响 |
| --- | --- | --- |
| **LibTV**（同面对手，`seenOn: "2026-11-24"`，截图 SHA-256 `3277cb75d501b64abace1464bb30cd4f6a0ffad828d9071ac6e00c0104dc57b6`） | 右侧助手流引用画布视频卡时，上下留清晰呼吸留白，摘要行把模型名放左弹性截断、画幅比例与秒数锁在右端不省略。 | 确立双段弹性摘要（左 `truncate` 模型名 + 右 `shrink-0 tabular-nums` 比例与时长）及 `12px` 垂直呼吸间距。 |
| **Vercel `streamdown` v2 / Tailwind Typography**（现役 Markdown 引擎规范） | `streamdown` 默认 `list-inside` 适合单行气泡但会弄乱多行悬挂列表；标准正文排版通过覆盖 `components.ol` 为 `list-outside pl-5 tabular-nums` + `li::marker` 次级墨色收敛序号权重。 | 不换库（遵守 P0），直接在 `NomiMarkdown.tsx` 覆盖 `ol/li` 为 `20px` 外挂槽 `13px` 等宽次级墨色序号，并将 `agent-v4` 标题上限压回 `14px`。 |
| **TapNow**（准入同行，`seenOn: "2026-11-24"`，截图 SHA-256 `407663b900c5fde7cc49fe7b085115f29b24434b7fb117ada254114bee42146`） | 工具动作完成后折叠成单行轻回执；排障参数收在次级折叠区。 | 确认已批准执行完的命令卡立即退槽并收成单行 `28px` 回执，机器码 `generation_input_invalid` 收进默认折叠的「查看技术详情 ▾」。 |
| **WHATWG HTML `iframe sandbox` + CSP Level 3**（本仓 `artifactSandboxDocument.ts` 同源机制） | 不带 `allow-scripts` 与 `allow-same-origin` 的 `<iframe sandbox="" srcdoc="…">` 叠加 `<meta CSP "default-src 'none'; img-src data:; style-src 'unsafe-inline'">` 彻底封死脚本执行与外网探测。 | 确立模型生成的 SVG 允许预览但严禁直接注入主文档 DOM，统一复用 `withArtifactSandboxPolicy` 无脚本沙箱渲染。 |

### 3. 核心权衡对比表（需要拍板的点）

#### 权衡 A-1：回复里组指向超过 3 个镜头时怎么折？（用户纠结核心：省 26px 高度，还是保住第 3 镜画面并允许展开看全？）
| 方案 | 做法与体验 | 代价与边界 | 推荐 |
| --- | --- | --- | --- |
| **方案 A（推荐）**：前 3 格缩略图全露 + 底栏「展开其余 N 个镜头 ▾」 | 1–3 个平铺；≥4 个时前 3 张真实缩略图完整可见，底栏加一条 `26px` 折叠钮，点击原地展开/收起第 `4..N` 镜。 | 比旧 D5 多占 `26px` 垂直高度；需更新 `NodePointer` 板 D5 条款。 | **推荐** |
| **方案 B（对照）**：沿用旧 D5 第 3 格遮罩「+N 展开」 | 第 3 格画面盖半透明层写 `+4 展开`，点击展开全部。 | 只有 4 个镜头时第 3 镜画面也被挡住，创作者一眼少看一张真图。 | 备选 |

#### 权衡 A-2：模型返回的 `png / svg` 能不能直接在回复里显示？（四档安全契约）
| 媒体来源分档 | 能不能直接显示？ | 具体呈现与安全边界 |
| --- | --- | --- |
| **档 A · 画布已有节点产物**（对应某镜/某节点） | **走 `NodePointer` 小卡** | 遵守 §1.0「一个东西一个家」，不在聊天重复贴大图，悬停双向高亮、点击定位到节点。 |
| **档 B · 本机受控非节点 PNG/JPG/WebP**（`nomi-local://` 工具抽帧/局部截图） | **能（安全内联缩略图）** | 文件已在本机受控目录，**0 外网请求、0 脚本风险**；限高 `140px` 圆角缩略图，右侧附「存为节点」。 |
| **档 C · 模型生成 SVG 代码块**（`` ```svg `` 或本机 `.svg`） | **能（仅限零脚本隔离沙箱）** | **严禁 `dangerouslySetInnerHTML`**；走 `<iframe sandbox="" srcdoc>` + `CSP default-src 'none'` 渲染静态矢量，提供「预览 / 源码」切换与「放到画布」。 |
| **档 D · 外部不可信 URL**（`https://...`） | **不能自动拉取** | 防止追踪像素泄露创作者 IP 与 SSRF；保持紧凑显式胶囊 `[🖼 查看外链参考图 · domain ↗]`，用户点才用外部浏览器开。 |

### 4. S-A 设计卡（★1–★4 + ★9）
- **★1 目标与量具**：① 28 字最长模型名下指向卡比例与时长可见率 `100%`（Playwright 几何断言 `ratioSpan.offsetWidth > 0`）；② 单次工具失败在面板可见文本中原因出现次数 `=== 1`，默认状态下 `generation_input_invalid` 可见次数 `=== 0`（单测 + 实验室快照守门）；③ 存量老会话历史回放零报错（★1c：纯渲染层投影升级，转录协议零破坏）。
- **★2 唯一真源**：`NodePointer.tsx / NodePointerGroup.tsx` 唯一负责指向卡几何；`laneViewModel.ts` + `AgentPanelV4Receipt.tsx` 唯一负责工具失败折叠（删除工具失败时额外派发同文 `V4ErrorBar` 的分支）；`NomiMarkdown.tsx` 唯一负责列表与四档媒体策略。
- **★3 状态机**：工具回执 `running` → `settled-ok`（单行 `28px` 收起）| `settled-denied`（单行「已拒绝」）| `settled-error`（单行展示人话原因 + 默认折叠的 `查看技术详情 ▾`）；回合级 `V4ErrorBar` 仅在无工具承载的通道级中断（断网/额度耗尽）时挂载。
- **★4 边界表（`boundarySheet`）**：最长模型名 `28` 字符；平铺上限 `3` 张（第 `4` 张起折）；最窄停靠面板 `320px`（`1100×690` 整窗）；字号仅 `11/12/13/14px`；权限菜单勾选 `✓` 居右。
- **★9 验收判据与反例**：
  - 正例：6 镜 + `Grok Imagine Video 1.5 官方` 在 `320px` 面板中 `16:9 · 5s` 完整不裁切，点「展开其余 3 个镜头」原地露出 04–06；触发 `generation_input_invalid` 时面板只现 1 句中文原因，点开「查看技术详情」才见原码；注入 `<svg onload="alert(1)">` 脚本零执行且静态图形正常预览。
  - 反例（必须红灯拦住）：把 `https://attacker.example/pixel.png` 自动发起网络请求、用 `dangerouslySetInnerHTML` 渲 SVG、或同一工具错误同时渲染工具行摘要与底部 `V4ErrorBar`。

---

## 专题二：`S-B 图片标注里打字`（C.2）

### 1. 代码根因核查
- `src/workbench/generationCanvas/nodes/whiteboard/WhiteboardEditingToolbar.tsx:98-101`：切到文字工具 `T` 或选中文字对象时，底栏直接塞入 `<input className="h-7 w-24 ...">`（`96px` 宽文本输入框）+ `w-12` 字号输入框 + 翻转/删除按钮。
- `WhiteboardDrawingTool.tsx:533-545`（`placeText`）：点画布只在坐标处盖一个静态占位词「文字」，随即切回选择工具，逼创作者低头去底栏那个 `96px` 小窄框里盲打。
- `NodeFloatingToolbar.tsx:125` 外壳使用 `flex-wrap`：工具栏元素总宽超过舞台可用宽时，右侧 `[1280 × 720] [📷] [完成]` 直接折到第二行（已在今日真窗截图 `current-sb-whiteboard-toolbar-wrap.zh-CN.light.png` 实测复现）。

### 2. ★0 先查别人
| 出处 | 它怎么做 | 对本设计的具体影响 |
| --- | --- | --- |
| **TapNow**（同面对手，`seenOn: "2026-11-24"`，截图 SHA-256 `110aeb938e51e8a39d5a0de44a484ada999b3ae575ce85f901a8f5571e04d464`） | 图片局部编辑底栏始终保持单行胶囊，「完成」固定在最右端，绝不在工具条里塞文本内容框。 | 确认同提交删除 `WhiteboardEditingToolbar` 里的 `input.w-24`，锁死单行 `40px` 高。 |
| **LibTV**（准入同行，`seenOn: "2026-11-24"`，截图 SHA-256 `9755b18ffb9be3c5a703a32071951a8bd3e2117ef380e52a66859a027c1d4e4e`） | 画面空间编辑直接在画布坐标原位交互，浮条仅留工具图标与紧凑字号/颜色触发器。 | 确认底栏文字属性精简为「颜色圆点 + 字号下拉（右侧 `✓`）」两颗原子控件。 |
| **剪映专业版 / macOS 预览标注**（成熟创作工具） | 选 `T` 点图原位出现带闪烁光标与拖拽条的半透明文本框，`Enter` 或点外部落字，`Shift+Enter` 换行，空框自动销毁。 | 完整采用该键盘与焦点生命期，杜绝空白垃圾文字图层污染撤销栈。 |

### 3. 核心权衡对比表
| 方案 | 做法与体验 | 代价与边界 | 推荐 |
| --- | --- | --- | --- |
| **方案 A（推荐）**：画面 `(x, y)` 原位浮出可拖拽自动增高 `<textarea>` + 底栏单行 `40px` | 点哪就在哪打字，实时匹配字色与缩放字号，贴图片右缘自动折行，顶部手柄可边打边挪；底栏实测总宽 `527px`（英文 `532px`），在 `1100×690` 窄窗 + 右侧 Nomi 展开（舞台净宽 `732px`）下依然严格单行不折行。 | 需将原位 DOM 编辑框坐标通过 `clientPointToCanvasPoint` 与 Leafer 缩放比精确对齐，并在点「完成」前自动 commit 未关输入框。 | **推荐** |
| **方案 B（淘汰）**：保留底栏输入框、仅加宽浮条上限 | 仍需低头盲打、视线来回跳，且窄窗下必然再次折行。 | 未解决「不能直接在图上打字」的核心痛点。 | 不做 |

### 4. S-B 设计卡（★1–★4 + ★9）
- **★1 目标与量具**：① 创作者打字操作步骤从「选 T → 点图盖章 → 低头找底栏框 → 删占位词 → 输入」5 步减为「选 T → 点图直输」**2 步**；② `1440×900` 与 `1100×690`（含右侧 `320px` 面板展开）下 `WhiteboardEditingToolbar` 实测高度恒 `=== 40px`（单行零折行）；③ ★1c 老项目兼容：存量 `whiteboardState.texts` 数据结构不变，双击老文字图层即可原位重编。
- **★2 唯一真源**：文字内容编辑唯一在画面 `WhiteboardInPlaceTextEditor`，同提交删除 `WhiteboardEditingToolbar.tsx` 的 `textValue / onTextValueChange` 输入框（P1 加新必删旧）。
- **★3 状态机**：`tool=text` → 点击空白处进 `editing-new(x, y)`（`Enter` / 外部点击有内容则写图层并入历史栈，无内容静默销毁；`Esc` 取消）| 双击已有文字进 `editing-existing(id)`（`Esc` 还原旧文）| 点「完成」先触发 `commitActiveText()` 再光栅化保存。
- **★4 边界表（`boundarySheet`）**：浮条高 `40px`、总宽 `527–532px < 732px` 窄窗舞台净宽；输入框最大宽 `imageRight - clickX - 12px` 自动折行；字号下拉 `18 / 28 / 40 / 56 px` 选中 `✓` 居右；落盘失败保留画板打开并完整展示错误原因。
- **★9 验收判据与反例**：
  - 正例：`1100×690` 窄窗展开 Nomi 时打开图片标注点 `T`，`完成` 与工具图标处于同一水平行（`top` 差值 `0px`）；点画面输入两行中文后直接点 `完成`，生成的节点快照包含该两行文字且无遗留光标框。
  - 反例：空点一下不打字直接退工具，图层面板不许多出空白文字层；底栏不许再出现任何 `<input type="text">`。

---

## 专题三：`S-C 节点上方「提交中 / 生成中」胶囊收进节点内`（C.3）

### 1. 代码根因核查
1. **节点头顶三层叠架**：`src/workbench/generationCanvas/nodes/BaseGenerationNode.tsx:284-286` 在节点外上方 `bottom-[calc(100%+40px)]` 额外挂了一层 `data-node-inline-status`（渲染 `NodeGenerationStatus` → `GenerationStatusBar` 圆角胶囊），悬在 `NodeLabelRow`（`镜 01`）头顶半空，选中节点时直接与上方 `NodeFloatingToolbar` 挤在一起；与此同时节点卡内部 `NodeGeneratingOverlay.tsx:34-38` 又挂了一套 `GenerationTimingHint` + `GeneratingCancelButton`，内外重复。
2. **节点与顶栏任务中心各算一份导致分叉**：
   - 节点走 `generationFeedback.ts`（算 `{ phase, message, percent, late }`）+ `GenerationTimingHint`（另算预计秒数）；
   - 顶栏 `TaskCenterPanel.tsx:406-409` 与 `taskCenterEntries.ts:122-126` 只取了 `message` 字符串，丢掉了真实 `percent` 进度条，且对 `kind === 'generation'` 单独屏蔽了 `elapsed` 字段；时间轴槽位甚至出现 `镜 1生成中` 漏分隔符（见基线截图 `current-sc-process-feedback-3way-lab.zh-CN.light.png`）。

### 2. ★0 先查别人
| 出处 | 它怎么做 | 对本设计的具体影响 |
| --- | --- | --- |
| **LibTV**（同面对手，`seenOn: "2026-11-24"`，截图 SHA-256 `3277cb75d501b64abace1464bb30cd4f6a0ffad828d9071ac6e00c0104dc57b6`） | 节点框上方只有一行干净的镜号与名称，生成状态与进度全部收在卡片画框内部，绝不在节点顶外挂浮动胶囊。 | 确认删除 `BaseGenerationNode.tsx:284` 外挂 `data-node-inline-status`，让卡片上方回归纯净。 |
| **TapNow**（准入同行，`seenOn: "2026-11-24"`，截图 SHA-256 `407663b900c5fde7cc49fe7b085115f29b24434b7fb117ada254114bee42146`） | 在已有产物的节点上重新抽卡时保留原画面可见，把生成状态贴在卡片内下沿，不挡画面中心人物。 | 确立推荐方案 A（卡内底栏静默条）优于正中大胶囊。 |
| **Krea / Runway Gen-3**（准入同行） | 有真实后端百分比时画 `2px` 细进度条，纯轮询阶段只显示阶段词与等宽已用秒数；生成完成后短暂提示即完全隐去，留纯净画面。 | 统一真实百分比细条规则与完成后 `2s` 淡出零遮挡规则，并同步给 `TaskCenterPanel`。 |

### 3. 核心权衡对比表（卡内位置怎么摆？）
| 方案 | 做法与体验 | 代价与边界 | 推荐 |
| --- | --- | --- | --- |
| **方案 A（推荐）**：卡内底栏静默状态条（`inset-x-2 bottom-2`） | 删除节点顶外挂胶囊；状态条贴合在节点卡片内部底沿（高 `28px`，`--nomi-card-bar` 半透底 + `1px` 中性边，有真实百分比时底边附 `2px` 进度条）。**空节点首生**与**已有第 1 版画面重生成第 2 版**完全同一套位置，不遮挡画面中央主体人脸。 | 极窄竖图节点（宽 `<180px`）时状态文案自动省去次级后缀保核心词与秒数。 | **推荐** |
| **方案 B（对照）**：卡内正中悬浮胶囊 | 状态胶囊居中放在卡片正中央（与聊天 `NodePointer` 小缩略图一致）。 | 空白等待格好看，但一旦节点已有第 1 版图片/视频、重抽第 2 版时，正中胶囊正好糊在人物脸上。 | 备选 |

### 4. S-C 九格设计卡（涉长跑 / 可打断，9 格全填）
- **★0 先查别人**：见上表（LibTV、TapNow、Krea/Runway 三家核查完毕）。
- **★1 目标与量具**：① 节点外上方状态胶囊数量 `=== 0`（结构测试禁 `data-node-inline-status` 外挂定位）；② 同一任务同一时刻在节点卡内底栏与顶栏 `TaskCenterPanel` 的主状态文案、真实百分比、可取消态一致性 `100%`（纯函数同源单测）；③ ★1c 存量兼容：节点持久化 schema 零变更，纯运行态投影收敛。
- **★2 唯一真源与删旧清单（`functionCensus`）**：
  - 同提交删除 `BaseGenerationNode.tsx:284-286` 的外挂 `data-node-inline-status` 容器与重复计时的 `GenerationTimingHint` 独立口径；
  - 在 `src/workbench/observability/generationFeedback.ts` 收口唯一纯函数 `projectGenerationTaskStatus(node, queueEntry, now)`，统一产出 `{ phase, headline, percent, cancelMode, tone }`，供 **节点卡内底栏**、**顶栏 `TaskCenterPanel`**、**Agent `NodePointer`**、**时间轴槽位**（修正 `镜 01 · 生成中 · 0:24` 中点分隔符）四处直接渲染。
- **★3 全生命期状态机**：`idle`（零状态条）→ `requesting`（「提交请求与素材…」+ 本机可取消）→ `queued`（「排队中 · 前面 N 个」+ 免费取消）→ `generating`（有真实进度显示 `生成中 64% · 0:24` + `2px` 细条；无真实进度显示 `生成中 · 0:18`，绝不画假缓动条；不支持云端中止的诚实标「云端运行」不放假取消钮）→ `late`（`>5m` 四阶 `--nomi-warning-soft/edge/ink` 提示「比平时久 · 6:12 · 仍在跑」）→ `settled`（「已完成」亮 `2s` 后彻底隐去，`prefers-reduced-motion` 下即时切换）| `failed`（保留已有旧版画面不清空，卡内底栏 `--nomi-danger-soft/edge/ink` 完整展示不截断的失败原因与「重试」）。
- **★4 数据上下界（`boundarySheet`）**：队列序号 `1–99`；真实百分比 `0–100%`；软超时阈值 `300s`；完成收起 `2000ms`；画布 `60%` 缩放下卡内底栏字号保持可读；整窗支持 `1440×900` 至 `1100×690`。
- **★5 花钱与取消诚实性**：排队期点「取消」立即移出队列零扣费；已送达不支持退款中止的云端供应商后，按钮诚实变为只读「云端运行」（与任务中心一致），绝不给点了还会扣钱的假「取消」。
- **★6 长跑与重启恢复**：窗口刷新或主进程重连后，从持久化运行记录恢复 `startedAt`，节点卡内底栏与任务中心继续按同一时间戳走字，不重置回 `0:00`。
- **★7 性能预算**：时间走字采用 `1s` 节拍共享 ticker（仅在存在活跃任务时订阅，无任务时 `0` 定时器开销），不触发整张 React Flow 画布无关节点重渲染。
- **★8 可访问性与双语**：状态容器挂 `role="status" aria-live="polite"`（仅阶段切换播报，每秒跳字不刷屏读屏器）；中英双语与亮暗双模全覆盖。
- **★9 验收清单与反例**：
  - 正例：选中正在生成的视频节点时，上方浮条「复制变体」与 `镜 02` 标题之间干净无夹层胶囊；打开右上角任务中心，该镜的百分比与文案与节点卡内底栏逐字相同；有第 1 版图时点重生成，第 1 版图保持可见且失败时不丢第 1 版图。
  - 反例：无后端真实进度时出现自己往前蹭的假进度条、节点上方再次出现 `bottom-[calc(100%+...)]` 状态胶囊、或节点与任务中心文案不一致。
