<p align="center">
  <img src="apps/web/public/nomi-logo.svg" alt="Nomi" width="96" />
</p>

<h1 align="center">Nomi</h1>

<p align="center">
  <strong>本地优先的开源 AI 视频创作工作台</strong><br />
  剧本 → 图片生成 → 视频生成 → 剪辑，一条流。
</p>

<p align="center">
  <a href="README_EN.md">English</a>
  ·
  <a href="docs/quickstart.md">快速启动</a>
  ·
  <a href="docs/user-guide.md">使用指南</a>
  ·
  <a href="docs/provider-integration.md">接入模型</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/stargazers"><img src="https://img.shields.io/github/stars/aqm857886159/Nomi?style=for-the-badge&logo=github" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge" alt="License" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
</p>

---

## 是什么

在一个工作台里完成 AI 视频的全流程：

- **创作区** — 写剧本、章节、镜头描述
- **生成区** — 节点画布，图片生成 + 视频生成
- **时间轴** — 拖入素材、剪辑、预览、导出
- **终端 Agent** — 自然语言驱动整个工作台

素材和项目文件留在本地，模型供应商自己选。

---

## 快速启动

需要 **Node.js 20+** 和 **Docker Desktop**。

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
corepack enable && pnpm install && pnpm start:local
```

打开 **http://localhost:5173**。

> 用 AI 编程助手（Claude Code / Cursor）？把 [AI_INSTALL.md](AI_INSTALL.md) 发给它，让它执行。

---

## 配置

### AI 对话（创作区 / Agent）

编辑 `apps/agents-cli/agents.config.json`：

```json
{
  "apiBaseUrl": "https://api.deepseek.com/v1",
  "apiKey": "your-key",
  "model": "deepseek-chat"
}
```

支持 DeepSeek、OpenAI、Qwen、Ollama 等任何兼容 OpenAI 格式的接口。

### 图片 / 视频生成模型

在 Web UI 里配置，不需要改配置文件：

1. 点击右上角 **模型管理**
2. 添加供应商（填入 Base URL 和 API Key）
3. 添加模型，关联到供应商
4. 在生成画布选中节点 → 选择模型 → 生成

详见 [docs/provider-integration.md](docs/provider-integration.md)。

---

## 终端 Agent

```bash
pnpm dev:agents
```

然后用自然语言操作：

```
把这段剧本拆成 6 个镜头，生成图片，按顺序放进时间轴。
```

Agent 执行时，Web 画布实时展示变化。

---

## 项目结构

```
apps/web          Web 工作台
apps/hono-api     本地 API
apps/agents-cli   终端 Agent
packages/schemas  共享协议
```

---

## 关于作者

**青阳** — AI 产品经理 / 创作者。微信：**TZ857886159**

<img src="docs/media/qingyang-wechat.jpg" alt="微信二维码" width="160" />

---

## License

Apache-2.0
