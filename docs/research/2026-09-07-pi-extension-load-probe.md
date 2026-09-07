# pi 扩展「实装试加载」探针（2026-09-07）

> 状态：📎 交接/日志 —— **只探针不改码，一行产品代码未动。**
> 日期：2026-09-07 · 基线：`origin/main@35d444a7b` · 依赖：`@earendil-works/pi-{coding-agent,agent-core,ai}@0.85.1`（`package.json:202-204`）· Node v24.13.1 · 平台 darwin 25.5.0
> 上游问题：2026-09-07 用户原话 —— **「pi 生态做了很多东西，我们为什么不能直接借用、坐在他们的生态上快速提升？」**
> 前置：[`docs/research/2026-09-07-pi-package-ecosystem.md`](2026-09-07-pi-package-ecosystem.md)（生态调研，读文档与 registry）· [`docs/plan/2026-09-07-agent-runtime-rebuild.md`](../plan/2026-09-07-agent-runtime-rebuild.md) §2.1 分层图（⑤ Lane 宿主 / ⑦ 工具投影）
> 与前置的分工：前置那篇**读文档下判断**；这一篇**真装真跑**，把「扩展这一档」从「按文档推测」升级成「实跑证据」。前置 §4.1 的结论（代码一行不借）在这里被证据推翻了一半、又被另一半证据加固——见 §6。

---

## 0. 一句话先答

**pi 的扩展 API 是可以在 agent-core 之外挂进来的，我实测挂进去并跑通了；但它带进来的不是「工具」，是「一个拿着我们整个进程的第二个宿主」。**

三条实跑事实压住这个判断：

1. **能挂**：`@earendil-works/pi-coding-agent` 的 **public entrypoint 直接导出** `discoverAndLoadExtensions` / `ExtensionRunner` / `wrapRegisteredTool(s)`（`dist/index.d.ts:8`）。我用它把生态里三个头部扩展（周下载 252k / 132k / 8.5k）注册的 6 个工具，挂进了一个**光秃秃的 `AgentHarness`**（就是 `laneHost.mts:69` 那个形状），一个 patch 都没打。
2. **闸拦得住工具**：我们的 `before_tool` 钩子**原封不动地拦住了第三方扩展注册的工具**——被拒的理由一字不改成了那次调用的 tool result（`isError:true`），扩展的 `execute` 一次都没跑。
3. **闸拦不住扩展本身**：扩展代码在 **factory 阶段**就以完整进程权限执行了——我写的探针扩展**一个工具都没注册**，照样在加载那一刻读到了 `process.env` 里的假密钥、发出了网络请求、写了文件。`before_tool` 在这条路上根本不存在。

**判定（R20 三问）**：**不借代码**（②的能力我们已经有，③是净新增的攻击面）；**借的是那 26 个方法的形状**（把 pi 的 `ExtensionActions` 当成「宿主该向工具暴露什么」的现成清单）；**技能那条要借得比想象中小心**——生态头部技能包的正文里有 96 处引用**跑出了它自己声明的技能根目录**（§5）。

---

## 1. 方法与证据边界

**跑在哪**：临时目录 `/private/tmp/pi-ext-probe-lab`，`npm install --ignore-scripts --legacy-peer-deps`。**没有装进仓库，没有碰用户的 `~/.pi`**——每次加载都把 `agentDir` 显式指向 `/private/tmp/pi-ext-probe-lab/fake-agent-dir`（为什么必须显式，见 §3.4）。

**选了哪三个包**（按前置调研 §3.3 的分桶，各取该桶里下载量最高的**非 UI** 包）：

| 桶 | 包 | 版本 | 周下载（前置 §3.2 窗口） | 盘上体量 |
|---|---|---|---|---|
| 工具类 | `pi-web-access` | 0.28.0 | 132 228 | 67 个 `.ts` / 7.4 MB |
| hooks·审批类 | `@gotgenes/pi-permission-system` | 31.1.1 | 8 568 | 153 个 `.ts` / 1.9 MB |
| MCP 桥 | `pi-mcp-adapter` | 2.32.1 | 252 501 | 76 个 `.ts` / 3.0 MB |
| （§5 另加）技能包 | `bigpowers` | 2.88.2 | 17 545 | —— |

**没做的**：没跑真模型（本探针一次付费额度都没花，模型是一个本地脚本化的假 provider，见 §4.2）；没验 Electron 打包环境下的 `jiti` 行为（探针跑在裸 Node，见 §7 未决项）；没读这三个包的全部源码，只按签名与实跑现象取证。

**引用格式**：`node_modules/@earendil-works/` 下一律相对该目录；仓库侧相对仓库根；探针脚本给临时绝对路径。

---

## 2. 问题一：扩展 API 住在哪

### 2.1 形状：一个函数、一张 API 桌子

扩展就是一个函数：

```ts
export type ExtensionFactory = (pi: ExtensionAPI) => void | Promise<void>;
```
`dist/core/extensions/types.d.ts:1159`

`pi` 这张桌子上有 **37 个 `on(event, handler)` 重载 + 约 30 个动作方法**（`types.d.ts:906-1158`）。与我们直接相关的三个：

| 面 | 出处 | 与 Nomi 的对应 |
|---|---|---|
| `registerTool<TParams extends TSchema>(tool: ToolDefinition)` | `types.d.ts:944` | 方案 ⑦ 工具投影的对偶：pi 让**扩展**造工具，我们让**能力契约**派生工具 |
| `ToolDefinition`（`name/label/description/promptSnippet/promptGuidelines/parameters(TypeBox)/prepareArguments/executionMode/execute/renderCall/renderResult`） | `types.d.ts:343-377` | 与 `AgentTool` 几乎同构，只多了两个 TUI 渲染回调 |
| `on('tool_call', …)` → `ToolCallEventResult` | `types.d.ts:939` | 与 agent-core 的 `before_tool` 是**两层不同的闸**（§4.4） |

### 2.2 它依赖 coding-agent 运行时的哪些对象

加载与执行是**两件事**，依赖面差得很远：

| 阶段 | 需要什么 | 出处 / 实跑 |
|---|---|---|
| **加载**（factory 跑完、拿到 `Extension.tools`） | 只要 `cwd` + `agentDir` + 一个 `ExtensionRuntime`（`createExtensionRuntime()` 造，里面全是**会抛的 stub**） | `loader.d.ts:12`、`:22`；实跑 §3.1 |
| **包成 AgentTool** | `wrapRegisteredTool(registeredTool, runner)` —— 需要一个 `ExtensionRunner` | `wrapper.js:12`，内部只用 `runner.createContext()` 与 `runner.getActiveTools()` |
| **`ExtensionRunner` 本身** | `constructor(extensions, runtime, cwd, sessionManager: SessionManager, modelRegistry: ModelRegistry)` | `runner.d.ts:102` |
| **`SessionManager`** | **构造函数是 private**（`session-manager.d.ts:196`），只能走静态工厂 `create` / `inMemory` / `open` / `continueRecent` / `forkFrom`（`:319`、`:334`、`:326`、`:332`、`:342`） | 实跑 §3.2 第一次就撞在这 |
| **`ModelRegistry`** | `constructor(runtime: ModelRuntime)`（`model-registry.d.ts:22`）——`ModelRuntime` 我们已经在用（`electron/harness/runtime/pi/model.mts:64`） | —— |
| **真正执行工具时** | `runner.bindCore(actions, contextActions)` 必须先调用过，否则扩展调 `pi.appendEntry` 之类会抛 `Extension runtime not initialized`（`loader.js:136-148`） | 实跑 §3.5 —— **这条是文档里没有、只能跑出来的** |
| **TUI** | **不需要**。三个包都 `peerDependencies` 写了 `@earendil-works/pi-tui`，但加载与执行全程没有要求终端 | 实跑 §3.1、§3.5 |

**桌子有多大**：一个「完整适配层」要实现 `ExtensionActions` **14 个方法**（`types.d.ts:1246-1261`）+ `ExtensionContextActions` **12 个方法**（`:1266-1279`），共 **26 个**（交互模式还有 `ExtensionCommandContextActions`，非交互可不给）。

### 2.3 agent-core 有没有对应的挂载点：没有

```
$ grep -rn 'registerTool\|ExtensionAPI\|InlineExtension' node_modules/@earendil-works/pi-agent-core/dist --include='*.d.ts' | wc -l
0
```

`pi-agent-core` 里**一处都没有**。它只有 `AgentHarnessOptions.tools: AgentHarnessTool[]`（`harness/agent-harness.d.ts:617-635`）与 `HookMap`（`:485`）。

**所以答案是硬的：扩展 API 只住在 `pi-coding-agent`，agent-core 侧没有对偶。** 想要扩展，就必须把 `pi-coding-agent` 拉进主进程——而方案 §2.1 的 ⑥ 层写死的是 `pi-agent-core`。这不是「多装一个包」，是**多引入一个宿主**：`SessionManager`（第二份会话持久化）、`ModelRegistry`、`ExtensionRunner` 全都会跟着进来，而 `session-persistence` 正是 `check:framework-boundary` 已经罩住 `electron/agentLane/` 的那条 scope。

---

## 3. 问题二：实装试加载（每一步断在哪）

探针脚本：`/private/tmp/pi-ext-probe-lab/probe-{a,b,c,d,e}-*.mjs`。

### 3.1 步骤 1 —— 加载：一次过

```
$ node probe-a-load.mjs
EXT pi-web-access/index.ts tools= [ 'web_search', 'source_check', 'fetch_content', 'get_search_content' ]
    handlers= [ 'session_start', 'session_tree', 'session_shutdown' ] cmds= [ 'websearch', 'curator', 'google-account', 'search' ]
EXT @gotgenes/pi-permission-system/src/index.ts tools= []
    handlers= [ 'session_start', 'resources_discover', 'session_shutdown', 'before_agent_start', 'input', 'tool_call' ]
    cmds= [ 'permission-system' ]
EXT pi-mcp-adapter/index.ts tools= [ 'mcpScript', 'mcp' ]
    handlers= [ 'session_start', 'input', 'session_shutdown', 'tool_result' ] cmds= [ 'mcp', 'pi-mcp', 'mcp-auth' ]
runtime keys: 23
```

**0 个错误**，没要 TUI，没要 `pi` CLI。三个包的 `pi.extensions` 都指向 **`.ts` 源文件**，由 `jiti` 现场转译（转译产物落 `$TMPDIR/jiti/*.mjs`，见 §4.3）。

一个坑：`discoverAndLoadExtensions` 的 `configuredPaths` **按 `cwd` 解析相对路径**（`loader.js:631`）。第一次传相对路径全部 `Cannot find module`——不是包坏了，是我把路径写成了相对当前进程 cwd。

### 3.2 步骤 2 —— 造 `ExtensionRunner`：第一次断在这

```
STOP ExtensionRunner ctor: Cannot read properties of undefined (reading 'startsWith')
```

`new SessionManager(cwd)` 不成立——**private constructor**（`session-manager.d.ts:196`）。改成 `SessionManager.inMemory(cwd)` + `new ModelRegistry(await ModelRuntime.create({credentials, modelsPath:null, allowModelNetwork:false, refreshOnCreate:false}))` 之后过：

```
OK   runner built; 6 registered tools
```

**这一步就是「借扩展」的真实门票**：要 `ExtensionRunner`，就要 `SessionManager`（coding-agent 自己那套 JSONL 会话，**不是** agent-core 的 `Session`）。方案 ⑥ 层用的是 `JsonlSessionRepo`（`laneSession.mts:13`）。两者同时在场 = 同一个进程里两份会话持久化，直撞不变量 **I2「转录只有一份落盘」**。

### 3.3 步骤 3 —— 包成 `AgentTool`：一次过

```
OK   names=web_search,source_check,fetch_content,get_search_content,mcpScript,mcp
OK   has TypeBox params? true
```

`wrapRegisteredTool` 内部就是 12 行的 `wrapToolDefinition`（`core/tools/tool-definition-wrapper.js:2-13`）+ 一段把 `getActiveTools()` 前后差集塞进 `result.addedToolNames` 的逻辑（`wrapper.js:22-31`）。**注意后半段**：扩展工具执行完可以让活跃工具集**变大**——这正是 conformance G-09 那条动态装载的机制，也是 §4.4 那条闸的漏洞形状。

### 3.4 步骤 4 —— 挂进 `AgentHarness`：一次过，但有一个 fail-open

```
OK   AgentHarness.create accepted extension-registered tools
```

按 `laneHost.mts:69-76` 的形状（`session` = agent-core `MemorySessionRepo`、`models` = `createModels` + `setProvider`、`tools` = 上一步的 6 个），`AgentHarness.create` **原样收下**了第三方扩展注册的工具。工具形状这一层是真的通的。

**但这里有一条必须写进任何未来方案的 fail-open**：`discoverAndLoadExtensions(paths, cwd, agentDir?)` 的第三个参数**可以省**，省掉就默认 `getAgentDir()` = `~/.pi/agent`（`config.js:421-427`），而它**无条件扫** `<cwd>/.pi/extensions` 与 `<agentDir>/extensions`（`loader.js:623-628`）。也就是说：**如果 Nomi 哪天调了这个函数而没显式传 agentDir，用户用 `pi install` 装在 `~/.pi` 里的任意扩展会被静默加载进 Nomi 主进程。** 探针全程显式传临时目录，就是为了不踩这个。

两个踩到的坑（与扩展无关，但会误导下一个人）：
- 假 provider 必须给 `auth: { apiKey: { resolve } }`，否则报 `Provider is not configured: probe`（`pi-ai/dist/models.js:366`）——这句话看起来像「模型没配」，其实是 provider 的 auth 面没给。
- 默认压缩会在**第一回合**就触发，把我脚本化的第二段回复吃成 compaction summary，看起来像「工具从来没被调用」。传 `compaction: { enabled:false, … }` 才看得到真相。**这条对以后写 harness 测试是通用的**。

### 3.5 步骤 5 —— 真执行：断在 `bindCore`

不构造 `ExtensionRunner`、只手搓一个 `ExtensionContext` 塞进 `definition.execute(...)`（probe D），断在这：

```
THREW: Error :: Extension runtime not initialized. Action methods cannot be called during extension loading.
stack: loader.js:137 notInitialized | loader.js:305 appendEntry | pi-web-access/index.ts:661 storeFetchResult
```

**读法**：扩展在**执行工具的过程中**回调宿主（这里是 `pi.appendEntry`，把抓取结果写进会话）。`createExtensionRuntime()` 给的是**会抛的 stub**，只有 `runner.bindCore(actions, contextActions)` 才换成真的。所以「手搓一个薄适配层」这条路的真实代价不是 12 行 wrapper，是 **26 个方法的宿主动作面**。

把 26 个都补上（probe E，全部 no-op stub）之后，第三方工具**真跑起来了**：

```
RESULT: {"content":[{"type":"text","text":"Error: Blocked internal address for 127.0.0.1: 127.0.0.1"}], …}
appendEntry calls the extension made: [ [ 'web-search-results', '{"id":"mtqle67ndb3k6o","type":"fetch",…' ] ]
```

两件事同时被证明：① 端到端是通的（那句 `Blocked internal address` 是 `pi-web-access` 自己的 SSRF 防护在工作，说明它真的执行了）；② **扩展会往转录里写自己的条目**——`appendEntry` 是一个**外来的转录写入者**。方案 §2.1 把 `appendCustomEntry` 的写入权收在 ⑤ Lane 宿主一家，装扩展等于当场再发一把钥匙。

---

## 4. 问题三：信任与闸

### 4.1 `before_tool` 能拦住扩展注册的工具 —— 能，实测

probe B 步骤 5：脚本化的假模型发出一次 `fetch_content` 调用，我们的钩子无条件 block。

```
gate saw: [ 'fetch_content' ]
ENTRY {"type":"message","message":{"role":"toolResult","toolCallId":"probe-call-1","toolName":"fetch_content",
       "content":[{"type":"text","text":"NOMI-GATE-DENIED: fetch_content"}],"isError":true,…}}
```

拒绝理由**一字不改**成了那次调用的 tool result，扩展的 `execute` 一次都没跑（没有任何网络尝试）。**这与 `laneHost.mts:84-97` 现在的挂法完全一致，不需要为扩展工具另写一条闸。**

### 4.2 扩展能不能绕过 —— 能，而且不需要任何技巧

probe C 里我写了一个**一个工具都不注册**的扩展，只在 factory 里做事：

```
extensions loaded: 4 errors: 0
evil ran at factory time: {"sawSecret":"sk-fake-secret","cwd":"/private/tmp/pi-ext-probe-lab"}
evil proof file: wrote at factory time: sk-fake-secret
network attempts during load: [ 'http://127.0.0.1:9/exfil?k=sk-fake-secret' ]
fs writes during load: [ '$TMPDIR/jiti/evil-index.2f9dccdc.mjs', '…/evil/proof.txt' ]
fs reads during load (count): 1022
same process.env object as host: true
```

**读法**：`before_tool` 是**工具调用**这条路上的闸。扩展的代码在**加载那一刻**就跑了，那时还没有任何 lane、任何 hook、任何工具。它拿到的是**宿主进程本身**——同一个 `process.env`、同一个 `fetch`、同一个 `fs`。

这不是理论。生态里下载量第二的 `pi-web-access` 就带着 `chrome-cookies.ts`：

```
node_modules/pi-web-access/chrome-cookies.ts:1-3
  import { execFile } from "node:child_process";
  import { pbkdf2Sync, createDecipheriv } from "node:crypto";
  import { copyFileSync, …, readFileSync, … } from "node:fs";
  …
  keychainService?: string; keychainAccount?: string;   // :15-16
```

**它读用户的 Chrome cookie 数据库，并用 macOS 钥匙串里的密钥解密。** 在一个 CLI 里这是「帮你用登录态抓网页」的贴心功能；在一个**握着用户 API 密钥、会花用户真钱**的打包桌面应用里，这是把我们的 TCC 授权和钥匙串访问借给了一个第三方包。这就是前置调研 §4.1 那句「把别人的威胁模型搬进我们家」的具体长相。

### 4.3 完整性校验 —— 只有 registry 层，没有代码层

| 检查 | 结果 |
|---|---|
| pi 自己的包管理器 | **零**（前置调研 §2.2 实核：`package-manager.js` 无 integrity/checksum/signature） |
| 我们这次走的是 npm，那 npm 呢 | 三个包**都有** npm registry 签名（同一个 keyid `SHA256:DhQ8wR5APBvFHLF/+Tc+AYvPOdTpcIDqOhxsBHRwC7U`）——**那只证明 tarball 是从 npm 拿的，不证明作者可信** |
| SLSA provenance | 只有 `@gotgenes/pi-permission-system` 有（`predicateType: https://slsa.dev/provenance/v1`）；**`pi-mcp-adapter` 与 `pi-web-access` 两个头部包都没有** |
| 我们自己的技能包 | 有：顺序无关 SHA-256 覆盖整个文件映射（`electron/skills/skillPackage.ts:82-91`） |

**顺带一条实测的现实**：`pi-mcp-adapter@2.32.1` 的 `peerDependencies` 写着 `@earendil-works/pi-ai: ^0.84.1`，而我们锁的是 `0.85.1`——**npm 直接拒绝解析**，必须 `--legacy-peer-deps` 才装得上。生态里下载量第一的包，已经落后于我们锁的 pi 版本。这不是偶然，是前置调研 §3.1 那句「中位包是作者为自己写的」的直接后果。

### 4.4 一条闸拦不住的东西：工具面本身会变大

`ExtensionAPI.setActiveTools(toolNames)`（`types.d.ts:999`）+ `wrapRegisteredTool` 把差集塞进 `addedToolNames`（`wrapper.js:24-25`）= **一次工具执行可以把活跃工具集撑大**。

`before_tool` 仍然会看到新工具的每一次调用（闸没漏），但方案 §3.2 的 **S7 预算（任一 profile ≤12 工具 / schema ≤4 000 token）在运行期就不再是一个可静态验证的数**。要借扩展，S7 就得从「构建期门岗」改成「运行期不变量」——这是一条**架构级**的代价，不是配置。

---

## 5. 顺带的实核：技能包在盘上长什么样

> 用户那句「技能（markdown）可直接坐」的实核。结论：**方向对，但不是「拖进来就行」。**

### 5.1 单文件技能：正如预期

`pi-mcp-adapter/skills/mcp-scripting/SKILL.md:1-5`
```
---
name: mcp-scripting
description: Write mcpScript JavaScript for discovering, inspecting, and calling MCP tools.
disable-model-invocation: true
---
```
三个字段全在 Nomi 的正则 frontmatter 读取范围内（`electron/skills/skillStore.ts:89-111`），零附件，零相对引用。这种拖进来就能用。

### 5.2 但生态头部的技能包不是这样：`bigpowers`

| 事实 | 数字 | 怎么量的 |
|---|---|---|
| 它**不是** skills-only 包 | `pi` 清单 = `{"extensions":["extensions/omp-hooks.ts"],"skills":["./.pi/skills"],"prompts":["./.pi/prompts"]}` | `node_modules/bigpowers/package.json` |
| 声明的技能根 `.pi/skills/` | **81 个 SKILL.md，除此之外一个文件都没有** | `find .pi/skills -type f` 按扩展名直方图：`81 md` |
| 但正文里的相对引用 | **96 处**，形如 `](../../../skills/publish-package/REFERENCE.md)` | `grep -rhoE` on `.pi/skills/**/SKILL.md` |
| 这些引用指到哪 | `.pi/skills/publish-package/SKILL.md` 里的 `../../../skills/publish-package/REFERENCE.md` → 解析成 **`skills/publish-package/REFERENCE.md`**，**存在**，且**跑出了声明的技能根** | `os.path.normpath` 实算 |
| 那棵树里有什么 | `129 md` + **`20 js` `6 sh` `5 html` `4 py` `3 json` `2 go` `2 cjs` `1 yaml` `1 feature`** | `find skills -type f` 按扩展名直方图 |

**所以「导入 pi 技能」这件事的真实形状是**：
1. **只导声明的根 → 拿到 81 个 md 和 96 条断链**。模型运行时会 `read` 一个不存在的路径，看起来像技能坏了。
2. **跟着链接导 → 走出技能根，进到一棵含 34 个可执行文件的树**。我们的导入器会正确地跳过它们（`skillPackage.ts:27` 的 `SKILL_TEXT_EXT` 白名单 + `:35` 的 `SKILL_EXECUTABLE_DIRS`），但那些 md 的正文仍然会引用被跳过的脚本——**诚实报告「跳过了什么」在这里从「锦上添花」变成了「必需品」**（`skillPackage.ts:30-33` 的注释已经写对了理由）。
3. **`../` 是要拦的**。`skillPackage.ts` 的深度上限是 4 段**向下**（`:29`），向上逃逸这一族正好是 conformance 开的 **S11 `containPath()`** 那条债的又一个入口。

**pi 自己怎么处理附件**：它不处理。`Skill` 只有 `{name, description, filePath, baseDir, sourceInfo, disableModelInvocation}`（`core/skills.d.ts:9-16`），**没有附件清单**——附件是靠模型自己拿 `read` 工具按 `baseDir` 相对读的，文档自陈 "models don't always do this"（`docs/skills.md:66-72`）。所以 pi 侧的断链是**静默的**，我们要是照抄这个设计，坏掉的技能不会有任何信号。

---

## 6. 判定

### 6.1 三档

| 档 | 内容 | 理由（R20 三问 / R28） |
|---|---|---|
| **✅ 可直接借（零代码）** | **一个都没有。** 三个候选包全部落进下面两档 | —— |
| **🟡 改一层适配再借** | 技术上唯一可行的形状：`pi-coding-agent` 的 `discoverAndLoadExtensions`（**必须显式传 agentDir**）+ `ExtensionRunner` + `bindCore(26 个方法)` + `wrapRegisteredTools` → 塞进 `AgentHarness.tools`。**实测跑通**。代价不是行数（glue 本身约 40 行），是**三个结构性代价**：① 把 `SessionManager` 拉进主进程 = 第二份会话持久化，撞 I2 与 `check:framework-boundary` 的 `session-persistence` scope；② `setActiveTools`/`addedToolNames` 让 S7 工具预算从构建期门岗降级成运行期不变量；③ `appendEntry` 让转录多一个外来写入者，撞方案 ⑤ 的单一写入权 | 造轮子三问：① 通用问题？**否**——我们要的是「Nomi 的能力变成模型可见的工具」，那是方案 ⑦ 的活，已经有唯一 owner。② 同类怎么做？pi 是**信任本机用户的 CLI**，我们是**打包桌面应用**，前提不同。③ 在护城河上？**扩展宿主不在**，但**它带进来的风险落在护城河上**（密钥、钱包、用户素材） |
| **❌ 不借** | **`pi-web-access`**：能力我们要么已有（MCP）要么不要（读 Chrome cookie + 钥匙串解密），净新增攻击面。**`pi-mcp-adapter`**：方向反了——它是**给 pi 接 MCP 服务器**的客户端，Nomi 是 **MCP 服务器**；正确的接法是前置调研 §5.2 路子 ②（给 MCP 一键接入加一个 pi 客户端档，≈半天），不是把 MCP 客户端装进我们自己。而且它 peer 卡在 `pi-ai ^0.84.1`，装不上我们锁的 0.85.1。**`@gotgenes/pi-permission-system`**：与 K2 审批**同题**，装它 = P1 的并行版；它的价值是**读**（它 153 个文件的分层是免费的设计参考），不是**装** | R28：把「任意代码 + 完整进程权限 + 无代码级完整性校验」引进握着密钥与钱包的桌面应用，是把防线建在最晚那层 |

### 6.2 坐生态：最大收益 vs 最大代价

**最大的真实收益，一句话**：pi 生态已经**替我们把「一个 agent 宿主该向工具暴露什么」这张桌子摆完了**——`ExtensionActions` 那 14 个 + `ExtensionContextActions` 那 12 个方法（`types.d.ts:1246-1279`），是几千个包用出来的、经过真实使用检验的宿主接口清单；照着它自查方案 ⑤/⑦ 少了什么，比我们自己拍脑袋想接口便宜得多，而且**读它一分钱风险都没有**。

**最大的真实代价，一句话**：**你坐上去的那一刻，坐的不是「他们的功能」，是「他们的信任模型」**——pi 假设「本机用户 = 可信」，所以扩展在 factory 阶段就拿满进程权限、包管理器没有任何代码级完整性校验；Nomi 假设的是「用户把密钥和钱交给我们保管」，这两个假设不能同时成立，而**一旦装了第一个扩展，成立的那个就是 pi 的**。

---

## 7. 未决项（明着标）

| 没验的 | 为什么 / 下一步 |
|---|---|
| Electron 打包环境下 `jiti` 能不能转译 `.ts` 扩展 | 探针跑在裸 Node v24。`jiti` 要往 `$TMPDIR/jiti/` 写转译产物（§4.2 实测），在 asar + 沙箱下未验。**只有真要走 🟡 档才需要验** |
| `pi-mcp-adapter` 在 `pi-ai@0.85.1` 上到底跑不跑得动 | 只证明了 npm **拒绝解析** peer；`--legacy-peer-deps` 装上后能加载、能注册工具，但没跑它的 MCP 冷启路径 |
| `@gotgenes/pi-permission-system` 的 `tool_call` 拦截与我们的 `before_tool` 谁先谁后 | 它注册了 `tool_call` handler（§3.1），那是 **coding-agent 层**的闸；agent-core 的 `before_tool` 是**另一层**。两层同时在场的次序没测——但因为判定是「不装」，这条只在 🟡 档复活时才需要 |
| 生态包的存活期 | 前置调研 §3.1 已记：中位包年龄两个月。这一篇没有新增数据 |
