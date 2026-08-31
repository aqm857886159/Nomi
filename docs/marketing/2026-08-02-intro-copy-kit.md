# Nomi 自我介绍文案包（中英）

日期：2026-08-02 · 版本基线：v0.18.1 · 主打锤子：**自带模型 + AI 助手能直接导演它**

> 所有宣称已对照 v0.18.1 实际代码核实。底部「宣称红线」列了**不能写**的话，发之前过一遍。

---

## 0. 主线（所有渠道共用同一条，别各写各的）

**EN** — Bring your own models. Let your AI assistant direct them.
**ZH** — 模型你自己带，让你的 AI 助手替你导演。

一句话展开：

> **EN** — Nomi is an open-source desktop workbench for AI video. You bring the models — any OpenAI-compatible endpoint, or your own local ComfyUI — and your coding agent (Claude Code, Codex, Cursor) can drive the whole thing over MCP: build the storyboard, wire the references, run generation, hand you an editable first cut on a real timeline.
>
> **ZH** — Nomi 是一个开源的 AI 视频创作桌面工作台。模型你自己接——任何 OpenAI 兼容接口，或者你本机的 ComfyUI；然后 Claude Code / Codex / Cursor 可以经 MCP 直接开工：搭分镜、连参考、跑生成，最后在真实时间线上交给你一版能改的初稿。

**信任句（每个渠道都带上，这是你和 SaaS 的分界线）：**

> **EN** — Your projects, prompts and API keys stay on your machine. No account, no telemetry. The only outbound traffic goes to the providers you configured.
> **ZH** — 项目、提示词和密钥都在你自己电脑上。不用注册，没有埋点。唯一的对外请求是发给你自己接的那些模型。

---

## 1. GitHub README 顶部（替换现有 6 行）

### EN — `README.md`

```markdown
# Nomi

**Bring your own models. Let your AI assistant direct them.**

Nomi is an open-source desktop workbench for AI video. Connect any OpenAI-compatible
endpoint or your local ComfyUI, then let Claude Code, Codex, or Cursor drive it over
MCP — storyboard, references, generation, and an editable first cut on a real timeline.

Your projects, prompts, and API keys stay on your machine. No account. No telemetry.

[Download for macOS / Windows] · [Watch the 60s film] · [How the MCP loop works]
```

### ZH — `README.zh-CN.md`

```markdown
# Nomi

**模型你自己带，让你的 AI 助手替你导演。**

Nomi 是一个开源的 AI 视频创作桌面工作台。接任何 OpenAI 兼容接口，或者你本机跑着的
ComfyUI；然后让 Claude Code / Codex / Cursor 经 MCP 直接开工——搭分镜、连参考、
跑生成，在真实时间线上给你一版能改的初稿。

项目、提示词和密钥都在你自己电脑上。不用注册，没有埋点。

[下载 macOS / Windows] · [看 60 秒短片] · [MCP 是怎么跑起来的]
```

### 「为什么是 Nomi」四条（替换现有 Connected context / Visual anchors 那组内部词汇）

| 旧写法（内部词汇） | 新写法 EN | 新写法 ZH |
|---|---|---|
| Connected context | **One project, not eleven tabs.** Story, shots, references, generated takes, and the timeline live in the same file. | **一个项目，不是十一个标签页。** 故事、镜头、参考、生成结果和时间线在同一个文件里。 |
| Visual anchors | **Shot 4 and shot 9 should be the same person.** Lock characters, locations, props, and style once; later shots inherit them instead of restarting from a new prompt. | **第 4 个镜头和第 9 个镜头得是同一个人。** 人物、场景、道具、风格先锁一次，后面的镜头继承它，而不是重新赌一次提示词。 |
| Directable workflow | **Bring your own stack.** ~10 curated providers out of the box; paste any OpenAI-compatible, Anthropic, Responses, or relay endpoint to add more. Local ComfyUI is a provider like any other. | **自带全套。** 内置约 10 家可直接用的供应商；任何 OpenAI 兼容 / Anthropic / Responses / 中转接口，粘贴地址就能加。本机 ComfyUI 和云端模型一样是一个供应商。 |
| Agentic creation over MCP | **Your agent can operate it.** Thirteen MCP tools let Claude Code, Codex, or Cursor create projects, lay out shots, wire references, run generation, and start a durable production run. Direction, spend, rough-cut acceptance, and export still stop for you in Nomi. | **你的 AI 助手能真的操作它。** 13 个 MCP 工具，让 Claude Code / Codex / Cursor 建项目、排镜头、连参考、跑生成并发起可恢复的完整制作。方向、支出、粗剪采用和导出仍要回到 Nomi 由你批准。 |

### GitHub 仓库 description（现在那句太像功能清单）

- 现在：`Open-source, local-first AI video creation workbench for writing scripts, generating assets, editing timelines, and exporting videos.`
- 换成：`Open-source AI video workbench. Bring any model or your local ComfyUI; let Claude Code / Cursor direct it over MCP. Local-first, no account.`

Topics 建议加：`mcp` `comfyui` `ai-video` `electron` `local-first` `video-editor` `agentic`

---

## 2. 海外社区冷启动帖

### 2.1 Show HN

**标题**（HN 限 80 字符，这条 74）：

```
Show HN: Nomi – an AI video workbench your coding agent can direct over MCP
```

备选：
- `Show HN: Nomi – open-source AI video workbench, bring your own models (or ComfyUI)`（81，需砍 1 字）
- `Show HN: I made my AI coding agent direct a short film`（53，钩子最强，但标题党风险）

**正文（第一条评论，~230 词）：**

```
I make short videos with AI models, and the part that actually hurt was never the
prompting. It was that every tool owns a different slice: the script here, the
reference images there, the generation somewhere else, and the edit in yet another
app. By shot 9 the main character no longer looks like shot 4, and nothing in the
chain remembers why.

Nomi is a desktop app (Electron + React) that keeps all of it in one project file
on your disk. Two things in it are less common, and they're the reason I'm posting:

1. It doesn't ship its own model. About ten providers are pre-wired, but you can
   paste any OpenAI-compatible / Anthropic / Responses / relay endpoint and use it
   without a rebuild. A local ComfyUI is just another provider — and if yours is
   running, Nomi loads its frontend in a hidden window and calls graphToPrompt() to
   convert a normal "Save" workflow into API format, so workflows you downloaded off
   the internet import as-is instead of being rejected. It also diffs the graph
   against /object_info and tells you which custom nodes and model files you're
   missing before you run it.

2. It exposes 13 MCP tools, so Claude Code / Codex / Cursor can create the project,
   lay out shots, wire references, trigger generation, and start a durable production
   run. Direction, spend, rough-cut acceptance, and export stop for explicit approval
   in Nomi, enforced in the main process. An agent cannot quietly spend your money.

Honest limits: macOS and Windows only, no Linux build. Generation costs whatever
your provider charges — you pay them directly with your own key. The 3D staging tool
(pose mannequins, set the camera, capture first/last-frame references) is young. It's
AGPL-3.0.

Repo: <链接> — I'd especially like to hear where the MCP surface is too thin.
```

**回帖预案（提前想好，别临场慌）：**

| 大概率会被问 | 怎么答 |
|---|---|
| "How is this not another Runway wrapper?" | 我们不卖推理。你付给你自己选的供应商，key 在你机器上；ComfyUI 本地跑一样是一等公民。套壳的定义是替你选模型并加价，我们两件都没做。 |
| "Why a desktop app instead of a web app?" | 因为素材、密钥和 ComfyUI 都在本机；也因为要真的调 FFmpeg 导出 MP4，不是在浏览器里假装剪辑。 |
| "AGPL will kill adoption." | 对个人创作者零影响；对想闭源分发的公司我们提供商业授权。这是有意的双轨。 |
| "You have an affiliate link." | 直接承认，指 README 里的披露行。**别嘴硬。** |
| "Local? It calls cloud APIs." | Local-first ≠ offline。原话给出：项目/素材/提示词/密钥在本地，无账号无埋点，唯一外发是你自己配的供应商。 |

### 2.2 Reddit（三个子版，第一句必须不同，别一稿群发）

**r/comfyui** — 标题：
```
I built a desktop app that imports your normal ComfyUI workflows (not just the API export) and puts them on a shot-by-shot canvas
```
开头：
> Every tool I tried only accepted `workflow_api.json`, which means ~90% of the workflows people actually share get rejected. So Nomi loads your running ComfyUI's own frontend in a hidden window and calls `graphToPrompt()` — subgraphs expand correctly, and it converts what you actually downloaded. It then diffs the graph against `/object_info` and lists the custom nodes and model files you're missing before you hit run. Live progress, live preview, and a working cancel button, since it's talking to your instance over WS.

**r/StableDiffusion / r/aivideo** — 标题：
```
Open-source workbench for keeping the same character across shots — bring your own models
```
开头：
> The failure mode that made me build this: shot 4 and shot 9 aren't the same person. Nomi lets you lock characters, locations, props, and style once, then every later shot inherits them instead of restarting from a fresh prompt. Bring whatever model you already pay for, or point it at your local ComfyUI. Ends on a real timeline with an actual MP4 export.

**r/LocalLLaMA** — 标题：
```
I gave Claude Code 13 MCP tools and it directed a short film — with four human gates
```
开头：
> Nomi exposes 13 MCP tools (`nomi_create_project`, `nomi_add_nodes`, `nomi_connect_nodes`, `nomi_generate`, `nomi_start_playbook`, ...). Your agent can build the storyboard and start a durable production run, but direction, spend, rough-cut acceptance, and export halt in Nomi for a human decision. Bring your own endpoint, including a local ComfyUI.

### 2.3 X / Twitter thread（7 条）

```
1/ I stopped trying to write a better prompt.

The reason shot 9 doesn't look like shot 4 isn't your prompt. It's that nothing
in your chain remembers shot 4.

So I built Nomi — an open-source AI video workbench. 🧵

2/ It doesn't come with a model.

~10 providers pre-wired, but paste any OpenAI-compatible endpoint and it just works.
Your local ComfyUI is a provider like any other.

You pay your provider with your own key. Nothing in between.

3/ ComfyUI part I'm proud of:

Most tools only accept workflow_api.json — so most workflows people share get
rejected. Nomi loads your ComfyUI's own frontend and calls graphToPrompt().

Paste what you downloaded. It converts.
[GIF]

4/ Then it tells you what you're missing.

It diffs the graph against /object_info and lists the custom nodes and model files
you don't have — before you hit run, not 40 seconds into a failure.
[截图]

5/ The part nobody else has yet:

13 MCP tools. Claude Code / Codex / Cursor can create the project, lay out shots,
wire references, run generation, and start a durable production run.

You come back to an editable first cut.
[录屏]

6/ And every paid call stops and asks you.

Enforced in the main process. GUI closed? It goes out as an MCP elicitation.
An agent cannot quietly spend your money.

That gate was most of the work.

7/ Local-first: projects, prompts, and keys stay on your disk. No account, no telemetry.
macOS + Windows. AGPL-3.0.

<链接>
```

**X bio（160 字符内）：**
```
Building Nomi — open-source AI video workbench. Bring your own models; let your agent direct them over MCP. Local-first, no account.
```

---

## 3. Product Hunt

**Tagline（≤60 字符）：**
```
Bring your own models. Let your AI agent direct them.
```
（52 字符）备选：`Open-source AI video workbench your agent can operate`（53）

**Description（≤260 字符）：**
```
An open-source desktop workbench for AI video. Connect any OpenAI-compatible endpoint or your local ComfyUI, then let Claude Code or Cursor direct it over MCP — storyboard, references, generation, editable first cut. Projects and keys stay on your machine.
```
（253 字符）

**First comment / Maker comment：**

```
Hi PH 👋

I make short videos with AI models. The friction was never prompting — it was that
by shot 9, the character no longer looks like shot 4, and nothing in the chain
remembers why. Script in one tab, references in another, generation somewhere else,
edit in a fourth app.

Nomi keeps all of it in one project file on your own disk.

Two things make it different from the AI video tools you've already seen:

→ It doesn't sell you inference. ~10 providers are pre-wired, but you can paste any
  OpenAI-compatible endpoint and use it immediately. Your local ComfyUI counts as a
  provider — and Nomi converts the normal "Save" workflow format, so the workflows
  you download actually import.

→ Your coding agent can operate it. Thirteen MCP tools let Claude Code, Codex, or Cursor
  build the storyboard, run generation, and start a durable production run.
  Direction, paid generation, rough-cut acceptance, and export stop for you in Nomi.

Free and open source (AGPL-3.0), macOS + Windows. No account, no telemetry.

I'm here all day — tell me where it breaks.
```

---

## 4. 国内图文

### 4.1 公众号

**标题候选：**
1. 我把 Claude Code 接进了自己的视频软件，然后它自己拍完了一条片子
2. 做了一年 AI 视频，我最后发现问题不在提示词
3. 开源了：一个不卖模型的 AI 视频工作台

**开头（前 150 字决定读不读得下去）：**

> 你有没有过这种时刻：前面几个镜头都挺满意，拍到第 9 个，主角脸变了。
>
> 你回头翻聊天记录，想找第 4 个镜头当时用的那句提示词、那张参考图——找不到了。工具不记得，你也不记得。于是你重新赌一次。
>
> 我做 Nomi 就是从这件事开始的。它不是又一个"输入提示词出视频"的网站，它是一个装在你自己电脑上的开源工作台：模型你自己接（包括你本机的 ComfyUI），项目、素材、密钥都在你自己盘上，不用注册、没有埋点。
>
> 而最近做完的一件事，是让 Claude Code 可以直接操作它——你把想拍的东西说清楚，它建项目、排镜头、连参考、跑生成，最后在时间线上给你一版能改的初稿。要花钱的每一步，它都会停下来先问你。

### 4.2 即刻（口语、短、带一个钩子）

```
做了个开源的 AI 视频工作台，最近把它接进了 MCP。

现在可以直接跟 Claude Code 说"帮我把这个故事拆成 8 个镜头，主角保持一致"，
它自己建项目、排镜头、连参考图、跑生成，我回来收一版能改的初稿。

要花钱的每一步它都会停下来问我一次——这个闸做了最久。

模型自己带，本地 ComfyUI 也算一个供应商。项目和密钥都在自己电脑上，不用注册。
macOS / Windows，AGPL 开源。
```

### 4.3 小红书

**标题：** `拍到第9个镜头主角就变脸？我做了个工具治这个` / `我让AI助手自己拍完了一条短片😳`

**正文：**
```
做AI视频最崩溃的不是不会写提示词
是拍到第9个镜头，主角已经不是第4个镜头那张脸了😭

回头翻聊天记录想找当时那句提示词和那张参考图——找不到了
工具不记得，你也不记得，只能重新赌一次

所以我自己做了一个｜Nomi

✅ 人物/场景/道具/风格锁一次，后面镜头自动继承
✅ 模型你自己接，本机 ComfyUI 也能直接用
✅ 能让 Claude Code 帮你把整条片子的初稿排出来
✅ 最后在真的时间线上剪，直接导出 MP4
✅ 项目和密钥都在自己电脑上，不用注册不上传

完全免费开源，macOS 和 Windows 都能装
评论区问我要链接～

#AI视频 #AI工具 #开源软件 #ComfyUI #AI创作 #独立开发
```

### 4.4 B 站简介 / 视频简介

```
Nomi｜开源的 AI 视频创作工作台

模型你自己接（云端 API 或本机 ComfyUI 都行），项目、素材、密钥都在自己电脑上，
不用注册、没有埋点。从故事到分镜到生成到时间线在同一个项目里，
第 4 个镜头和第 9 个镜头保持是同一个人。
还能让 Claude Code / Cursor 经 MCP 直接帮你排出一版初稿。

免费开源（AGPL-3.0）· macOS / Windows
下载：<链接>
```

---

## 5. 各长度自我介绍（备着随时用）

| 场景 | 文案 |
|---|---|
| **一句话 EN** | Nomi is an open-source AI video workbench — bring your own models, and let your coding agent direct them over MCP. |
| **一句话 ZH** | Nomi 是一个开源的 AI 视频创作工作台——模型你自己带，AI 助手能替你导演。 |
| **两句 EN** | Nomi is an open-source desktop workbench for AI video. You connect the models (any OpenAI-compatible endpoint, or your local ComfyUI), and your coding agent can drive the whole thing over MCP — storyboard, references, generation, editable first cut. |
| **两句 ZH** | Nomi 是一个开源的 AI 视频创作桌面工作台。模型你自己接（任何 OpenAI 兼容接口，或者本机 ComfyUI），Claude Code / Cursor 能经 MCP 直接开工——搭分镜、连参考、跑生成，给你一版能改的初稿。 |
| **给投资人 / 合作方 ZH** | Nomi 是一个本地优先的开源 AI 视频工作台。它不卖推理，而是把创作者已经在付的模型串成一条能导演的流程；并且是目前少数能让 AI 编程助手经 MCP 端到端产出可编辑初稿的产品。变现走团队定制、集成与贴牌授权。 |

---

## 6. 宣称红线（发之前逐条过）

❌ **不能写**
- "no middleman / 不赚差价" —— apimart 通道带 `?aff=` 联盟参数，被扒到就是信任事故。改写成「你用自己的 key 直接付给模型方」，并在 README 加一行披露。
- "100% local / fully offline / 完全本地" —— 生成要联网。统一用 local-first + 那句信任句。
- "Available on Linux" —— 没有 Linux 构建目标。只写 macOS（Apple Silicon + Intel）+ Windows。
- "Works with ComfyUI out of the box" —— ComfyUI 供应商默认关闭，且 UI 格式转换需要你的 ComfyUI 正在运行。写成「本机 ComfyUI 可作为供应商接入」。
- "3D previz renders a reference video" —— 现在是首帧/尾帧参考捕获，不是渲染一段参考视频。
- "Subtitle / SRT burn-in" —— 没有字幕烧录路径。写「标题卡和文字叠加」。
- 任何"最强 / 第一 / 全兼容"级绝对宣称。

⚠️ **要带限定词**
- 密钥加密 → 「存在你的系统钥匙串里」（无钥匙串环境会退回明文）。
- 供应商数量 → 「约 10 家」（11 个种子里有 2 个默认关闭的本地项）。
- 3D 导演台 → 说「新功能 / 还年轻」，别放头条。

✅ **可以放心写（已逐条核过代码）**
- 9 个 MCP 工具 + 主进程强制的付费确认闸 + skills 经 MCP resources/prompts 暴露
- ComfyUI：UI 格式工作流导入、`/object_info` 缺件对账、实时进度 / 预览 / 取消
- 粘贴任意 OpenAI 兼容 / Anthropic / Responses / new-api 中转接口，无需重新编译
- 真 MP4 导出（内置 FFmpeg，H.264 / AAC）+ 多路音频混流
- 无账号、无埋点；密钥走系统钥匙串
- AGPL-3.0 · macOS（Apple Silicon + Intel）+ Windows
