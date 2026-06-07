<p align="center">
  <img src="public/nomi-logo.svg" alt="Nomi" width="80" />
</p>

<h1 align="center">Nomi</h1>

<p align="center">
  <strong>写一段剧本，自动生成图片、视频、剪辑成片。</strong><br />
  开源、本地优先、双击即用的 AI 视频创作工作台。<br />
  <sub>Open-source, local-first desktop app for AI video creation — script → images &amp; video → timeline → export.</sub>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><strong>⬇️ 下载最新版</strong></a>
  ·
  <a href="docs/user-guide.md">使用指南</a>
  ·
  <a href="https://github.com/aqm857886159/Nomi/issues/new/choose">反馈</a>
  ·
  <a href="LICENSE">Apache-2.0</a>
</p>

---

## ⬇️ 下载（双击即用，不用懂代码）

| 系统 | 适用机型 | 下载 |
|------|---------|------|
| 🍎 **macOS** | Apple Silicon（M 系列） | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| 🍎 **macOS** | Intel 芯片 | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| 🪟 **Windows** | Win 10 / 11 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

> 不知道自己哪种 Mac？左上角苹果图标 → 关于本机 → 看「芯片」。

<details>
<summary><b>第一次打开提示「未知开发者 / 已损坏」？</b>（还没买签名证书，正常现象，点开看绕过方法）</summary>

- **macOS**：把 `Nomi.app` 拖进「应用程序」，终端运行 `xattr -cr /Applications/Nomi.app`，再双击打开。
- **Windows**：SmartScreen 弹窗点「更多信息」→「仍要运行」。
</details>

---

## 🎬 它能做什么

把**写剧本 → 生图 → 生视频 → 剪辑**连成一条流水线，AI 帮你跑完，不用在多个工具之间来回搬素材。

```
  剧本    →    画布生成    →    时间轴    →    成片
 写故事      自动拆镜头       吸附剪辑      导出 MP4
            并行生成图/视频    拖播放头预览
```

- 🔗 **全流程打通** — 剧本、生图、生视频、剪辑一条线，素材自动流转，不用在 ChatGPT / 即梦 / 剪映之间切。
- 🔑 **一个 key 全通** — 「模型接入」填一个 key（APIMart / kie），Sora 2 / 可灵 / Seedream 等预置模型立即可用；也可自定义接入任意中转站。
- 🎭 **项目级资产锁一致性** — 角色（多视角参考图）、分镜、风格沉淀成可复用资产，减少多片段里的「脸漂移、风格跑偏」。
- 🎬 **3D 导演台 + 全景图** — 在 3D 场景里摆角色姿势、架机位、设画幅，或生成 360° 全景，截取机位画面当生成参考——文字说不清的构图，直接「搭」出来。
- 🏠 **本地优先** — 项目、素材、剪辑全在你电脑上，不上传任何素材到服务器。

---

## 📸 看一眼

**创作区** — 写故事 / 文案，右侧 AI 助手帮你拆镜头、立角色卡

<img src="marketing/assets/screen-script.png" alt="创作区" width="100%" />

**Mura 画布** — 角色 / 场景 / 镜头 / 素材分层，并行生成、跨节点复用

<img src="marketing/assets/screen-canvas.png" alt="Mura 画布" width="100%" />

---

## 🚀 三步出第一条视频

**1. 接一个模型** — 顶部「模型接入」：

- **最快**：选预置供应商（APIMart / kie），填一个 key → 该家全部模型一键解锁。
- **自定义**：填 BaseURL + Key，点「测试连接」自动识别协议（OpenAI / Responses / Anthropic），不用懂术语。OpenAI / Claude / DeepSeek / 国内中转站都能接。

**2. 写一段故事** — 进「创作区」写下你想拍的内容，点「拆镜头」让 Agent 跑。

**3. 生成 → 导出** — 画布上的图片 / 视频生成好后，拖到时间轴，导出 MP4。

> 完整指南：[docs/user-guide.md](docs/user-guide.md) · 模型接入细节：[docs/provider-integration.md](docs/provider-integration.md)

---

## 💬 反馈

验证阶段的项目，很需要你的反馈：[报 Bug](https://github.com/aqm857886159/Nomi/issues/new?template=bug_report.yml) · [提需求](https://github.com/aqm857886159/Nomi/issues/new?template=feedback.yml) · [闲聊](https://github.com/aqm857886159/Nomi/discussions)

---

## 👨‍💻 开发者

<details>
<summary>用源码启动</summary>

需要 **Node.js 20+**，无需 Docker / 数据库。

```bash
git clone https://github.com/aqm857886159/Nomi.git
cd Nomi
corepack enable && pnpm install && pnpm dev
```

```
electron/    主进程 + 本地运行时（Agent、文件存储、模型调用）
src/         前端工作台（React + Vite + Tailwind）
skills/      Skill Pack v2（见 docs/skill-pack-format.md）
```
</details>

---

## 关于作者

**青阳** — AI 产品经理 / 创作者。愿意当种子用户的话，加微信 **TZ857886159** 进试用群。

<img src="docs/media/qingyang-wechat.jpg" alt="微信二维码" width="140" />

---

Apache-2.0 License · Made with ❤️ in China
