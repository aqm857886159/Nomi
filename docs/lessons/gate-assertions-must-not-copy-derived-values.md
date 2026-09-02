# 门岗断言不许手抄真相源的派生值，且必须与真相源同触发面

> 📎 教训 · 首次记录 2026-09-02 · 状态：现行（部分已固化，见文末「已接管的部分」）
> **触发场景**：写或改任何门岗/测试里的**数量、名单、聚合数、快照**；判一条「一直是绿的」断言到底有没有在守东西；main 上冒出一条红灯而它看起来像是某个无关 PR 引入的。

**结论**：门岗断言**不许持有真相源的派生值副本**。要么从真相源 derive，要么断言不变量而不是数值。实在只能快照，就必须同时满足两条：① 一条命令可重生成；② **守它的门岗与它的真相源同触发面**（改真相源必然会执行到它）。两条缺一，落后就能潜伏任意久，并在一个无关改动上以「别人的锅」的形态爆出来。

## 为什么会踩

2026-09-02 一天之内，同一个母题变出五个形态，全部实测：

| # | 派生物 | 真相源 | 后果 |
|---|---|---|---|
| 1 | `docs/DELIVERY-LEDGER.md` 里的 `现役欠账（30）` | 整个 docs 语料 | 合并即错，**人工解冲突在原理上解不对** |
| 2 | quality-gate 并发组键 `github.ref` | 证据单位（commit） | 下一个 merge 取消上一个的 CI，收据发不出 |
| 3 | packaged smoke 的 `tools.length >= 22` + 16 个工具名 | MCP 工具目录 | 面收敛后静默落后，红灯栽赃给无关 PR |
| 4 | `mcp-skills-integration.e2e.mjs` 整份 | —— | **没有任何 runner 执行它**，零检出力 |
| 5 | 本机 main checkout | origin/main | 落后 330 个 commit，被工具显示成「有东西要 PR」 |

三个非直觉的点，都是实测出来的：

**① 有些派生物人工合并在原理上修不对。** 账本含全局计数。base=30，A、B 两分支各加一篇文档、各自重生成都是 31，两边门岗全绿；`git merge` 时计数行两边字面相同，**git 无冲突地保留 31，而并集真值是 32**。按最自然的方式解冲突（两行都留）门岗**依然红**——因为「32」在 A、B、base 三方里谁都没写过，人工合稿只能在三方写过的内容里取舍，变不出第四种。**必须重跑生成器，而 GitHub 的合并按钮永远不会重跑。**

**② 决定性变量是触发面，不是作者细不细心。** #359 把 MCP 工具面收束到 19 个并换掉全套命名。同一次收敛：

- `tests/ux/mcp-l1-handshake.e2e.mjs` 里硬编码的 19 个工具名 → **被正确更新了**（它由 `test:mcp-journey` 执行，会被 MCP 改动触发）
- `tests/ux/packaged-mcp-smoke.e2e.mjs` 里手抄的 `>= 22` 和 5 个工具名 → **一个都没改**（它只由 Mac Package 执行，只在**打包路径**变动时触发）

同一目录、同一形态、同一次收敛，被触发的跟上了，没被触发的落后了。落后潜伏了一整天，直到一个改 `package.json` 的无关 PR 触发打包面才炸，第一眼看去还像是那个 PR 的锅。

**③ 死名字既造假红，也造假绿。** packaged smoke 里三条「未签名 host 的写操作必须被拒绝」长期是绿的——但它调的 `nomi_integration_begin` 在收敛后**已不存在**，而调用一个不存在的工具**同样返回 `isError: true`**。它守的其实是「工具不存在」，不是写边界。**那个安全面在收敛后从未被真正验证过。**

**④ 从不执行的测试是负资产。** `mcp-skills-integration.e2e.mjs` 全仓只被自己的头注释引用，不在 `package.json`、不在 profiles、不在任何 workflow。它一边在文件里写着「验真 skillStore」，一边检出力为零——**它在目录里、在搜索里、在 review 时都像覆盖，于是抑制了别人补真覆盖的动机**。而 `>= 20` 这种永不变红的下限让「一直绿」和「从来没跑」在观感上无法区分。

## 怎么用

**写断言时，先分清这个数字是哪一种：**

- 测试**自己造出来**的 → 可以写死。`mcp-journey.e2e.mjs` 的 `nodeIds.length === 14`，那 14 个节点是它自己建的，自足，不镜像任何外部真相源。
- **镜像别处真相源**的 → 不许写死。改成从真相源 derive，或断言不变量。

**改法模板**（本次实际做的）：

```js
// ✗ 手抄：只防「变少」，且把「目录只会变多」这个假设编码进了断言
assert(tools.length >= 22)

// ✓ 不变量：打包后暴露的 === 本次构建声明的
assert.deepEqual(actualNames.sort(), [...MCP_TOOL_NAMES].sort())
```

derive 版**比原来更强**：还能抓到「意外多暴露了一个工具」，而 `>= 22` 对此完全无感。

**四个可执行的检查动作：**

1. **看到 `>= N` 就问「N 是抄谁的」。** 抄自别处 = 定时炸弹。尤其警惕注释里写着「extensible / 只会增加 / 下限」的——那是把一个方向性假设编码进了断言，一旦有人反向优化就会反噬。
2. **加/改门岗必须做反向对照**（R17）。让它先红一次并**精确指名**，再修绿。本次三个新门岗都做了：把账本放回 committed 清单 → 红并指出 `## 现役欠账（8）`；把工具名改回旧名 → 红并指出行号；期望集合塞一个不存在的技能 → 红并指名。
3. **判断一条断言有没有在守东西，先确认它在跑。** `grep -rn "<文件名>" . --exclude-dir=node_modules --exclude-dir=.git`——只被自己头注释引用 = 死测试。再排除 glob 拉起的可能（本仓 e2e 均为逐文件显式调用）。
4. **新增 committed 生成物前，问它文本合并后还对不对。** 判据是**可达性**：`render(union)` 的每一行是否都出现在 `render(base)/render(A)/render(B)` 之一。出现「谁都没写过」的行 = 不可合并 = 不该 commit。纯排序清单可以（人工「两行都留」就是对的），带聚合量不行。

**还有一条元教训（我自己当场差点犯）：** 新门岗初版扫全 `tests/` 命中 27 处「不存在的工具名」，逐个核实后 **26 处是误报**（25 处是 agent-runtime 喂假 LLM 的合成工具名、1 处是故意验 -32602 的探针）。正确动作是**收窄扫描范围 + 给故意情形一个显式声明**，不是放宽判据凑绿——后者就是这条教训本身要治的病。

## 出处

- PR [#356](https://github.com/aqm857886159/Nomi/pull/356) 账本移出 git（合同 `docs/fixes/2026-09-02-unmergeable-generated-artifact.root-cause.json`）
- PR [#363](https://github.com/aqm857886159/Nomi/pull/363) 并发按 commit 分组（合同 `docs/fixes/2026-09-02-main-push-concurrency-cancels-evidence.root-cause.json`）
- PR [#365](https://github.com/aqm857886159/Nomi/pull/365) 工具面断言改 derive + 新增 `check:mcp-tool-refs`（合同 `docs/fixes/2026-09-02-stale-hand-copied-surface-baseline.root-cause.json`）
- PR [#366](https://github.com/aqm857886159/Nomi/pull/366) 技能资源 e2e 接进执行链（合同 `docs/fixes/2026-09-02-unwired-stale-skill-resource-test.root-cause.json`）
- 触发面的对照组：`tests/ux/mcp-l1-handshake.e2e.mjs`（跟上了）vs 修复前的 `tests/ux/packaged-mcp-smoke.e2e.mjs`（落后了）

## 已接管的部分

- **原则已升进 `CLAUDE.md` 贯穿条**（挨着「derive 不 hardcode」），每轮加载，不必翻本条也会被顶到眼前。
- **`check:mcp-tool-refs`**（`gates:contracts`，每次都跑）接管了「测试引用了不存在的 MCP 工具名」这一面；故意的未知工具探针须显式标 `unknown-tool-probe`。
- **`build-delivery-ledger.node-test.mjs`** 的可达性属性测试接管了「committed 生成物是否可合并」，含阳性对照防门岗自身失去分辨力。
- **`check-quality-gate-workflow.node-test.mjs`** 的类级断言接管了「push 触发 + 取消式并发组必须含 `github.sha`」，扫 `.github/workflows` 全部文件。

**仍未被门岗覆盖、只能靠人的**：判断一个数字是「自己造的」还是「抄来的」；以及新写的 e2e 有没有被接进执行链（本轮刻意没造「扫全仓 e2e 是否被引用」的门岗——要先判定哪些是可执行入口、哪些是被 import 的 helper，误判成本高，见 #366 合同的 `residual_risks`）。
