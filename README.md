<p align="center">
  <img src="apps/web/public/nomi-logo.svg" alt="Nomi" width="80" />
</p>

<h1 align="center">Nomi</h1>

<p align="center">
  <strong>写一段剧本，自动生成图片、视频、剪辑成片。</strong><br />
  开源、本地优先、双击即用的 AI 视频创作工作台。
</p>

<p align="center">
  <a href="docs/quickstart.md">快速启动</a>
  ·
  <a href="docs/user-guide.md">使用指南</a>
  ·
  <a href="https://github.com/aqm857886159/Nomi/issues/new/choose">反馈问题</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><img src="https://img.shields.io/github/v/release/aqm857886159/Nomi?style=for-the-badge&label=Download&logo=electron&logoColor=white" alt="Download" /></a>
  <a href="https://github.com/aqm857886159/Nomi/stargazers"><img src="https://img.shields.io/github/stars/aqm857886159/Nomi?style=for-the-badge&logo=github" alt="GitHub stars" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge" alt="License" /></a>
</p>

---

## ⬇️ 下载（双击即用）

不需要懂代码，下载安装包就能用。

| 系统 | 适用机型 | 下载 |
|------|---------|------|
| 🍎 **macOS** | Apple Silicon（M1/M2/M3/M4） | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| 🍎 **macOS** | Intel 芯片 | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| 🪟 **Windows** | Win 10 / 11 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

> **不知道自己是哪种 Mac？** 点左上角苹果图标 → 关于本机 → 看「芯片」一栏。写 M1/M2/M3/M4 → 选 Apple Silicon；写 Intel → 选 Intel。

### ⚠️ 第一次打开有警告？这是正常的

Nomi 还没买代码签名证书（每年要花钱），所以系统会提醒「未知开发者」。一次性绕过方法：

<details>
<summary><b>macOS：提示「无法打开」或「已损坏」</b></summary>

1. 把 `Nomi.app` 拖进「应用程序」文件夹
2. 打开「终端」（在「应用程序 → 实用工具」里），粘贴这一行回车：
   ```bash
   xattr -cr /Applications/Nomi.app
   ```
3. 再双击 Nomi 就能打开了
</details>

<details>
<summary><b>Windows：SmartScreen 拦截</b></summary>

1. 点击警告窗口里的「更多信息」
2. 出现「仍要运行」按钮，点它
3. 以后再打开就不会拦截了
</details>

---

## 🎬 它能做什么

一句话：**写剧本的环节、生图的环节、生视频的环节、剪辑的环节，全部连成一条流水线，AI 帮你跑完。**

```
   剧本     →     画布生成     →     时间轴     →     成片导出
   ↓               ↓                  ↓               ↓
 写一段       自动拆镜头           按顺序排好      导出 WebM
 故事         并行生成图/视频       预览剪辑        本地保存
```

**核心差异**

- 🔗 **全流程打通**：不用在 ChatGPT、即梦、剪映之间来回切，素材自动流转。
- 🏠 **本地优先**：项目、素材、剪辑全在你电脑上，不上传任何素材到我们服务器。
- 🤖 **Agent 驱动**：在终端说一句"把这段剧本拆 6 个镜头并生成"，画布会自己动起来。

---

## 🚀 打开后 3 步出第一条视频

**第 1 步：配一个 AI 大脑（用来写脚本、拆镜头）**

右上角 → 设置 → 模型管理 → 填以下信息：

```json
apiBaseUrl: https://api.deepseek.com/v1
apiKey: 在 https://platform.deepseek.com 注册领，10 块钱够用一周
model: deepseek-chat
```

> 💡 也支持 OpenAI、通义、Ollama 本地模型。任何 OpenAI 兼容接口都能接。

**第 2 步：配一个画图/做视频的模型**

同一个「模型管理」页面 → 添加供应商。推荐起步组合：

- **即梦**（图片，文生图便宜）：[官网](https://www.volcengine.com/product/jimeng)
- **可灵 / Runway**（视频，按生成秒数计费）

详细接入步骤：[docs/provider-integration.md](docs/provider-integration.md)

**第 3 步：写一段故事，让 Agent 跑**

进入「创作区」，写下你想拍的故事，点「让 Agent 帮我拆镜头」。
去倒杯水回来，画布上的图片和视频就生成好了，拖到时间轴 → 导出。

完整使用指南：[docs/user-guide.md](docs/user-guide.md)

---

## 💬 用着用着发现问题？

**这是一个验证阶段的项目，我非常需要你的反馈。**

- 🐛 [报告 Bug](https://github.com/aqm857886159/Nomi/issues/new?template=bug_report.yml)
- ✨ [提需求/吐槽](https://github.com/aqm857886159/Nomi/issues/new?template=feedback.yml)
- 💭 [使用感受闲聊](https://github.com/aqm857886159/Nomi/discussions)

---

## 👨‍💻 开发者：用源码启动

<details>
<summary>展开查看完整开发者指南</summary>

需要 **Node.js 20+**。桌面版内置 SQLite，无需 Docker。

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
corepack enable && pnpm install && pnpm dev:desktop
```

### 项目结构

```
apps/desktop      桌面端（Electron，双击即用，内置 SQLite）
apps/web          Web 工作台（React + Vite）
apps/backend      本地 API（Hono + Prisma）
apps/agents       终端 Agent
packages/schemas  共享协议
```

### 用 AI 协助安装

把这段话发给 Claude Code / Cursor / Codex：

> 帮我在 ~/Desktop 启动 Nomi 桌面项目。仓库地址：https://github.com/aqm857886159/Nomi
> 启动命令：`git clone <url> && cd Nomi && corepack enable && pnpm install && pnpm dev:desktop`
> 不要覆盖任何已有的 .env 或 agents.config.json 文件。

</details>

---

## 关于作者

**青阳** — AI 产品经理 / 创作者

如果你愿意成为第一批种子用户，加我微信 **TZ857886159** 进试用群（我会发版本通知和收集深度反馈）。

<img src="docs/media/qingyang-wechat.jpg" alt="微信二维码" width="140" />

---

Apache-2.0 License · Made with ❤️ in China
