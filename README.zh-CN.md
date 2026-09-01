<p align="center">
  <img src="public/nomi-logo.svg" alt="Nomi" width="80" />
</p>

# Nomi

**把 AI 视频的成本打下来。**

Nomi 是一个开源、本地优先的 AI 视频创作桌面工作台。用你已有的模型、会员额度、API 或本机 ComfyUI，从脚本、分镜、生成到剪辑跑通全流程——素材、生成物、工作流全在你自己电脑上。不用注册，没有埋点。

[English](README.md) · [官网](https://nomiaqm.com/) · [下载](#下载) · [B 站视频教程](https://www.bilibili.com/video/BV1Lf8b6nEjf/) · [夸克网盘镜像](https://pan.quark.cn/s/d3322c17e7b6) · [让 AI 替你接入](docs/integrate-with-your-agent.md) · [加入用户群](#用户群) · [团队合作](#团队服务) · [看 60 秒宣传片](https://nomiaqm.com/assets/demo.mp4) · [X/Twitter](https://x.com/sdf297417627618)

[![最新版本](https://img.shields.io/github/v/release/aqm857886159/Nomi?label=release)](https://github.com/aqm857886159/Nomi/releases/latest)
![平台](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-1a1816)
[![许可证](https://img.shields.io/badge/license-AGPL--3.0--only-1a1816)](LICENSE)

## 微信联系

<p align="center">
  <a href="docs/media/nomi-canvas-group-wechat-2026-09-01.jpg"><img src="docs/media/nomi-canvas-group-wechat-2026-09-01.jpg" alt="Nomi 用户群微信二维码" width="220" /></a>
  &nbsp;&nbsp;
  <a href="docs/media/qingyang-wechat.jpg"><img src="docs/media/qingyang-wechat.jpg" alt="Nomi 作者青阳的微信二维码" width="180" /></a>
</p>

<p align="center">
  <strong>扫码加入 Nomi 用户群</strong>（左，反馈会直接进入产品迭代）。<br />
  群码失效，或沟通遵守 AGPL 的定制开发、部署与持续迭代，请添加作者微信（右）<strong>TZ857886159</strong>。
</p>

[![Nomi 导演工作流](marketing/assets/video/hero-poster.jpg)](https://nomiaqm.com/assets/demo.mp4)

## 为什么是 Nomi

大量批量做 AI 视频的人，和想把 AI 视频用起来的公司，越来越需要一个**开源、本地**的画布项目。三个原因：

**① 成本**——AI 视频真正的大头是生成费。Nomi 让你**自由组合便宜的生成来源**：中转站的批发价、平台的限时活动、agent 会员自带的免费生图额度、魔搭一类免费源、你本机的 ComfyUI——哪个便宜用哪个。再叠加「草稿→参考→精修」的姿势：用便宜 / 免费的模型出分镜草图、动作图、参考视频（反复生成不心疼），挑好的当参考喂给高质量模型只在最后一步花贵额度出成品。单位成本因此大幅下降。

**② 定制**——代码开源。用你自己的 Codex / Claude Code 把它改成你要的样子、加你自己的 skills；公司可以把它定制成一套自家的内部 AI 视频平台，整个团队的成本随之下降。

**③ 本地**——素材、生成物、工作流、模型接入全在你本机，更安全。用外部模型 API 时，只有完成任务所必需的输入才会发给你配置的供应商。

还有一个结构性差异：**把 Nomi 当你 agent 的生成后端**。让 Codex / Claude Code 经 MCP 直接调用 Nomi 做生成、编排、剪辑，你 agent 会员自带的额度可以直接复用。在线平台靠算力赚钱，结构上做不了这件事；开源本地端天然愿意被 agent 接入。

## 怎么接你自己的东西

「接自己的很麻烦」是唯一的大痛点。Nomi 给两条路：

**① 开箱即用**——内置 **APIMart** 与 **Kie.ai** 双核心，另有约 10 家可直接用的供应商（魔搭、火山、Runway、fal、Replicate、MiniMax、ElevenLabs 等）；旗舰模型有持续扩充的接入认证台账（当前 66 条认证条目）。任何 OpenAI 兼容 / Anthropic / Responses / 中转接口，粘贴地址和密钥就能加，不用重新编译。本机 ComfyUI 和云端模型一样是一个供应商：Nomi 会转换 ComfyUI 常规「保存」格式的工作流，你从网上下载的工作流能直接导入；并且会拿工作流和 `/object_info` 对账，在你按下运行之前就告诉你缺哪些自定义节点和模型文件。

**② 让你的 AI 替你接**——你不用自己啃接入。把仓库克隆下来，把 **[《让你的 AI 替你接入 Nomi》](docs/integrate-with-your-agent.md)** 这份文档发给你的 Codex / Claude Code，告诉它你要接什么（某个中转站、DeepSeek、本机 ComfyUI…），它会照文档一步步带你接完。文档覆盖四条路：自定义 / 中转供应商、本机 ComfyUI、MCP 被 agent 调用、技能导入，每条都写了「验证成功的标志」和一个把成本打到最低的推荐组合。

## 下载

| 系统 | 适用机型 | 下载 |
|---|---|---|
| macOS | Apple Silicon（M 系列） | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| macOS | Intel 芯片 | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| Windows | Windows 10 / 11 x64 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

🇨🇳 GitHub 打不开或下载慢：[夸克网盘镜像](https://pan.quark.cn/s/d3322c17e7b6)。最新版本以 [GitHub Releases](https://github.com/aqm857886159/Nomi/releases/latest) 和 [官网](https://nomiaqm.com/)为准。

当前仅提供 macOS arm64/x64 与 Windows x64 安装包。

### 在 macOS 上第一次打开

当前 macOS 安装包**未使用 Apple Developer ID 签名，也未经过 Apple 公证**，所以第一次打开时可能被系统拦截。请只使用上表直链、Nomi 官网或 Nomi GitHub 官方仓库提供的下载链接。

1. 下载对应的 DMG，把 `Nomi.app` 拖进“应用程序”。
2. 在 Finder 的“应用程序”中右键 `Nomi.app`，选择“打开”，再确认“打开”。
3. 如果仍被拦截，打开“系统设置”→“隐私与安全”，找到 Nomi 的提示后点击“仍要打开”。

仅当 macOS 提示 Nomi“已损坏”时，先确认安装包来自 Nomi 官方链接，再打开“终端”运行：

```bash
xattr -dr com.apple.quarantine "/Applications/Nomi.app"
```

不需要、也不要全局关闭 Gatekeeper。升级时需下载对应 DMG 后手动替换 `/Applications/Nomi.app`。

### 在 Windows 上第一次打开

Windows 安装包未使用 Authenticode 签名。SmartScreen 弹窗选择“更多信息”→“仍要运行”。

## 三步开始

1. **接入模型**：选择预置供应商并填写一个 Key，或添加自己的 OpenAI / Responses / Anthropic 兼容接口。接自己的东西很麻烦？把 [《让你的 AI 替你接入 Nomi》](docs/integrate-with-your-agent.md) 发给你的 Codex / Claude Code，让它替你接。
2. **说出镜头意图**：写一个故事或一句镜头描述，让 Nomi 或已接入的 AI 助手生成可编辑的分镜与画布方案。
3. **导演并导出**：检查视觉锚点，用自己配置的模型生成图片或视频，选择结果、排上时间线并导出 MP4。

> **利益披露**：预置供应商中有一家（APImart）的注册链接带推广码。你始终用自己的密钥、按供应商原价直接付给他们——Nomi 不代理、不转售任何推理服务，任何一家供应商都可以换成你自己的接口。

详细说明：[让你的 AI 替你接入](docs/integrate-with-your-agent.md) · [使用指南](docs/user-guide.md) · [模型接入](docs/provider-integration.md) · [英文 Codex / Claude Code 接入提示词](docs/guide/model-integration-prompt-en.md) · [对话式模型接入](docs/guide/conversational-model-integration.md) · [CLI + MCP 指南](docs/guide/capability-core-cli-mcp.md)

## 反馈与共建

Nomi 是我一个人在做，迭代很快——功能上得快，偶尔也带点毛边，但都是真的在往前跑，代码提交一直没停。

- **遇到问题，可以先让你的 AI 帮你解**：代码是开源的，把报错和 [Codex 修复提示词](docs/guide/codex-issue-fix-prompt-en.md) 一起发给你的 Codex / Claude Code，很多问题它能直接帮你改。
- **通用的问题告诉我，我直接迭代掉**：进[用户群](#用户群)或提 [Issue](https://github.com/aqm857886159/Nomi/issues) 说一声，凡是大家都会碰到的，我会直接修进主线。
- 欢迎提 Bug、需求、文档和代码 —— 见下方[贡献与许可证](#贡献与许可证)。

## 社区与联系

微信群与作者二维码在 README 首屏（[群二维码](docs/media/nomi-canvas-group-wechat-2026-09-01.jpg) · [作者二维码](docs/media/qingyang-wechat.jpg)，或直接加微信 **TZ857886159**）。

[参与 GitHub Issues](https://github.com/aqm857886159/Nomi/issues) · [提交商务咨询](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml) · 邮箱：**2373272608@qq.com** · [入门讲解视频（YouTube，中文）](https://www.youtube.com/watch?v=NugvKQjN22A) · [X/Twitter](https://x.com/sdf297417627618)

## 团队服务

如果你想把 Nomi 用在内部 AI 视频工作台、客户项目或垂直行业流程，我们可以按 AGPL 合规方式从首次验证一直做到上线后的持续迭代：

- 定制开发
- 系统与模型集成
- AGPL 合规部署
- 持续优化、维护与迭代

[提交商务咨询](https://github.com/aqm857886159/Nomi/issues/new?template=business_inquiry.yml)，或添加作者微信 **TZ857886159**（[查看个人微信二维码](docs/media/qingyang-wechat.jpg)）。GitHub Issue 是公开页面，请勿填写密钥、私人联系方式、预算明细或受 NDA 保护的材料。

## 用户群

欢迎加入“nomi 画布群”，反馈会直接进入产品迭代。

群二维码已放在 README 首屏；也可以[打开群二维码原图](docs/media/nomi-canvas-group-wechat-2026-09-01.jpg)。二维码不可用时，添加作者微信 **TZ857886159** 拉你进群。

## 开发者

需要 Node.js 22.19+ 与 pnpm，无需 Docker 或数据库。

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
corepack enable
pnpm install
pnpm dev
```

```text
electron/    Electron 主进程、本地运行时、文件存储与模型调用
src/         React + Vite + Tailwind 工作台
skills/      Skill Pack v2，详见 docs/skill-pack-format.md
```

提交前运行：

```bash
pnpm run test
pnpm run typecheck
pnpm run gates
```

## 贡献与许可证

欢迎提交 Bug、需求、文档和代码。贡献者不需要签署 CLA，贡献按 AGPL-3.0-only 接受。

当前版本采用 **[AGPL-3.0-only](LICENSE)**；此前以 Apache-2.0 发布的历史版本继续保留原许可证。我们可以收费提供遵守 AGPL 的定制开发、集成、部署、培训和持续迭代，但不提供隐瞒对应源代码的闭源 Nomi 分发版本。

## 关于作者

**青阳** — AI 产品经理 / 创作者

[打开作者微信二维码原图](docs/media/qingyang-wechat.jpg)，或直接添加微信 **TZ857886159**。
