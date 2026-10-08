# 文本节点：Agent 能读写正文、拼接只有一个口、再做会加工的界面（设计卡）

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

## B. 第 2 步：界面（在第 1 步提交之后补充，随实现更新）

见本文件后续小节。
