<p align="center">
  <a href="https://nomiaqm.com/">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="marketing/assets/promo-0.22/cover-zh-dark.jpg" />
      <img src="marketing/assets/promo-0.22/cover-zh-light.jpg" alt="Nomi —— 对话出片，模型按原价" width="100%" />
    </picture>
  </a>
</p>

<p align="center">
  <strong>Nomi 是一个开源、本地优先的 AI 视频工作台。</strong><br />
  跟它的 Agent 说你想拍什么，它自己拆镜头、出关键帧、做视频、排进时间轴——<br />
  用的是<em>你自己接</em>的模型，按<em>供应商的原价</em>付钱。
</p>

<p align="center">
  <a href="#下载"><b>下载</b></a> ·
  <a href="https://nomiaqm.com/">官网</a> ·
  <a href="#看宣传片">看 90 秒宣传片</a> ·
  <a href="https://nomiaqm.com/quickstart">快速上手</a> ·
  <a href="https://pan.quark.cn/s/d3322c17e7b6">夸克网盘镜像</a> ·
  <a href="docs/integrate-with-your-agent.md">让你的 AI 帮你接入</a> ·
  <a href="#社区">加入用户群</a> ·
  <a href="#团队合作">团队合作</a> ·
  <a href="README.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><img src="https://img.shields.io/github/v/release/aqm857886159/Nomi?label=release&color=1a1816" alt="最新版本" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1a1816" alt="平台" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0--only-1a1816" alt="许可证" /></a>
</p>

## 为什么是 Nomi

中转站、官方 API、ComfyUI、本地模型，本身都很便宜。商业 AI 视频产品用的往往是同一批模型，价钱却常常翻几倍。

Nomi 给你商业产品级别的工作流，底下跑的是**你自己的**模型：钱直接付给供应商，上游什么价你就付什么价。连 Agent 用的也是你挑的模型——不订阅，不加价。

## 看宣传片

[![看 90 秒 Nomi 0.22 宣传片](marketing/assets/promo-0.22/film-poster-zh.jpg)](https://github.com/aqm857886159/Nomi/blob/main/marketing/assets/video/nomi-0.22-film.mp4)

片子里的界面都是 Nomi 的真实组件，画面素材都是用 Nomi 生成的。

## 你能用它做什么

### 说一句，Agent 在画布上替你干活

<img src="marketing/assets/promo-0.22/still-agent.jpg" alt="Nomi 的 Agent 把一句需求变成画布上的四张关键帧" width="100%" />

说说你想拍什么。Agent 会看你的画布、把故事拆成镜头、出关键帧、做成视频、排进时间轴。它做的每样东西都落在画布上，你看得见，也随时能改。

它每一步问不问你，你来定：**每步问**、**自动改**（花钱的生成仍然先问）、**全自动**。

### 一镜一镜，由你导演

<img src="marketing/assets/promo-0.22/still-storyboard.jpg" alt="分镜表里四个镜头都已出片，角色参考卡已锁定" width="100%" />

分镜表一镜一行：提示词、首帧、模型、时长，一眼看全。给角色或场景锁一张参考卡，用到它的每个镜头都还是同一张脸。

### 拿在手里的 3D 导演台

<img src="marketing/assets/promo-0.22/still-director.jpg" alt="3D 导演台和手机取景页" width="100%" />

摆好人物姿势、定好机位，拿起手机就能取景。拍到的画面直接回到画布上。

### 哪家模型都能用，一镜一换

<img src="marketing/assets/promo-0.22/still-model.jpg" alt="同一张视频卡换个模型再拍一版" width="100%" />

Seedance、可灵、Wan、海螺、Nano Banana、GPT Image……走 APIMart、Kie.ai、火山方舟、魔搭社区、即梦会员、任意 OpenAI 兼容的中转站，或者你本地的 ComfyUI 都行。同一个镜头换个模型，再拍一版。

### 新模型，当天就能用

新模型一出，点「**用 AI 帮我接入**」，让 Claude Code 或 Codex 替你接进来：地址、参数、模型 ID 它去查；Key 你在 Nomi 自己的页面里贴（助手看不到）；它真跑一次验证，通过了模型就出现在列表里。

### 东西都是你的

一个项目就是你硬盘上的一个文件夹：画布、分镜、时间轴、每一个生成的文件、导出的成片都在里面。不用注册，不上报数据。代码 AGPL-3.0 开源。

**下一步：AI 剪辑。** Nomi 要做的是一站式的内容创作 AI 工作台，欢迎一起来做。

## 下载

| 系统 | 版本 | 下载 |
|---|---|---|
| macOS | Apple 芯片 | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| macOS | Intel | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| Windows | Windows 10 / 11 x64 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

🇨🇳 GitHub 打不开或下载慢：[夸克网盘镜像](https://pan.quark.cn/s/d3322c17e7b6)。最新版本以 [GitHub Releases](https://github.com/aqm857886159/Nomi/releases/latest) 和 [官网](https://nomiaqm.com/) 为准。

暂时没有 Linux、Windows arm64 和 macOS 通用版安装包。

<details>
<summary><b>macOS 第一次打开</b></summary>

当前 macOS 安装包**没有使用 Apple Developer ID 签名，也没有经过 Apple 公证**，第一次打开可能被系统拦截。请只用上面表格或 Nomi 官网、GitHub 官方仓库里的下载链接。

1. 下载对应的 DMG，把 `Nomi.app` 拖进“应用程序”。
2. 在访达的“应用程序”里右键 `Nomi.app`，选择“打开”，再确认“打开”。
3. 仍被拦截时，打开“系统设置”→“隐私与安全”，找到 Nomi 那条提示，点“仍要打开”。

只有在 macOS 提示 Nomi“已损坏”时，先确认安装包来自 Nomi 官方链接，再运行：

```bash
xattr -dr com.apple.quarantine "/Applications/Nomi.app"
```

不要全局关闭 Gatekeeper。更新时下载新的 DMG 覆盖即可。
</details>

<details>
<summary><b>Windows 第一次打开</b></summary>

安装包暂时没有 Authenticode 签名。在 SmartScreen 提示里点“更多信息”→“仍要运行”。
</details>

## 快速上手

1. **接一个模型。** 选 APIMart 或 Kie.ai，贴一个 Key 就能用；也可以接你自己的中转站、OpenAI 兼容接口或本地 ComfyUI。懒得自己弄？把《[让你的 AI 帮你接入 Nomi](docs/integrate-with-your-agent.md)》丢给 Claude Code 或 Codex。
2. **说你想拍什么。** 直接在 Agent 面板里说，或者从分镜表里的一段故事开始。
3. **挑片、排片、导出。** 留下满意的版本，排好时间轴，导出 MP4。

> **说明：** APIMart 的链接带推荐码。你永远用自己的 Key、按供应商原价直接付钱；Nomi 不代理、不转售任何模型调用，每一家都能换成你自己的接口。

更多：[快速上手](https://nomiaqm.com/quickstart) · [B 站视频教程](https://www.bilibili.com/video/BV1Lf8b6nEjf/) · [对话式接入模型](docs/guide/conversational-model-integration.md) · [用户指南](docs/user-guide.md) · [供应商](docs/provider-integration.md) · [CLI + MCP](docs/guide/capability-core-cli-mcp.md)

## 让你自己的 Agent 来用 Nomi

Nomi 自带 MCP 服务（24 个 MCP 工具）：Claude Code、Codex、Cursor 都能直接驱动它生成、编排、剪辑，顺便用上你会员套餐里送的额度。见《[让你的 AI 帮你接入 Nomi](docs/integrate-with-your-agent.md)》。

## 社区

扫左边的码加入用户群，反馈直接进迭代。群码过期了，或者要做 AGPL 合规的定制开发、部署和长期迭代，加右边的维护者微信 **TZ857886159**。

<p align="center">
  <a href="docs/media/nomi-canvas-group-wechat-2026-10-09.jpg"><img src="docs/media/nomi-canvas-group-wechat-2026-10-09.jpg" alt="Nomi 用户群微信二维码" width="220" /></a>
  &nbsp;&nbsp;
  <a href="docs/media/qingyang-wechat.jpg"><img src="docs/media/qingyang-wechat.jpg" alt="Nomi 维护者微信二维码" width="180" /></a>
</p>

- 提问、分享工作流、看接下来做什么：[GitHub Discussions](https://github.com/aqm857886159/Nomi/discussions)
- 报 bug、提需求：[GitHub Issues](https://github.com/aqm857886159/Nomi/issues)
- 更新和短演示：[B 站](https://www.bilibili.com/video/BV1Lf8b6nEjf/) · [X / Twitter](https://x.com/sdf297417627618)

遇到 bug？代码是开源的——把报错和[这段修 bug 提示词](docs/guide/codex-issue-fix-prompt-en.md)发给 Claude Code 或 Codex，很多问题它能直接帮你改好。大家都会碰到的问题，告诉我们，会并进主线。

## 团队合作

给想把 Nomi 放进真实生产流程的团队：定制开发、系统集成、AGPL 合规部署、长期迭代。[提交项目需求](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml)——表单是公开的，只写不涉密的概要，不要贴密钥、私人联系方式、预算或保密协议内容。

## 开发者

需要 Node.js 20+ 和 pnpm，不需要 Docker 或数据库。

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
corepack enable
pnpm install
pnpm dev
```

```text
electron/    Electron 主进程：本地运行时、文件存储、模型调用
src/         React + Vite + Tailwind 工作台
skills/      Skill Pack v2（见 docs/skill-pack-format.md）
```

常用检查：`pnpm run test` · `pnpm run typecheck` · `pnpm run gates`

## 贡献与许可证

欢迎报 bug、提想法、改文档、写代码。不需要签 CLA，贡献按 AGPL-3.0-only 接收。

当前版本采用 **[AGPL-3.0-only](LICENSE)**；此前以 Apache-2.0 发布的历史版本继续保留原许可证。我们可以收费提供遵守 AGPL 的定制开发、集成、部署、培训和持续迭代，但不提供隐瞒对应源代码的闭源 Nomi 分发版本。

## 关于作者

**青阳** —— AI 产品经理 / 创作者。微信 **TZ857886159**。
