# 模型接入指南

Nomi 支持接入任意 AI 供应商：文生图、图生视频、文生视频、OpenAI 兼容的文本模型均可。

---

## 接入流程

顶部工具栏 → **模型接入** → 添加供应商，按以下步骤填写：

1. 填写供应商名称和 API Base URL
2. 填写你的 API Key（仅存在本地，不上传任何服务器）
3. 选择模型类型（文本 / 图片 / 视频）
4. 配置请求字段（提示词、宽高比、时长、模型名等）
5. 点击「测试」验证连接
6. 保存后即可在画布节点中选用

---

## 推荐供应商

### 文本模型（用于写脚本、拆镜头）

| 供应商 | 推荐模型 | 获取 Key |
|--------|---------|---------|
| DeepSeek | deepseek-chat | [platform.deepseek.com](https://platform.deepseek.com) |
| OpenAI | gpt-4o | [platform.openai.com](https://platform.openai.com) |
| 通义千问 | qwen-turbo | [dashscope.aliyun.com](https://dashscope.aliyun.com) |
| Ollama | 任意本地模型 | 本地运行，免费 |

> OpenAI 兼容接口均支持，Base URL 填对应地址即可。

### Anthropic（Claude）

从 v0.4.0 起 Nomi 内置 Anthropic provider，可直接对接 Claude 系列模型而无需经过 OpenAI 兼容网关：

1. 模型接入 → 新增供应商
2. **供应商类型** 选 `Anthropic`（对应内部字段 `providerKind: "anthropic"`）
3. Base URL 默认 `https://api.anthropic.com`
4. API Key 填 Anthropic 控制台生成的 `sk-ant-...`
5. 添加模型：例如 `claude-opus-4-1`、`claude-sonnet-4-5`、`claude-haiku-4-1`

Anthropic provider 与 OpenAI 兼容 provider 共享同一套 Tool Calling + 流式协议，
切换时不需要重写任何 skill。

### 图片生成

| 供应商 | 特点 | 官网 |
|--------|------|------|
| 即梦（Jimeng） | 国内便宜，效果好 | [volcengine.com/product/jimeng](https://www.volcengine.com/product/jimeng) |
| Stable Diffusion（本地） | 免费，需本地部署 | [stability.ai](https://stability.ai) |

### 视频生成

| 供应商 | 特点 | 官网 |
|--------|------|------|
| 可灵（Kling） | 国内，按秒计费 | [klingai.com](https://klingai.com) |
| Runway | 国际主流 | [runwayml.com](https://runwayml.com) |
| Wan（万象） | 开源可本地部署 | — |
| 火山方舟 Seedance | 官方原生，已内置 Seedance 2.0 / Fast / Mini | [console.volcengine.com/ark](https://console.volcengine.com/ark) |

---

## 用 Agent 辅助接入

如果供应商文档比较复杂，可以在生成区 AI 面板里把 API 文档 URL 发给内置 Agent：

```
帮我接入 xxx 供应商，API 文档在 https://docs.xxx.com/api
```

Agent 会读取文档、生成配置草稿，你在模型接入抽屉里确认后保存即可。

---

## 安全说明

- API Key 仅保存在本地（`userData/catalog.json`），不会上传到任何服务器
- 不要把整个用户配置目录提交到 Git
- 凭据只通过 UI 写入；不再有任何配置文件旁路（历史版本的 CLI 旁路配置已下线）
