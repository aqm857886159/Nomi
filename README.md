<p align="center">
  <img src="apps/web/public/nomi-logo.svg" alt="Nomi" width="96" />
</p>

<h1 align="center">Nomi</h1>

<p align="center">
  <strong>Local-first open-source AI video workspace for scripts, image generation, video generation, and editing.</strong>
</p>

<p align="center">
  <a href="README.md"><strong>中文</strong></a>
  ·
  <a href="README_EN.md">English</a>
  ·
  <a href="docs/quickstart.md">Quickstart</a>
  ·
  <a href="docs/provider-integration.md">Provider integration</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/stargazers"><img src="https://img.shields.io/github/stars/aqm857886159/Nomi?style=for-the-badge&logo=github" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge" alt="Apache-2.0 license" /></a>
  <img src="https://img.shields.io/badge/TypeScript-strict-3178c6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Local--first-open--source-111?style=for-the-badge" alt="Local first open source" />
</p>

## Nomi 是什么

<p align="center">
  <img src="apps/web/public/nomi-mascot.png" alt="Nomi 吉祥物" width="280" />
</p>

Nomi 是一个本地优先的开源 AI 视频创作工作台。它把创作剧本、生成图片、生成视频和剪辑预览放在同一条生产流里，而不是让它们变成彼此割裂的工具。

你可以在创作区写剧本，从剧本文字派生图片和视频节点，把生成出来的片段拖进时间轴剪辑，再把时间轴里的素材回流为新的创作参考。Nomi 的目标是让文字、图片、视频、节点和时间轴之间的数据自然流动。

## 核心优势

### 剧本、图片、视频和剪辑是一条流

- 剧本里的提示词可以生成图片节点和视频节点。
- 图片节点可以作为视频首帧、尾帧或视觉参考。
- 图片和视频结果可以拖进时间轴继续剪辑。
- 剪辑片段可以继续回到画布，成为下一轮生成的素材。

### 本地开源，素材留在你的电脑

Nomi 是纯开源本地项目。你的剧本、素材、生成结果、项目文件和剪辑过程可以保留在自己的电脑里。你可以自己决定哪些供应商需要联网，哪些素材只留在本地。

### 方便接入自己的模型供应商

Nomi 不应该绑定某一家模型平台。你可以接入图像生成、视频生成、私有模型网关或企业内部 API。把供应商文档链接或网页交给 Nomi Agent，它可以辅助理解文档、规划接入、生成配置和结果解析逻辑。

### Agent 给建议，最终选择交给你

Nomi Agent 可以和你一起拆剧本、建节点、写提示词、规划制作步骤和排查生成问题。但它不是替你拍板的黑盒：是否创建节点、是否生成素材、采用哪张图或哪段视频，最终都由你决定。

## 适合谁

- AI 短片、漫剧、小说改编、短视频创作者
- 想把剧本、分镜、图片生成、视频生成和剪辑放进同一工作流的人
- 想把素材和项目留在本地，而不是完全绑定云平台的人
- 想快速接入自有模型供应商或私有模型网关的团队
- 想要 Agent 辅助制作，但保留最终创作控制权的创作者

## 关于作者

<table>
  <tr>
    <td width="68%">
      <strong>青阳</strong><br />
      AI 产品经理 / 创作者 / 前期货交易员。<br /><br />
      主要分享 AI 工具、赚钱路径和个人升级，关注如何帮普通人把 AI 变成效率、认知和收入。<br /><br />
      目前在 AI 初创公司做产品，也提供社群交流和咨询。<br />
      微信：<strong>TZ857886159</strong>
    </td>
    <td width="32%" align="center">
      <img src="docs/media/qingyang-wechat.jpg" alt="青阳微信二维码" width="220" /><br />
      <sub>扫码添加微信</sub>
    </td>
  </tr>
</table>

## 快速启动

环境要求：

- Node.js 20+
- pnpm 10+
- PostgreSQL 16+
- Redis 7+

macOS 安装依赖：

```bash
brew install postgresql@16 redis
brew services start postgresql@16
brew services start redis
psql postgres -c "CREATE DATABASE nomi_dev;"
```

安装项目：

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
pnpm install
cp apps/hono-api/.env.example apps/hono-api/.env
cp apps/agents-cli/agents.config.example.json apps/agents-cli/agents.config.json
```

配置 `apps/hono-api/.env`（填入你的 PostgreSQL 连接串）：

```env
DATABASE_URL=postgresql://YOUR_USER@localhost:5432/nomi_dev
JWT_SECRET=any-random-string
REDIS_URL=redis://localhost:6379
TAPCANVAS_DEV_PUBLIC_BYPASS=true
```

配置 `apps/agents-cli/agents.config.json`（驱动创作区 AI 和生成画布 Agent）：

**国内推荐：DeepSeek**（价格低、效果好，[申请 key](https://platform.deepseek.com/)）

```json
{
  "apiBaseUrl": "https://api.deepseek.com/v1",
  "apiKey": "your-deepseek-api-key",
  "model": "deepseek-chat"
}
```

**OpenAI / 其他 OpenAI 格式接口：**

```json
{
  "apiBaseUrl": "https://api.openai.com/v1",
  "apiKey": "your-openai-api-key",
  "model": "gpt-4o"
}
```

> 创作区的续写/改写、生成画布的 Agent 拆分镜和建节点，都由这个 LLM 驱动。`apiBaseUrl` 兼容任何 OpenAI 格式接口（Qwen、Ollama 等同理）。

启动开发环境（两个终端）：

```bash
# 终端 1 — API + Agents（自动拉起）
pnpm dev:api

# 终端 2 — Web
pnpm dev:web
```

默认地址：

- Web: http://localhost:5173
- API: http://localhost:8788
- Agents Bridge: http://localhost:8799（由 API 自动启动）

更多步骤见 [docs/quickstart.md](docs/quickstart.md)。

## 使用手册

### 从剧本到视频

1. 在创作区写故事、旁白、镜头描述或分镜草稿。
2. 让 Agent 根据当前文本建议图片节点和视频节点。
3. 选择你认可的节点并触发生成。
4. 把生成的图片作为视频首帧、尾帧或参考素材。
5. 把生成的图片和视频片段拖进时间轴。
6. 在时间轴里排序、剪辑、预览和导出。

### 接入图片/视频生成模型

图片和视频生成是独立的供应商配置，在 Web UI 里操作（不是 `agents.config.json`）：

1. 启动后打开 http://localhost:5173，点击右上角**模型管理**。
2. 在**供应商**标签页添加供应商，填入：
   - 供应商名称（如 `Dreamina`、`即梦`、`可灵`）
   - 接口 Base URL
   - API Key
3. 在**模型**标签页添加模型，关联到对应供应商，填入模型标识符。
4. 在生成画布选中节点后，从节点的模型下拉框选择刚配置的模型，点击**生成素材**。

详细说明见 [docs/provider-integration.md](docs/provider-integration.md)。

## 项目结构

```txt
apps/web          Nomi Web workspace
apps/hono-api     Local API and provider orchestration
apps/agents-cli   Local agent bridge and skills
packages          Shared schemas and protocols
docs              Public documentation
```

## SEO 关键词

AI video editor, local AI video tool, open source AI video generator, AI storyboard workflow, script to image, script to video, image to video, AI canvas, local-first creative tool, AI agents, video generation workflow, 开源 AI 视频工具, 本地 AI 视频工作台, 剧本生成图片, 剧本生成视频, 分镜生成, 漫剧工作流, 小说改编视频。

## License

Apache-2.0
