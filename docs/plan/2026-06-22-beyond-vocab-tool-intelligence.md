# 词表外智能：让 AI 无论词表内外都能用我们的 3D 工具解决（运镜 + 站位）

> 2026-06-22。用户观察:create_camera_move / create_staging_reference 都是闭口 enum 词表,
> 词表外没路也没指引——AI 要么硬塞最近的词(眩晕变焦→push_in,错),要么丢意图。要补成
> 「词表内精确渲染 + 词表外老实降级,AI 知道何时用哪条」。

## 0. 第一性：词表为什么在 + 为什么不能只靠它
- 词表在 = 给确定性渲染当契约:`buildCameraMoveScene`/`buildStagingScene` 能把 enum 确定性翻成 3D 几何;**自由文本→3D 几何是没解的难题**。词表是精确路的地基,不是偷懒。
- 只靠它的软肋 = 词表外(dolly-zoom 眩晕变焦 / 先推再甩 / "学这段参考片运镜" / 12 预设外的姿势)无路:LLM 硬塞错词 or 不调工具。且**无指引**教它怎么办。

## 1. 设计：分层 + 诚实降级（运镜 + 站位同一通用模式）
| 层 | 处理 | 保真 |
|---|---|---|
| 词表内 | 走 3D 工具渲精确参考(现状) | 高 |
| 组合(后续) | 词表原语序列→渲染器拼轨迹段 | 高 |
| **词表外** | **自由文本逃生口 → prompt 通道**:不渲染(不硬塞错词),把意图用电影术语写进该镜视频/关键帧 prompt,模型自己解;诚实标「非精确集,prompt 引导」 | 中 |

## 2. 本轮做（核心 = 让 AI 词表内外都解决好）
### A. 工具加自由文本逃生口
- `create_camera_move`：`move` 改 optional(enum 仍是精确首选)+ 新 `customMove?: string`。
  执行器:有 `move`→走现有 24fps 渲染路;只有 `customMove`→**不渲染**,把它当电影运镜指令追加进目标视频节点 prompt(走 image_to_video 文字通道),receipt 诚实说「用 prompt 引导未渲精确参考」。
- `create_staging_reference`：加 `customBlocking?: string`。词表外站位→不渲站位图,把描述追加进关键帧图 prompt(composition 文字通道)。
### B. 分层指引（随工具走 + system prompt）
工具描述 + generationCanvasAgentClient system prompt 写清:① 能映射词表→用 enum(精确);② 出词表→填 customMove/customBlocking 走 prompt 降级,**绝不硬塞错词**;③ 诚实标保真度。指引写进**工具 schema 描述**(随工具走遍所有 agent 面,治非 UI 面漏教,同 fps 那轮教训)+ system prompt。

## 3. 后续（本轮不做,标清）
- 组合原语:`moveSequence?: move[]` → 渲染器拼接多段轨迹(覆盖复合运镜走高保真渲染路)。工作量在轨迹拼接,另起。

## 4. 验收
- 扩 behavior eval(camera-move-agent-eval)加 out-of-vocab 场景:dolly-zoom 眩晕变焦 / "学这段参考片的运镜" / 先推再环绕(复合)→ 断言 AI **不硬塞** enum、而是填 customMove(或拒绝硬塞);词表内场景仍走 enum。真 UI 路径 + 零额度。
- 五门绿。可选真生成验降级出片。
