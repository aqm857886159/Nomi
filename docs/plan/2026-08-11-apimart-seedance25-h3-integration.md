# APIMart Seedance 2.5 / MiniMax-H3 接入计划

## 范围

- APIMart `doubao-seedance-2.5`：文生、首帧、首尾帧、多模态参考、`return_last_frame`。
- APIMart `MiniMax-H3`：文生、首帧/尾帧、首尾帧、多模态参考。
- APIMart `MiniMax-H3-Context-IR`：异步提示词增强，结果读取 `data.result.prompt`。
- APIMart `MiniMax-H3-Regeneration`：使用 `source_task_id` 将本账号的 H3 768P 成片升为 2K。

## 不动项

- 不改 APIMart 的鉴权、创建端点或任务轮询基础设施；复用现有 `apimartVendor` / `apimartVideos`。
- 不改变 KIE 的 H3 / Seedance 2.5 契约；APIMart 参考字段形状不同，使用独立能力档案与 mapping。
- 不把 Context-IR 当成普通 chat 模型调用；保留 `prompt_refine` profile 走视频异步端点。

## 验收门

1. 单测覆盖四个模型的 catalog seed、档案识别、参数→wire 字段、互斥参考槽和 Context-IR 文本结果解析。
2. 运行完整类型检查、lint、测试与 build。
3. 若本机 APIMart key 可用，运行 opt-in 真实 API 测试，至少验证 Seedance 2.5 文生、H3 文生、Context-IR、Regeneration 的提交/轮询契约；额度消耗在交付中报告。

## 回滚

删除本次新增的 APIMart curated 模型/mapping、三个 APIMart 专用能力档案及相关结果解析测试即可；不触碰现有 KIE/Seedance 2.0 实现。
