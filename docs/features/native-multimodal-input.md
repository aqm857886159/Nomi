# 原生多模态模型输入

Agent 聊天和文本任务可以将所选模型支持的原始图片、音频、视频与文字放入同一次请求。音视频不经过语音转写、抽帧或概要替代。

## 配置现有中转连接

1. 打开设置 → 模型 → 对应供应商 → 文本模型。
2. 进入“输入与生成方式”。
3. 对支持 Gemini 原生协议的型号，将“文本接口”设为 **Gemini native**。
4. 按供应商实际能力开启“图片输入”“原始音频输入”“原始视频输入”，保存能力。
5. 在聊天中选中该模型，添加素材后发送；同一对话中可继续针对原素材追问。

接口选择是每个文本模型独立的设置。因此一个中转站里的 Gemini 可以使用原生协议，GPT、Claude 和图片/视频生成模型继续使用各自的配置。不会按模型名称猜测音视频能力。

新的 Google 官方连接可以直接选择 Gemini 预设。原生协议使用 `.../v1beta/models/{model}:streamGenerateContent`；自定义路径前缀保留，末尾 `/v1` 或 `/v1beta/openai` 转为 `/v1beta`。

## 支持的请求形式

- **Gemini native**：文字、图片及原始音频/视频；音视频通过原生 `inlineData` 携带实际 MIME 和 base64 数据。
- **Chat Completions**：声明音频能力后支持协议明确接受的 WAV/MP3 `input_audio`；不将视频伪装为图片或通用 URL 字段。
- **Responses / Anthropic**：保留既有文本、图片和 PDF 行为。此实现没有声明这些通道支持原始音视频。

支持的媒体还取决于供应商、具体模型及文件容器。Nomi 校验真实文件头；不匹配、读取失败或协议不支持时明确报错。模型能力开关不会让供应商获得它本来没有的能力。

## 限制

- 当前采用内联上传，整次原生请求上限 **20 MiB**，包括 base64、图片、文本和历史内容，通常最多约 15 MiB 原始音视频，混合输入时还需预留其他内容空间。
- 尚未实现供应商 File API 上传、大文件分块或远端文件引用复用。
- 多轮请求重新从项目素材读取原文件；会话日志保存素材身份，不保存媒体 base64。压缩上下文保留原始素材引用，不用摘要代替。
- 长对话中累计的原始素材可能触及上限；可使用更短的素材或新建对话。
- 本机原文件删除、移动或失效时需要重新添加。取消和供应商错误沿用现有模型调用处理。

这些限制会直接提示，不会静默丢掉附件再表现为已经理解。

## 声明卡

文本模型可以使用可选字段：

```json
{
  "modelKey": "your-exact-model-id",
  "labelZh": "Your multimodal model",
  "kind": "text",
  "textProviderKind": "google-generative-ai",
  "inputModalities": ["text", "image", "audio", "video"]
}
```

上例只展示新增字段；提交完整卡时仍需符合声明卡原有的 `provider`、`sources`、有效 `modes` 等要求。

## 验证记录

2026-11-09 使用编译版 Nomi 的模型调用链，通过测试中转站对 `gemini-4-argon` 完成一次原始 PNG + WAV + MP4 混合请求，正常返回文本。音频样本接近静音，不将这项测试表述为语音识别质量验证。

详细记录：`docs/plan/native-input-live-result.json`；独立请求验收：`docs/plan/2026-11-09-native-multimodal-independent-review.md`。
