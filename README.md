<p align="center">
  <img src="public/nomi-logo.svg" alt="Nomi" width="80" />
</p>

<h1 align="center">Nomi</h1>

<p align="center">
  <strong>把你脑子里的画面，精确传达给 AI。</strong><br />
  本地优先、开源的 AI 导演工作台——3D 摆构图、定妆锁身份、运镜控节奏，从一句想法到一条成片，都在同一处。<br />
  <sub>Open-source, local-first AI director's workspace — compose in 3D, lock character identity, direct camera moves; script → storyboard → images &amp; video → timeline → export.</sub>
</p>

<p align="center">
  <a href="https://nomiaqm.com"><strong>🌐 官网</strong></a>
  ·
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><strong>⬇️ GitHub 下载</strong></a>
  ·
  <a href="https://pan.quark.cn/s/d3322c17e7b6"><strong>📦 网盘下载</strong></a>
  ·
  <a href="docs/user-guide.md">使用指南</a>
  ·
  <a href="https://github.com/aqm857886159/Nomi/issues/new/choose">反馈</a>
</p>

<p align="center">
  <a href="https://github.com/aqm857886159/Nomi/stargazers"><img src="https://img.shields.io/badge/GitHub-%E2%AD%90%20Star-2563eb?logo=github&logoColor=2563eb&labelColor=f1f5f9" alt="Star on GitHub" /></a>
  <a href="https://github.com/aqm857886159/Nomi/releases/latest"><img src="https://img.shields.io/badge/release-v0.15.0-2563eb?labelColor=f1f5f9" alt="Latest release" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows-2563eb?labelColor=f1f5f9" alt="Platform" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-2563eb?labelColor=f1f5f9" alt="License" /></a>
</p>

---

## ⬇️ 下载（双击即用，不用懂代码）

| 系统 | 适用机型 | 下载 |
|------|---------|------|
| 🍎 **macOS** | Apple Silicon（M 系列） | [Nomi-mac-arm64.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-arm64.dmg) |
| 🍎 **macOS** | Intel 芯片 | [Nomi-mac-intel.dmg](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-mac-intel.dmg) |
| 🪟 **Windows** | Win 10 / 11 | [Nomi-windows-setup.exe](https://github.com/aqm857886159/Nomi/releases/latest/download/Nomi-windows-setup.exe) |

> 不知道自己哪种 Mac？左上角苹果图标 → 关于本机 → 看「芯片」。
>
> 🇨🇳 **打不开 GitHub / 下载慢？用夸克网盘**（当前 v0.15.0）：<https://pan.quark.cn/s/d3322c17e7b6>　·　🌐 也可上[官网](https://nomiaqm.com)自动识别系统下载。

<details>
<summary><b>第一次打开提示「未知开发者 / 已损坏」？</b>（还没买签名证书，正常现象，点开看绕过方法）</summary>

- **macOS**：把 `Nomi.app` 拖进「应用程序」，终端运行 `xattr -cr /Applications/Nomi.app`，再双击打开。
- **Windows**：SmartScreen 弹窗点「更多信息」→「仍要运行」。
</details>

---

## 🎬 这是什么

**「我知道我想要什么，但 AI 老是理解错。」** Nomi 就是来解决这件事的。

你用大白话描述想拍什么，AI 当你的副导演，把**写故事 → 拆镜头 → 生图 → 生视频 → 剪辑成片**整条线跑下来。但 Nomi 真正的不同，是给你一套**把意图精确喂给模型**的工具：在 3D 里摆好构图和机位、给角色定妆锁住身份、用轨迹控制运镜——这些「文字说不清」的东西直接搭出来当参考，而不是和模型来回猜。

```
  故事     →     拆镜头      →     画布生成      →    时间轴    →    成片
 写想法       AI 出分镜方案     并行生成图/视频      吸附剪辑      导出 MP4
            (镜头/角色/提示词)   跨节点复用素材     拖播放头预览
```

它跟「网页版生成器」最大的不同：**一个完整、本地、可掌控的导演工作台**——不用在 ChatGPT / 即梦 / 剪映之间来回搬素材，剧本、画布、3D 导演台、时间轴在一处串起来，素材自动流转，项目和文件都在你自己电脑上。

---

## ✨ 它能做什么

- 🤖 **AI 拆镜头 + 排片** — 写完故事点一下，AI 拆成一份**可改的分镜方案**（镜头 / 角色 / 提示词逐项可编辑）；你确认后自动铺到画布、规划「角色定妆 → 关键帧 → 视频」的生成顺序，还能按镜序排上时间轴。跨次打开它也记得这个项目聊过什么。
- 🎬 **3D 导演台 + AI 运镜** — 在 3D 场景里摆角色姿势、架机位、设画幅，截机位画面当参考；也能让 AI 按你的描述自动搭好站位。**文字说不清的构图，直接「搭」出来**，锁住跨镜头的空间关系。再用一句话描述运镜，AI 沿相机轨迹渲一段运镜小片喂给视频模型，把镜头运动复刻到成片上。还能**文生 3D / 图生 3D**（混元 / Meshy / HiTem3D）直接生成 3D 模型资产。
- 🎨 **画布上直接修图，不用导去 PS** — 生成的图当场就能改：**抠图换背景、把元素拆出来单独调、改图里的文字**（对标 Lovart 的元素 / 文字编辑），还能往画布粘贴、派生新版本。素材一多，用「**找素材**」一键按成片 / 参考自动分组、缩略图识别，秒找到要的那张。
- 🔗 **一键接入 Claude Code / Codex / Cursor** — Nomi 的创作能力抽成了一个**无头能力核**（MCP）；在「模型接入」面板一键写好接入，让编程助手用对话直接指挥 Nomi 建项目、加节点、连参考、触发生成——Nomi 里所见即所得。
- 🔑 **一个 key、十几个模型全通** — 「模型接入」填一个 key（APIMart / kie），视频 **Sora 2 / Veo 3.1 / 可灵 / Seedance / Wan / Hailuo**、图像 **Seedream / Nano Banana / GPT Image / Qwen / Imagen** 等预置模型立即可用，**文生 / 图生 / 首尾帧补间 / 多图参考**模式齐全，同款模型的**标准 / 快速 / Pro 变体**一处切换；也可自定义接入任意中转站。
- 🎫 **有即梦高级会员？用会员积分直接出片（不用 API key）** — 接入即梦官方 CLI，扫码登录就能用会员积分跑 **Seedance 2.0 视频**（文生 / 图生 / 首尾帧 / 全能参考 / 多帧）和**即梦图片**（文生图 3.0–5.0 / 改图 / 超清），零额外 API 费。走官方授权、不碰逆向、不存密码。<sub>注：即梦 CLI 生成仅「高级会员（maestro vip）」可用。</sub>
- 🎭 **项目级资产锁一致性** — 角色（多视角参考图）、分镜、风格沉淀成可复用资产，减少多片段里的「脸漂移、风格跑偏」。
- ✍️ **提示词库 + AI 优化** — 内置起步提示词直接送上画布；写得糙的提示词一键 AI 优化，改动**高亮可对比、确认再应用**，不黑箱。
- 🔗 **全流程打通 & 本地优先** — 从剧本到成片一条线，素材自动流转；项目、素材、剪辑全在你电脑上，不上传任何素材到服务器。

---

## 📸 看一眼

**▶ 这是用 Nomi 做出来的** — 想法 → 3D 构图 → 生成 → 成片。[看 46 秒完整演示视频](https://nomiaqm.com/assets/demo.mp4)

<img src="marketing/assets/demo.gif" alt="Nomi 生成的视频片段" width="100%" />

**Mura 画布** — 角色定妆 / 场景 / 镜头分层，并行生成、跨节点复用参考，下方就是吸附剪辑的镜头时间轴

<img src="marketing/assets/screen-canvas.png" alt="Mura 画布" width="100%" />

**3D 导演台** — 摆人偶姿势、架机位、设画幅，截机位画面当生成参考，锁住跨镜头的空间关系

<img src="marketing/assets/screen-3d.png" alt="3D 导演台" width="100%" />

**创作区** — 写故事 / 文案，右侧 AI 助手帮你拆镜头、立角色卡

<img src="marketing/assets/screen-script.png" alt="创作区" width="100%" />

---

## 🚀 三步出第一条视频

**1. 接一个模型** — 顶部「模型接入」：

- **最快**：选预置供应商（APIMart / kie），填一个 key → 该家全部模型一键解锁。
- **自定义**：填 BaseURL + Key，点「测试连接」自动识别协议（OpenAI / Responses / Anthropic），不用懂术语。OpenAI / Claude / DeepSeek / 国内中转站都能接。

**2. 写一段故事** — 进「创作区」写下你想拍的内容，点「拆镜头」让 AI 跑。

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

<details>
<summary>用 Claude Code / 编程助手在本地驱动 Nomi（能力核）</summary>

Nomi 的创作能力也抽成了一个**无头能力核**（CLI / MCP），可以被 Claude Code 等编程助手在本地直接调用——建项目、加节点、连参考、触发生成都能用对话指挥。在 App 内「模型接入」面板有「一键接入 Claude Code」卡片，零配置写好接入；细节见 [docs/capability-core-guide.md](docs/capability-core-guide.md)。
</details>

---

## 关于作者

**青阳** — AI 产品经理 / 创作者。愿意当种子用户的话，加微信 **TZ857886159**（长期有效）拉你进群。

<img src="docs/media/qingyang-wechat.jpg" alt="青阳的个人微信二维码" width="140" />

**📅 本周「nomi 画布群」** — 直接扫码进群（微信群码 **7 月 5 日前有效**；过期请加上方个人微信拉你进）。

<img src="docs/media/nomi-canvas-group-wechat.png" alt="nomi 画布群二维码（本周有效）" width="140" />

---

Apache-2.0 License · Made with ❤️ in China
