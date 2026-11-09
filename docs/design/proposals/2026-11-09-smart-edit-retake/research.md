# 调研依据与现状

调研开始：2026-11-09；APIMart范围复核：2026-11-10。**用户明确目前只用APIMart；本页接入证据只保留APIMart官方资料。** 没有模型试用结论，接口上线前重核。其他服务的API和能力不进入实施依据；产品操作参考与真实页面走查另见[interaction.md](interaction.md)，不能把界面先例当接口支持。

## APIMart 图片输入依据

| 出处 | 观察/能力 | 对方案的影响 |
|---|---|---|
| [APIMart GPT Image 2.6](https://docs.apimart.ai/en/api-reference/images/gpt-image-2.6/generation.md) | markup使用独立、同尺寸透明PNG，作用于第一张原图；mask使用透明区域指示修改；两者互斥；圈外不保证完全不变 | **改变**初始合成图发送假设，优先原图+透明标注层；**确认**严格保留需要结果校验/本地合成 |
| [APIMart文档索引](https://docs.apimart.ai/_llms/en/api-manual.txt) | 列出图片、视频、上传、任务各自官方页 | **确认**先从本次使用的APIMart型号/模式查合同，不由模型品牌或别家接口推导 |

APIMart页面由网页工具读取失败后，用 `curl -L --fail --max-time 25` 读取官方Markdown，重点核对 `Image editing and masks` / `Markup-guided editing`。未发任何模型请求。

## APIMart 视频、上传与任务依据

| 出处 | 观察/能力 | 对方案的影响 |
|---|---|---|
| [APIMart Seedance 2.5](https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation.md) | 显式edit要求源视频4–30秒，size=adaptive、duration=-1；edit输出长度随源；可同步校验但上游仍可能按prompt重新判型失败 | **确认**先编辑窗口再本地回填；**改变**2秒选区直接提交假设，补足上下文但不扩大替换。参考视频与首尾帧混用时角色可能转成普通参考，不能承诺同时硬锁首尾 |
| [APIMart Gemini Omni 1.2 Flash](https://docs.apimart.ai/en/api-reference/videos/gemini-omni-1.2-flash/generation.md) | 一条≤15秒视频可edit，忽略duration、保留源时长；只支持16:9/9:16，输出24fps；原文未明确最低编辑输入时长 | **确认**后续短源路线可试；**否定**原声/小数时长/任意比例天然保留的假设 |
| [APIMart Upload Video](https://docs.apimart.ai/en/api-reference/uploads/videos.md) | 上传获得公网URL；默认50MB，需真multipart文件；上传成功不代表模型兼容 | **确认**本地片段须经现有APIMart资源上传流程；文件限制按上传与模型两边更严者检查，不能用模型200MB上限绕过上传50MB限制 |
| [APIMart task status](https://docs.apimart.ai/en/api-reference/tasks/status.md) | 按task_id查询异步状态与结果 | **确认**先持久task_id再轮询/落盘；这份查询文档不能证明提交幂等、取消或丢失task_id可自动找回 |

从APIMart官方索引定位这些页面，再用curl读取Markdown参数和约束；不使用搜索摘要中的旧模型别名/旧范围作为合同。原生任意时段range参数未在本次核对页面中发现，写“未找到证据”，不宣称整个平台绝不存在此能力。

## Nomi 现状与入口普查

基线：`7ca679e15e9bb1bd4cb789c43d2d2e0beba92f76`，已刷新origin/main；只读静态审查。已运行 `delivery:preflight`。以下链接是仓库相对路径，可在当前提交核对。

| 家/入口 | 当前事实 | 方案接入/边界 |
|---|---|---|
| [图片浮条](../../../../src/workbench/generationCanvas/quickActions/ImageQuickActionsToolbar.tsx) | 现有改图菜单、抠图、画板、全屏、下载、生成记录等；常驻动作已有密度预算 | 在现有改图/评论体系接入，不新增一排独立工具 |
| [媒体大图](../../../../src/workbench/generationCanvas/nodes/NodeMediaPreviewDialog.tsx) | 图片/视频预览、版本翻页、原生视频控件；尚不是区域AI编辑器 | 当前/历史版本共用入口；版本身份不可丢 |
| [本地图片编辑](../../../../src/workbench/generationCanvas/nodes/useNodeImageEditing.ts) | 裁剪、旋转、切图、抠图；图片/素材类复用，异步保存后入版本 | 复用异步位图/落盘经验；不能把远端生成当成本地编辑 |
| [画板](../../../../src/workbench/generationCanvas/nodes/whiteboard/whiteboardCanvasTypes.ts) | 笔迹/图层/橡皮；已装leafer-ui、perfect-freehand | 复用手势与库，不混淆擦标记和重绘图像 |
| [视频会话](../../../../src/workbench/generationCanvas/nodes/useNodeVideoSession.ts) / [浮条](../../../../src/workbench/generationCanvas/nodes/NodeVideoFrameToolbar.tsx) / [片段条](../../../../src/workbench/generationCanvas/nodes/VideoTrimFilmstrip.tsx) | 播放器、selection、编辑状态、截帧与剪辑 | 同一范围会话加“重拍此段”，保持剪辑产新片段语义 |
| [剪出片段](../../../../src/workbench/generationCanvas/nodes/trimVideoToNode.ts) / [FFmpeg参数](../../../../electron/video/trimVideoArgs.ts) | 现有本地精确裁切会建派生节点；区间按0.1秒归一化；有独立取消/失败处理 | 不是完整视频替换能力；不要改掉现有动作的落点；新增帧级映射另验证 |
| [生成结果类型](../../../../src/workbench/generationCanvas/model/generationCanvasTypes.ts) | provenance含提示词、模型/参数等，字段可选 | 可查来源，但不能推导所有旧结果有完整参考图快照 |
| [参考解析](../../../../src/workbench/generationCanvas/runner/generationReferenceResolver.ts) / [生成框快照](../../../../src/workbench/generationCanvas/nodes/composerGraphSnapshot.ts) | 已有原图/视频/首尾参考解析与图状态快照 | 提交冻结有效输入；不能用后来变动的连线覆盖原来源 |
| [版本owner](../../../../src/workbench/generationCanvas/model/nodeResultLifecycle.ts) / [生成落地](../../../../src/workbench/generationCanvas/store/nodeRunOutcome.ts) | 所有追加/设主图走统一owner；新版自动主图，重复身份幂等 | 不另写版本计数或接受候选才入历史的平行系统 |
| [GPT Image 2档案](../../../../electron/shared/modelArchetypes/gptImage2.ts) / [2.6档案](../../../../electron/shared/modelArchetypes/gptImage26.ts) | 前者有headless mask防护，后者明确尚不声明mask/markup | 上游支持不等于应用已接通；输入控件、主进程校验与codec须一起做 |
| [APIMart Seedance档案](../../../../electron/shared/videoCapabilities/seedance25Apimart.ts) / [Omni 1.2档案](../../../../electron/shared/videoCapabilities/geminiOmni12.ts) | 已有普通生成/参考/首尾模式，未声明video edit；Seedance档案有待复核标记 | 不把“全能参考”当已接通显式edit。上游新合同与当前档案差异归后续实施，本文不顺手修产品 |
| [APIMart生成适配器](../../../../electron/capabilityCore/apimartGenerationProvider.ts) | submitIdempotency=false、cancel=false；无providerTaskId时reconcile返回indeterminate | 已知task_id可查询；未知task_id须保留待确认并人工关联，不能自动重发或承诺恢复 |
| [旧标注清单](../../boards/2026-10-18/AnnotateToAgent.board.json) / [接入卡](../../../plan/2026-10-21-select-to-iterate.md) | 历史设计包含评论/圈选与版本决策；源码搜索未找到完整评论AI闭环 | 延续已定方向，但不把 explored 清单当实现证据 |

工具清单（原始源码扫描，按符号/文件统计，不是穷尽产品验收）：

```text
node scripts/door-map.mjs NodeMediaPreviewDialog appendNodeResultVersion --roots=src
1827文件；5扇门：
read: nodes/useNodeMediaPreview.tsx → NodeMediaPreviewDialog
read: nodes/versionCards/NodeVersionCardsHost.tsx → NodeMediaPreviewDialog
write: nodes/useNodeImageEditing.ts → appendNodeResultVersion
write: nodes/whiteboard/InlineWhiteboard.tsx → appendNodeResultVersion
write: store/nodeRunOutcome.ts → appendNodeResultVersion

node scripts/door-map.mjs startVideoTrim NodeVideoContext --roots=src,electron
3130文件；3扇门：
read: nodes/NodeVideoSession.tsx → NodeVideoContext
read: nodes/useNodeVideoSession.ts → NodeVideoContext
write: nodes/NodeVideoFrameToolbar.tsx → startVideoTrim
```

辅助普查：`rg --files src electron docs` 定位媒体/标注/时间轴；`rg -n 'comment|annotat|mask|inpaint' src/workbench/generationCanvas --glob '*.ts*' --glob '!*.test.*'` 区分3D/CSS mask和模型输入；扫描 `referenceImages|firstFrame|lastFrame` 及模型档案核对已有引用和能力。首次数门因node_modules缺typescript失败；安装锁定依赖后重跑成功。`trimVideo` 不是调用符号，首次扫描0门，不作为没有入口的结论；改用 `startVideoTrim` 得到上述结果。

概念与重复规则：版本/编号一份owner；视频UI一份session，主进程处理与Run仍是不同职责；标注请求owner尚未实现。APIMart目录存在某型号不等于其所有模式已接通，不写“统一支持”。

## 视觉证据与限制

- 已亲眼查看 [旧M4圈选图](../2026-10-18/preview/M4-circle-it.png)：曾要求画完回线程，适合指出减少“画完→完成→返回”的往返，但不是当前功能截图。
- 已亲眼查看 [2026-10-11剪辑截图](../../../evidence/2026-10-11-video-trim-production/03-clip-open-zh.png)：存在片段条和工具条，但样例画面是色条，不能作为本轮真实素材质量评审。
- 首轮CUA只读取项目库；用户追问交互后再次读取到已有图片工作区并查看真实截图，菜单动作未完成，未验证完整媒体编辑流程。安装版为0.24.0，当前源码package为0.24.1，不能混作同版验收；细节见interaction.md。
- 没有创建Claude Design画布，没有高保真获批图、生产组件原型、真实用户任务录像或付费模型结果。方案中的“顺滑”是待测目标。
