# 让你的 AI 替你接入 Nomi（把这份文档发给你的 agent）

> **你是用户的 agent（Codex / Claude Code / Cursor / 反重力 CLI 等）。用户把这份文档发给你，是想让你替他把某个模型 / 本地 ComfyUI / 技能接进他本机的 Nomi。**
> 请**按下面的流程一步步带用户完成接入**：先问清他要接什么，再照对应章节操作，每一步都告诉他「现在看到什么、下一步点哪里」，最后用「验证成功的标志」确认真的通了。
>
> Nomi 是开源的本地桌面工作台，代码就在用户机器上。凡是本文档没覆盖到、或用户的界面和这里不一致的地方——**读源码，别脑补**。仓库结构见文末「给 agent 的定位提示」。

克隆仓库（用户需要改代码时才要，只接模型用现成安装包即可）：

```bash
git clone https://github.com/aqm857886159/Nomi.git
```

---

## 0. 先问清楚：用户要接的是哪一类？

四条路，对应四种「接自己的东西」的场景。先判断，再跳到对应章节：

| 用户想接的 | 走哪条 | 一句话 |
|---|---|---|
| 一个 OpenAI 兼容 / Anthropic / 中转站的 API（DeepSeek、自建 vLLM、某中转站…） | **§1** | 粘地址 + Key，Nomi 不用重编译 |
| 他本机跑着的 ComfyUI（或云端 ComfyUI） | **§2** | 无 Key 后端，导入「保存」格式工作流 |
| 让你（agent）经 MCP 直接调用 Nomi 做生成 / 编排 | **§3** | 一键接入，之后你说人话就能操作 Nomi |
| 一个技能（skill）扩展 Nomi 的 Agent 能力 | **§4** | 拷进 `skills/` 目录即被发现 |

> **成本视角（贯穿全篇）**：Nomi 的价值是让你**自由组合便宜的生成来源**——中转站批发价、平台限时活动、agent 会员自带的免费生图额度、魔搭一类免费源、本机 ComfyUI，哪个便宜用哪个。再叠加「草稿→参考→精修」的姿势（§5 有推荐组合），单位成本能降到很低。接入这一步就是把这些便宜来源都挂上去。

---

## 1. 接一个自定义 / 中转站供应商（OpenAI 兼容 / Anthropic / Responses）

**适用**：任何暴露标准接口的服务——DeepSeek、通义、你公司自建的 vLLM、任意「API 中转站」。对照源码 `src/ui/onboarding/CustomVendorCard.tsx` 与 `src/ui/onboarding/VendorBaseUrlField.tsx`。

**带用户这样做：**

1. 打开 Nomi → 顶部进入**「模型接入」**（设置里的模型接入抽屉 / OnboardingDrawer）。
2. 找到**「其他模型 / 自定义供应商」**入口，新建一家。每一家会渲染成一张 `CustomVendorCard`。
3. 这张卡的主语是**连接**——卡片顶部就是「接入地址」那一行（`VendorBaseUrlField`），点右侧**「修改」**按钮填地址：
   - 地址必须是 `http(s)://…` 的完整 base URL（校验规则就是 `^https?://\S+$`；结尾的 `/` 会被自动去掉）。填 OpenAI 兼容端点通常填到 `.../v1`。
   - 回车或点「保存」写入。保存后 Nomi 会**自动重新探测连接**（地址一变，健康检查的指纹就变，会自动重探），不用手动点检查。
4. 在同一张卡的**「模型」**区添加 / 启用你要用的模型；类型（图 / 视频 / 文本）如果 Nomi 按模型名猜错了，可以在这里改（`onRetype`）。
5. 该家如果需要 Key，在卡片里填 API Key（Key 按 app 身份加密存在本机，不进任何日志）。

> **卡片胶囊语义**：**连不上压倒一切**。就算参数适配显示「已配置」，只要地址 / Key 不通，卡头会红字覆盖，直接告诉你「够不到」。所以别只看「已配置」，要看连接状态变绿。

**✅ 验证成功的标志：**
- 卡头连接胶囊显示**已连接 / OK**（不是红色的「连不上」）。
- 你启用的模型出现在可用列表里。用 `node scripts/nomi.mjs models` 也能看到它（vendor / modelKey / kind / label）。

---

## 2. 接本机 ComfyUI（当生成后端）

**适用**：用户本机（或云平台）跑着 ComfyUI，想把它当一个便宜 / 免费的生成后端。对照源码 `src/ui/onboarding/ComfyuiLocalCard.tsx` 与 `electron/catalog/comfyuiLocal.ts`。

**关键前提（先讲给用户）**：ComfyUI 是**无 Key** 的本地服务。Nomi 里这家供应商**默认是关的**——因为 99% 的人不跑本地 ComfyUI，开箱就塞一堆会失败的工作流是污染。所以要用户**在「可接入」里显式启用**它。

**带用户这样做：**

1. 先确认 ComfyUI 已启动。默认地址就是 **`http://127.0.0.1:8188`**；跑在别的端口 / 主机（或云平台 ComfyUI，如 cnb.cool、cloudstudio.net）就在卡片的「接入地址」行改成对应 URL——同一张卡、同一条地址，云端只是换个地址，不另起一张卡。
2. 打开 Nomi →「模型接入」→ 找到**「本地 ComfyUI」**卡（`ComfyuiLocalCard`）。
3. **导入工作流**：点卡里的「导入工作流」，贴入工作流 JSON。
   - 支持 ComfyUI 的**普通「保存」（Save）格式**，也支持 API 格式——你从网上下载的工作流能直接导入，不用先手动导出 API 版。
   - Nomi 内置一条**文生图**工作流（ComfyUI 官方默认图），即使不导入也有一条能跑的路。
4. 点**「启用」**。注意：启用会先探一次连接，但工作流要经过一次**规范化生产认证**后，这家和它的模型才真正进入可执行目录（防「保存了就以为能用」）。所以启用后可能显示「等待验证」，走完认证才算数。

> **Nomi 会在你按下运行之前替你把关**：
> - checkpoint 名留空时，Nomi 会去 ComfyUI 的 `/object_info` 取本机第一个 checkpoint 自动填上（旧做法写死一个文件名，没这个文件的人首跑必炸）。
> - 连不上、或 `models/checkpoints` 里一个模型文件都没有——Nomi **提前**报确定性错误（「没连上 ComfyUI…」/「目录里没有任何模型文件…」），不会闷头轮询到超时。
> - 这就是「拿工作流和 `/object_info` 对账、提前告诉你缺什么」的含义。

**✅ 验证成功的标志：**
- 卡片状态从「未启用」变为**「运行中」**，并显示 ComfyUI 版本号。
- 用它跑一次文生图能出图（图会落进项目 `assets/` 目录）。

---

## 3. 让 agent 经 MCP 调用 Nomi（把 Nomi 当你的生成后端）

**适用**：让你（Codex / Claude Code / Cursor）直接操作用户的 Nomi——建项目、排镜头、连参考、真生成图 / 视频 / 文本、跑可恢复的完整制作。这是 Nomi 相对在线平台的结构性差异：**开源本地端天然愿意被 agent 接入，你 agent 会员自带的额度可以直接复用**；在线平台要靠算力赚钱，结构上做不了这件事。

完整参考见 `docs/guide/capability-core-cli-mcp.md`。**带用户这样做：**

1. 打开 Nomi →「模型接入」→**「接入 AI 编程助手」**，选 Claude Code / Codex / Cursor，点接入。
   - Nomi 只会合并它自己的 `nomi` 条目、保留你已有的其它 MCP server，改写前留 `.nomi-backup`。
   - 接入卡会**真正启动配置里的命令做一次握手**，不是「配置里有一行」就显示成功。
   - **不要**照网上手写一份只有 `NOMI_MCP_STDIO=1` 的配置：当前版本会为每个客户端生成本机签名的 `NOMI_MCP_CLIENT` / `NOMI_MCP_CLIENT_PROOF`，绑定这台电脑和这个客户端，不能跨客户端复用、不能写死在公开文档里。缺证明的配置能列工具，但正式付费 Production Run 会被安全地当成 `external` 拦下。
2. 按提示**重启对应客户端**，让它重新加载 MCP 配置。
   - 从旧版本升上来、客户端里 `nomi` 报 `CONNECTION_CLOSED`：多半是配置还指着已迁移的旧入口 `scripts/nomi-mcp.mjs`。**照上面重新接一次**即可（不要手改配置文件）。

**✅ 验证成功的标志：**
- 握手成功后，你的客户端里出现一组 `nomi` 工具（画布 / 文档 / 时间轴 / 素材的语义读写，外加 `nomi_operation_*` 那条零额度的可编辑生成流程）。工具总数**以 `tools/list` 为准**（别再手抄一个数字：面一收敛，抄下来的那个数就成了错的）。想现在就看真实清单，在仓库里跑 `pnpm exec tsx -e "import('./electron/capabilityCore/mcpToolCatalog').then(m=>console.log(m.MCP_TOOL_RESOLVER.list().map(t=>t.name).join('\n')))"`；在客户端里则直接看它列出的 `nomi` 工具。
- 你能跑通：「在 Nomi 里新建项目『咖啡广告』→ 列我有哪些图模型 → 加 3 个镜头 → 把第一个生成出来」。

> **边界（诚实标注，也讲给用户）**：MCP 能建 / 观察 / 控制制作；**方向与样片**这类可逆创意门可由 Nomi 服务端向支持 elicitation 的客户端再次向真人确认。但**预算、逐镜头付费提交、粗剪采用、导出**必须回到 Nomi 由用户明确批准，主进程强制执行——你 agent 无法越权花钱。

---

## 4. 导入一个技能（skill）

**适用**：给 Nomi 的 Agent 加一块方法论 / 能力（如某种分镜规划、某种剪辑套路）。格式规范见 `docs/skill-pack-format.md`。

一个 skill 就是 `skills/<skill-key>/` 下的一个目录，**只有一个必需文件**：

- **`SKILL.md`**：开头是 YAML frontmatter（写给 runtime 的元数据：必填 `name`（小写 kebab，且等于目录名）与 `description`；Nomi 独有的工具白名单 / 模态声明 / playbook 放 `metadata.nomi`），后面是写给 LLM 的方法论正文（建议 ≤200 行）。

这就是 [Agent Skills 标准](https://agentskills.io/specification)的形状，pi / Claude Code / Codex 读的都是它——所以**别人的技能目录拖进来能用，我们的拖出去也能用**。

**带用户这样做：**

1. 拿到 skill（别人分发的通常是一个 zip 或一个 git 目录）。
2. 把整个 `<skill-key>/` 目录**拷贝到仓库的 `skills/` 下**（zip 就先解压）。
3. 启动 / 重启 Nomi（开发态用 `pnpm dev`）。AI 面板里这个 skill 会**自动被发现**。

> 只写 `name` + `description`、不带 `metadata.nomi` 的纯知识层技能照样加载——生态里绝大多数技能就是这样。
> `metadata.nomi` 写坏时 runtime **fail closed**（该技能拿到零工具），并在面板上给出人话原因；主进程日志同时打印 Zod 校验错误。
> 2026-09-07 之前的第二份清单 `skill.json` 已退场；用户目录里的存量由加载器一次性迁移进 frontmatter，原文件留 `.bak` 备份。

**✅ 验证成功的标志：**
- Nomi 的 AI 面板里能看到 / 选到这个 skill。
- 加载没有在主进程日志报 Zod 校验错误。

---

## 5. 推荐组合（把成本打到最低）

给用户一套「便宜出草稿 → 精修出成品」的默认姿势，接入时把这几路都挂上：

**便宜 / 免费生成三件套（按 §1 / §2 接进来）：**
- **agent 会员自带的生图额度**（如你 Codex / 反重力 CLI 账号里的生图 / 生视频额度）——很多是免费或已包含在会员里的，拿来出草图、动作图不心疼。
- **免费 / 低价源**（如魔搭社区的开放模型）——出简易分镜图、批量试。
- **本机 ComfyUI**（§2）——零 API 成本，控制力最强。
- 再叠一家**中转站批发价**（按 §1 接）兜住高质量那一次生成，赶上某平台**限时活动**就临时切过去。

**姿势——草稿→参考→精修：**
1. 用便宜 / 免费模型出分镜草图、动作图、参考视频（反复生成不心疼，一次多出几张）。
2. 挑好的当**参考图 / 参考视频**喂给高质量模型，只在最后一步花贵的额度出成品。
3. 成本结构因此大幅下降，而且过程中随时能调。

**agent 的大脑也接便宜的：**
- 给 Nomi 的 Agent 配一个便宜的 OpenAI 兼容文本模型（如 DeepSeek），按 §1 接入即可——它负责帮你写提示词、拆镜头、做规划这类文本活。

---

## 给 agent 的定位提示（找不到就读代码，别脑补）

- 自定义 / 中转供应商卡：`src/ui/onboarding/CustomVendorCard.tsx`、地址字段 `src/ui/onboarding/VendorBaseUrlField.tsx`、管理块 `src/ui/onboarding/CustomVendorManage.tsx`。
- 本地 ComfyUI 卡：`src/ui/onboarding/ComfyuiLocalCard.tsx`；后端契约 / 默认值 / `/object_info` 对账：`electron/catalog/comfyuiLocal.ts`。
- 内置供应商清单（哪些 host 是内置认得的）：`electron/catalog/builtinVendorSeeds.ts`。
- MCP / CLI 完整流程、工具清单（以 `tools/list` 为准）、故障排查、安全边界：`docs/guide/capability-core-cli-mcp.md`。
- 技能格式：`docs/skill-pack-format.md`。
- 供应商接入通用说明：`docs/provider-integration.md`；使用指南：`docs/user-guide.md`。

界面版本会迭代——**任何一步和你看到的界面对不上，以用户机器上的源码为准**。
