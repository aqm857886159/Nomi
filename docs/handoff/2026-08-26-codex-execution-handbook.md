# Codex 执行手册（2026-08-26 交接）

> **给谁看**：接手 Nomi 推进的 Codex（或任何 AI）。owner 额度紧张，这份文档要能让你**脱离对话独立执行**。
> **怎么用**：§1 看状态 → §2 背铁律 → §3 记陷阱 → §4 别重新论证 → §5 领任务 → §6 照着验 → §7 知道何时停。
> **最重要的一句**：本仓最大的风险不是写错代码，是**产出"看起来证明了什么、实际什么都没证明"的证据**。§3 是这份文档的核心，比任务清单更重要。

---

## 1. 确切状态（2026-08-26 02:50）

**main 最新**：`e0477f91`（走查取证框架整修 #178）

**已合入 main 的近期成果**：

| PR | 内容 |
|---|---|
| #174 | Track D1：MCP 生命周期 + 付费确认绑定 + tools/call schema 校验 + IPC sender 绑定 + `check:ipc-sender-binding` 棘轮 |
| #176 | P5 E1 采纳桥（产物进时间轴收敛为唯一受控通道）+ `check:adoption-bridge` 棘轮 |
| #177 | F3 拆镜入口进选中浮条 + F16b 花钱/托管确认合并成一张卡（旧卡已删，consent 成为编译期义务）|
| #178 | 走查取证框架整修（四个根因）+ `check:gates-chain` 元门岗 + 断言密度棘轮 |

**在飞的阶段分支（都没开 PR，攒批中）**：

| 分支 | worktree | 内容 | 状态 |
|---|---|---|---|
| `claude/stage-p5-e2` | `~/Desktop/nomi-stage-e2` | E2 盘点、B4 调研/讲解/实施计划、B4-0 契约 | 5 commits；**D2 可能仍在跑，先 `git status` 看有没有未提交改动** |
| `claude/stage-design-sync` | `~/Desktop/nomi-stage-dsync` | 设计系统组件库（40 组件，39 自作预览）| 4 commits；**收尾完整构建可能未跑完**，见 §5.0 |

**worktree 纪律**：这台机器有 100+ worktree。动 git 第一步永远是 `git branch --show-current`。**绝不在共享主仓 `~/Desktop/Nomi` 里 checkout/切分支**——几乎每个分支都已被别处占用。用分支自己的 worktree。

---

## 2. 铁律（违反即返工）

### 2.1 交付纪律（owner 2026-08-26 明确要求）

- **默认不开 PR。** 活干完 commit 到阶段分支，继续下一件。**攒到大阶段边界才开一个 PR。**
  - 理由不是洁癖，是**墙钟**：Quality Gate 一轮 6–25 分钟、要 up-to-date 就得 update-branch 再等一轮、多 PR 并行还要排合并列车、`package.json` 的 `gates` 链几乎必冲突。小 PR 的边际收益远小于这份固定开销。
  - 「大阶段」= 一个能对 owner 讲清价值的完整块。**不是**单个切片、单个 bug、单个门岗。
  - 文档、小修、门岗、测试修复 → **一律搭车，永不单开**。
- **绝不 merge 别人的 PR，绝不 push main，绝不 `--admin`，绝不 force-push。**
- commit message 末尾必须有：`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 长命分支要**定期把 `origin/main` 合进来**，别等到最后。特别注意 `package.json` 的 `gates` 链冲突**必须按并集解**——漏掉一个 check **不会报错**，门岗就此静默消失。（现在有 `check:gates-chain` 元门岗会拦，但仍要手动留心。）

### 2.2 工程纪律（`CLAUDE.md` 全文必读，以下是最常被违反的）

- **P1 加新必删旧**：引入新实现时**同 commit 删旧实现**。无并行版、无 fallback、无逃生口。
  - 反面教材：#177 里 `runGenerationNode(node, options = {})` 的那个 `= {}` 默认值就是逃生口——删掉默认值后，"谁问过用户"变成了编译期义务。
- **P2 修根因 + 通用性判定**：修完必问「这个病只在这个功能上，还是别的功能也可能有」。是通用的就：① 全仓实扫同类入口给 file:line（**扫，不猜**）② 能 grep 的做成**棘轮门岗**（`scripts/check-*.mjs` + baseline，只减不增）③ 存量进基线、新增当场报红。
- **R5 不许凭记忆讲前沿/选型**：碰第三方库先 Context7；选型/引入新框架先 Context7 + web 查**当前现役**方案。写「最新/SOTA/已被取代」前确认此刻仍成立。（本仓因此栽过三次。）
- **R9 单文件 ≤800 行**，分层清楚（UI / 状态 / 领域 / runtime / 持久化）。
- **R15 用户可见文字全部走 i18n**，默认 `zh-CN`。
- **R17 加门岗必须先验证它会红**：注入违规 → 确认报红**且点名正确的文件** → 撤销 → 确认绿 → 工作树干净。把字面输出写进报告。
- **R8 用户可见改动必须先出样张、owner 亲自拍板**。改现有 UI 前**先看它真实样子**（读完整外壳组件或真实截图），样张 = 真实布局 + 改动，**禁止脑补排版**。

---

## 3. 陷阱（本仓踩过、别处学不到、最值钱的一节）

### 3.1 「假绿」家族——证据看起来权威，实际什么都没证明

2026-08-25 到 26 一夜连撞四次，**四个根因已修**，但**判断力必须传下去**：

| 陷阱 | 它怎么骗人 | 现在的护栏 |
|---|---|---|
| `expectAbsent` 首次采样即过 | Playwright 的 `toHaveCount(0)` 期望值是 0、当前也是 0 → **第一次采样就通过**，timeout 一秒没用上。晚 200ms 挂上来的东西一路放行 | 已修：先降到 0，再 `holdAbsent` 持续盯 800ms |
| 截图在动画未落地时拍 | 主题翻转要写 **4 个属性**且等 ~140ms 过渡；弹窗退场仍在画；toast 滑入被视口切掉。**同码同命令两次跑出不同证据** | 已加 `screenshotSettled()`。**失败路径故意不用它**——失败图要"当场什么样" |
| 门岗从 gates 链静默消失 | 解 `package.json` 冲突时"取了一边"就少一节，**不报错**，只是不再执行 | `check:gates-chain` 元门岗 |
| 走查几乎没断言还报绿 | 修复前的 `model-onboarding.walk.mjs` 78 行**只有 1 条失败路径**，拍出 4 张逐字节相同的图仍然 exit 0 | 断言密度棘轮（阈值 ≥2 条失败路径）|

### 3.2 单独拎出来的高频坑

- **`check:walkthroughs` 是静态检查，从不执行走查。** 所以「gates 绿」**不能**当作走查跑过的证据。要走查就得 `node tests/ux/<name>.walk.mjs > /tmp/x.log 2>&1; echo exit=$?` 亲跑并记录退出码。
  - 后果实例：main 上曾躺着 2 条红走查不知多久没人发现。
- **管道会吞掉退出码。** `pnpm run test | tail` 的 exit 是 tail 的。**永远** `cmd > /tmp/x.log 2>&1; echo exit=$?`。
  - 后台任务通知里的 exit code **同样会骗人**——实测见过通知报 `exit code 0` 而日志尾巴是 `ELIFECYCLE ... exit code 1`。**以日志为准。**
- **旧截图不会自动清。** agent 改完代码没重跑走查，盘里躺着上一轮的 PNG，看起来"证据齐全"。
  - 判定法：`ls -lT tests/ux/shots/<name>/` 的 mtime 对比 `git log -1 --format=%ci`。**截图早于修复 = 证明的是修复前的状态。** 跑前先 `rm -f`，跑后确认时间戳更新。
- **半透明幽灵在缩略图里看不见。** 720px 缩略图看着干净，裁剪放大 4× 才发现有幽灵按钮叠在卡片上。怀疑就裁剪：
  ```python
  im.crop(box).resize((w*4, h*4), Image.LANCZOS)
  ```
- **死选择器同时造假红和假绿。** 读源码猜选择器必错——**先打运行时探针**，dump 真实 DOM 属性再写断言。
  - 实例：`.filter({hasText: '名字'})` 匹配**文本内容**，而元素的名字在 `aria-label` 上 → 永远匹配不到。同一份文件里另一条腿用 `getByRole({name})` 就是对的。
  - 实例：`.first()` 抓到尺寸为 0 的隐藏重复实例 → 点击超时 → 末尾 `.catch(() => {})` 把超时吞了。**用 `:visible` 收窄，别留吞异常的 catch。**
- **并行测试会伪造 flake。** 多 worktree 同时跑 suite 能把耗时放大数十倍。判红前先 `uptime` / `pgrep -fl vitest`，串行重跑确认。
  - 已知既有 flake：`electron/workspace/workspaceRegistry.concurrency.test.ts` 高负载下偶发失败、隔离跑能过。**别去"修"它。**
- **走查里别用 `win.reload()`**：原地刷新后活动项目会话为空，面板静默空掉，**像极了真 bug**。用冷启动（close + relaunch 同 `userDataDir`）。
- **计数型基线指不出真凶。** 棘轮基线要存**身份列表**（哪些文件/哪些 channel），不要只存总数——否则报红时会点名一个无辜文件，下一个人要么白查半天，要么直接把数字调大。

---

## 4. 已拍板的决定（**不许重新论证**）

1. **B4 四件套自建**，不买全栈 agent runtime。AI SDK 能白拿的只有模型抽象 / 工具 schema / 流式多步 / abort-retry-repair，**保持 `ai@4`**。
2. **两条事件日志各走各的**，用 `runId / causeId / txnId / proposalId` 显式关联，**不物理合并**。
   - 理由（已量化）：通用日志 `fs.appendFileSync` **不 fsync**；ProductionRun 走 `writeSync + fsyncIfDurable`（`electron/durability.ts` 是全仓唯一决定要不要真 fsync 的地方）。合并会强迫二选一：要么高频对话事件都 fsync 拖慢交互，要么账本失去掉电保证。
3. **AI SDK 7 只做隔离只读 spike**，通过后再议升级。spike **不得写入** ProductionRun、预算、canvas。
4. **Thread/Turn/Item 用 Nomi 自有 union**，对外做 adapter。**禁止 SDK 类型反向侵入业务模型。**
5. **保护项永不被反向改写**：ProductionRun 账本、预算/收据/幂等、锚一致性、Proposal/撤销、能力核权限。
6. **Track D 四批顺序**（已写进主方案 §6，D1 已完成并合入 main）：D1 安全生命周期 → D2 `sendSync` 异步化 → D3 瞬时态/领域态分离 → D4（可选）换内核。
7. **E2 不得使用不存在的能力**：`ripple` / `roll` / 视觉转场**都不存在**（`timeline.transitions` 有数据但播放器和导出器根本不读）。不存在的能力**不得出现在类型或卡文案中**。

---

## 5. 工作队列

> 每项都给：**目标 / 前置 / 做法 / 验收 / 回滚 / 边界**。按顺序做；某项被阻塞就跳到下一项，别空转。

### 5.0 【收尾】design-sync 封存（最优先，因为只差一步）

- **目标**：把设计系统组件库跑到可用状态，然后**封存**——它不在关键路径上，别再投入。
- **前置**：worktree `~/Desktop/nomi-stage-dsync`，分支 `claude/stage-design-sync`（4 commits）。
- **做法**：读 `.design-sync/NOTES.md`（里面有完整命令），按顺序跑：
  ```bash
  node .design-sync/support/build-css.mjs                    # 样式压平
  node .ds-sync/package-build.mjs --config design-sync.config.json \
    --node-modules ./node_modules --entry .design-sync/support/ds-entry.mjs --out ./ds-bundle
  echo build_exit=$?
  node .ds-sync/package-validate.mjs ./ds-bundle
  echo validate_exit=$?
  ```
  **三条分开跑、各看退出码，别用 `&&` 串、别 `| tail`。**
- **验收**：`.render-check.json` 的 `bad` 为 0；**亲眼读 `ds-bundle/_screenshots/contact-sheet-*.png`**（读之前确认 mtime 晚于最后一次 build——旧图证明不了新工作）；剩余 12 个未评级组件出图后评级。
- **回滚**：`ds-bundle/` 是生成物且 gitignored，删掉重跑即可。
- **边界**：**上传到 claude.ai/design 不做**（需要 owner 跑 `/login`，本会话给不了权限）。跑完 commit、封存，不要再优化。

### 5.1 D2：IPC `sendSync` 读路径异步化

- **目标**：消除 renderer 被主进程阻塞的卡顿。
- **状态**：**可能已由 Codex 完成**——先 `cd ~/Desktop/nomi-stage-e2 && git log --oneline -3 && git status` 确认。已完成就跳过。
- **已知事实**（我实测，别重推）：全仓 `sendSync` 只有 **1 处**，在 `electron/preload.ts:15` 的通用同步包装里。是**单一收口点**，不是散落各处。
- **做法**：① 摸清经由它的 channel 与调用点（file:line 清单，点名最热的几条）② 能异步的改异步、**同 commit 删旧同步路径**（P1，不留 fallback）③ 必须同步的说明理由并保留。
- **真正的风险**：异步化**改变时序**。原本同步返回的值变成 Promise，调用方若假设"拿到就有值"会读到 undefined。**逐个调用点核对**，特别是启动早期路径（可能出现"首帧空一下"的观感回归）。
- **验收**：单测先红后绿；**亲跑一条覆盖启动+项目库的走查**拿退出码；`pnpm run gates` exit=0。
- **回滚**：改动集中在 preload + 调用点，revert commit 即可。
- **允许交白卷**：若摸完发现这些调用都在冷路径、不值得动，**如实说，不要为了交付而制造改动**。

### 5.2 B4-1：前置清理（§3 内部各自为战的收敛）

- **目标**：补齐 B1a/B1b/B1c/B1d，收敛 B2 工具注册与 B3 确认入口，**同 commit 删除旧 caller 配置层**。
- **前置**：B4-0 契约已完成（`electron/harness/domain/`，674 行，零引用、零生产影响）。读 `docs/plan/2026-08-26-b4-harness-implementation-plan.md` §4 的执行卡。
- **重要提醒**（计划 §7 自己写的）：`origin/main` 上 B1a/B1b/B1d 已有实现，但**审计表仍记录旧 caller**。**不要把"所有残余调用点已清零"当成事实**——开工先用 `rg` + typecheck 找到完整入口集，行数估算可能变化。
- **规模估算**：新增 250–450 行 / 删除 220–420 行。**超过上限必须停下复盘，不得靠继续加代码掩盖范围漂移。**
- **验收**：每个被删的旧路径都要有对应新路径的测试；`pnpm run gates` exit=0；涉及 UI 的亲跑走查。
- **回滚**：保留旧 key 的字节快照 + 一次性回滚分支。

### 5.3 B4-2 / B4-3 / B4-4

照 `docs/plan/2026-08-26-b4-harness-implementation-plan.md` 的执行卡逐期做。**每期做完停下来**，把证据整理好，等 owner 决定要不要继续——别一口气冲到底。

**B4-2 有一个待拍板项**：correlation record 的物理落点（旁路 sidecar vs 扩展 Run metadata）。**默认走旁路 sidecar，不碰受保护 schema。** 要改必须 owner 拍板。

### 5.4 E2 结构化粗剪（**被样张阻塞，先别写实现**）

- **状态**：盘点与设计已完成（`docs/plan/2026-08-26-p5-e2-structured-rough-cut.md`）。
- **阻塞**：它会产生用户可见的**剪辑计划卡**，按 R8 必须先出样张、owner 亲自拍板。**没拍板前不要实现这张卡。**
- **可以先做的**：文档里"必须先补"那一档的缺口（例如分镜 `durationSec` → 时间轴 builder 的映射缺口），这些不涉及新 UI。
- **绝对不能做**：把 `ripple` / `roll` / 视觉转场写进类型或卡文案——**它们不存在**（见 §4.7）。

---

## 6. 验证手册

### 6.1 门禁（push 前必过）

```bash
pnpm run gates > /tmp/gates.log 2>&1; echo exit=$?
```
**必须这样写。** 别 `&&` 串，别 `| tail`。exit 必须是 0。

现在链上有 23 个 check（`check:gates-chain` 会保证没有一个被静默删掉）。

### 6.2 走查（gates **不会**帮你跑）

```bash
rm -f tests/ux/shots/<name>/*.png                          # 先清旧图
node tests/ux/<name>.walk.mjs > /tmp/walk.log 2>&1; echo exit=$?
ls -lT tests/ux/shots/<name>/                              # 确认 mtime 晚于 commit
```
截图**要自己亲眼看**。怀疑有幽灵就裁剪放大 4×。

### 6.3 加门岗时的红绿证明（R17，缺一不可）

```bash
node scripts/check-<name>.mjs; echo "clean_exit=$?"        # 期望 0
# —— 注入一处违规 ——
node scripts/check-<name>.mjs; echo "violation_exit=$?"    # 期望 1，且**点名正确的文件**
# —— 撤销 ——
node scripts/check-<name>.mjs; echo "restored_exit=$?"     # 期望 0
git status --porcelain | wc -l                             # 期望 0
```
把**字面输出**写进报告。只报"我加了门岗且 gates 绿"不算数。

### 6.4 判断测试红灯真假

```bash
uptime                        # load average 高说明并行放大
pgrep -fl vitest              # 别的 worktree 在跑吗
npx vitest run <path> --reporter=dot    # 串行重跑确认
```

---

## 7. 什么时候必须停下来问 owner

**只在这几种情况停**，其余一律自主推进到完成：

1. **产品方向 / 不可逆取舍**
2. **架构岔路**（多个分歧巨大的合理解）——给对比表，别单方面开干
3. **用户可见改动的样张拍板**（R8）——这是最常见的一种
4. **需要 owner 独有资源**（API key、真实素材、`/login`）
5. **样张或需求自相矛盾**——停下上报，**不许自己挑一条实现**

**不用问的**：实现细节、命名、模块拆法、测试策略、bug 修复顺序。
**评测/测试/验证类的额度花费默认授权**——直接花、别问、事后报花销。

---

## 8. 报告格式

owner 额度紧张，**报告要短**（≤20 行），且必须包含：

- 做了什么（带 file:line）
- **字面退出码**（gates / 走查 / 门岗红绿），不是"通过了"
- 你**亲眼**看到了什么（截图描述），不是"应该没问题"
- 什么没做完 / 什么不确定 —— **诚实交付，缺口明着标**
- 有没有需要 owner 拍板的岔路

**不要把整份文档或整段代码粘回去。**

---

## 9. 一句话交接

**代码写错了能查出来，证据造假查不出来。** 这份文档 §3 存在的全部理由，就是让下一个人不必再花一整夜去发现"绿灯可以什么都不证明"。
