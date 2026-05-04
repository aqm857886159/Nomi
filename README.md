<p align="center">
  <img src="apps/web/public/nomi-mascot.svg" alt="Nomi mascot" width="160" />
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

## 快速启动

环境要求：

- Node.js 20+
- pnpm 10+
- PostgreSQL 16+

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
pnpm -w install
cp apps/web/.env.example apps/web/.env
cp apps/hono-api/.env.example apps/hono-api/.env
cp apps/agents-cli/agents.config.example.json apps/agents-cli/agents.config.json
```

启动开发环境：

```bash
pnpm dev:agents
pnpm dev:api
pnpm dev:web
```

默认地址：

- Web: http://localhost:5173
- API: http://localhost:8788
- Agents Bridge: http://localhost:8799

更多步骤见 [docs/quickstart.md](docs/quickstart.md)。

## 使用手册

### 从剧本到视频

1. 在创作区写故事、旁白、镜头描述或分镜草稿。
2. 让 Agent 根据当前文本建议图片节点和视频节点。
3. 选择你认可的节点并触发生成。
4. 把生成的图片作为视频首帧、尾帧或参考素材。
5. 把生成的图片和视频片段拖进时间轴。
6. 在时间轴里排序、剪辑、预览和导出。

### 接入供应商

1. 准备供应商 API 文档或网页链接。
2. 在模型管理里创建供应商和模型配置。
3. 让 Agent 辅助理解接口参数、鉴权方式和返回结构。
4. 用测试请求确认图片或视频任务可以创建、轮询和读取结果。

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
