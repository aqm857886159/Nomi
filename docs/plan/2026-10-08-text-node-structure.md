# 文本节点：Agent 能读写正文、拼接只有一个口、再做会加工的界面（设计卡）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 线：I-textnode1（协调会话 2026-10-08 派）。用户 23:00Z 拍板「按推荐」、23:08Z 确认画板「文本节点：会加工、看得见」没问题。
> 定位：文本节点 = 画布上看得见、改得动、会流动的文字中间产物（提示词、描述、风格说明），不做第二个文稿编辑器；剧本归创作页。
> 分两个阶段、同一个 PR、提交分开不压缩：第 1 步结构（无新界面，本文 A 部分），第 2 步界面（B 部分，按画板）。

类别：[花钱（加工框调文本模型）][新界面]　第 1 步类别：[其他（Agent 能力 + 数据口）]

## A. 第 1 步：结构

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我让 Agent 「把风格说明那段改简洁」，它能读到正文、写回去，我在回执里看到「改写「风格说明」的正文」，不满意一键撤销或 Ctrl+Z，正文回到原样；文本连到图片/视频/3D 时，Agent 看到的和实际拼进提示词的是同一段字。不做什么：不生成、不花钱、不改非文本节点；拆成多条/建节点是第 3 步。已知坑：正文超 4000 字符 canvas.read 截断并标明。真实任务：①读一个带正文的文本节点；②Agent 覆盖 / 追加正文后撤销；③文本→图片，改文本后图片提示词跟着变。 | `textNodeWrite.integration.test.ts`、`textNodeBody.test.ts` |
| ★2 谁说了算 | 「文本节点正文」概念 owner = 画布 store 的 `writeNodeBody`（contentJson 唯一写口；编辑器手改与 Agent 写入都经它，`setNodeText` 只是先打撤销点再调它）。读成文字的唯一函数 = `electron/shared/canvas/textNodeBody.ts` 的 `textNodeBody`（canvas.read、下游拼接、对账共用）。「这个节点生成时会接进哪些文字」的唯一投影 = `projectConnectedTextInputs`。同一份事实只存 contentJson 一份。 | `door-map`：拼接入口见下 |
| ★3 一致与复用 | Agent 写口复用 canvas.write 的提议回执 + 补偿撤销（`restore-text` 与 `restore-prompt` 同构）+ 取证过期判定（加 `bodyHash`）；没有另起一套。tiptap 文档转换复用原画布拖入的 `tiptapDocFromPlainText`（搬进共享模块，原处删）。未接新库：领域内数据口，不是通用能力。 | `check:self-written`、`git grep tiptapDocFromPlainText` |
| ★4 全状态 | 无新界面。节点锁定 → 拒绝；非文本节点 → 拒绝（`not_a_text_node`）；批准后用户又改了正文 → `capability_target_stale`，不覆盖用户的字；节点已删 → 补偿 no-op；超长 → schema 拒绝（>20000 字符）。 | 集成测试 |
| ★9 验收与回滚 | 验收：另一条线跑 `textNodeWrite.integration.test.ts` + `check:tool-face` / `check:model-face-frozen` / `check:mcp-payload`。回滚：revert 第 1 步提交（模型面、基线、账本同一提交）。 | 命令 |

### 拼接入口（door-map）

`connectedTextPrompt` 里原有两个导出：`collectConnectedTextPromptParts`（读口 2 扇：模块自己 + `runProjectDelivery` 的「输入没变」守卫）、`withConnectedTextPrompts`（`generationNodeExecutor` 三处调用）。第 1 步收成一个投影 `projectConnectedTextInputs`（谁、什么顺序、哪段字）+ `composeConnectedTextPrompt`（拼成什么）；守卫和执行器都只读投影，删掉 `collectConnectedTextPromptParts`。边分类 `isTextPromptEdge` 的 6 处调用是「这条边是不是文字边」的谓词，不拼接，保持共享一份。

### 未做（有意）

- 文本节点「生成」没选模型就生成不了（`catalogTaskActions.ts`）→ 第 2 步 B3 处理。

## B. 第 2 步：界面（按画板「文本节点：会加工、看得见」，用户 10-08 23:08Z 确认）

类别：[花钱（加工框调用文本模型，口径同原文本节点「生成」）][新界面]。9 格：

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我想把一句想法变成能直接喂图 / 视频的提示词，选中文本节点点「扩写成提示词」；想让它看图写描述，把图连到左边点「看图写描述」；翻译、拆成多条同理；要自己说怎么改就写一句按 ↑。不做：写剧本（归创作页）；拆成多条后为每条建节点（第 3 步，等编组「生成全部」）。真实任务：①风格说明 → 下游镜头 → 小签悬停看到接进去的正文；②林薇定妆图 → 文本 → 看图写描述；③长故事 → 拆成 4 条。 | 单测 + 截图 |
| ★2 谁说了算 | 加工预设与顺序的 owner = runner/textProcessPresets.ts；点预设的唯一入口 = nodes/textProcessRun.ts（加工框与空节点「试试」共用）；浮框定位 owner 仍是 composerCanvasPlacement（加 match-node 变体）；↑ 之后的唯一路径 = composerRun.startGenerationFromComposer（图片 / 视频浮框也走它，原内联逻辑删除）。 | door-map |
| ★3 一致与复用 | 复用：WorkbenchMenu（下拉）、AnchoredPopover（悬停小窗）、GENERATE_BUTTON_CLASS（圆形 ↑）、NodeErrorReport（出错 + 去设置入口）、requestTaskCancel（停止）、getTextBrain（跟随 Agent 的模型，与提示词优化同源）。文本节点原来夹在通用浮框里的「续写 / 改写 / 重写」按钮与占位文案同提交删除，功能收进下拉。 | git grep |
| ★4 全状态 | 空：图标 + 文本 / 还没有内容 + 试试（扩写成提示词 · 看图写描述 · 拆成多条）；正在写：字逐个长出来 + 底部「正在写 · 停止」（停止真的掐断主进程文本流）；出错：节点错误卡（没文本模型 = 「模型没配好」+「检查模型」去设置）；拆成多条：编号列表 + 「拆成 N 条」；超长（≥600 字）：节点内滚动 + 「共 N 字」；能力不可用：没图点看图写描述 = 当场说「先把图片连到这个节点的左边」，没内容点扩写 = 「先写点内容，或连一段文字进来」；锁定 / 只读：全部禁用。zh / en / 光 / 暗 各一套。 | 截图 12 张 + 2 张下拉 |
| 5 中途表 | 正在写时：预设与下拉禁用，↑ 显示 ···；停止 = 取消（不进刹车计数、不是红色错误）；关窗 / 重启 = 草稿流式内容 persist:false 不落盘，原文保留；连点预设 = 第二下被「正在写」挡住。 | textActions.test |
| 6 外部数据与失败 | 外部 = 文本模型服务。没有可用文本模型 → 内部签名 No usable text model → 错误卡 + 设置入口；图进文字出走 image_to_prompt，主进程已支持 nomi-local 图与多图。 | classifyError |
| 7 性能预算 | 加工框只在选中时挂载；下游小签订阅一个字符串，不随无关画布写入重渲。无新增常驻订阅。 | 人工 |
| 8 真实条件 | Windows / 英文界面 / 暗色：截图已拍；真模型调用、真 Electron 窗口拖线与选中环：unverified。 | 截图 |
| ★9 验收与回滚 | 验收：另一条线跑上面列的三个测试文件 + check:tool-face / model-face-frozen / mcp-payload，并对照截图；回滚：revert 第 2 步提交（第 1 步独立）。 | 命令 |

### 与画板的对账（逐项）

- 加工框：同宽、间距 8、预设纯文字用「·」隔开、最后一个是下拉、一句话输入、模型 chip、右下圆形 ↑：一致。预设行与空节点「试试」行中英文都是单行（flex-nowrap，从结构上折不了行，英文预设名缩短为 Expand / Describe image / Translate / Split / Revise ▾，实测不溢出）。
- 节点：画板无「文本」拖拽条；我们保留顶部「⠿ 文本」条，因为正文是编辑器，需要一个不会误入编辑的拖拽把手（有意不同）。节点默认高度沿用现有默认尺寸（用户可拖），画板是贴着三行字的紧凑高度（有意不同，未改默认尺寸）。
- 正文排版：13px / 20px、12px 内边距，一致。
- 正在写：画板是圆圈转子，我们用现有品牌加载标（NomiLoadingMark），其余一致。
- 下游小签：「引用 · 文本名」、悬停小窗「生成时接在提示词后面」+ 正文：一致。有意不同：画板里小签在提示词下面、参考缩略图上面；我们的浮框里参考缩略图本来在提示词上面，小签放在提示词下面。
- 选中蓝框 / 连线 / 拉环：不在本 PR（拉环线负责）；实验室页里没有。

### 先查别人

- Freepik Spaces · Text 节点：https://www.freepik.com/ai/docs/introduction-to-spaces 、https://ru.freepik.com/ai/docs/text-nodes
- Figma Weave（Weavy）Text / Array 数据类型：https://help.weavy.ai/en/articles/12268346-datatypes
- Krea Node Agent：https://www.krea.ai/blog/ai-workflow-agent
- Runway Workflows with Agent：https://help.runwayml.com/hc/en-us/articles/53645211363475-Building-and-running-Workflows-with-Agent
