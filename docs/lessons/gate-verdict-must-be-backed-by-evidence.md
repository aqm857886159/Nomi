# 门岗只能下它这一趟真拿到证据的那个结论——退出码不是证据

> 📎 教训 · 首次记录 2026-09-06 · 状态：✅ 已固化（由 `tests/ux/design-lab/failureTriage.mjs` + `labServer.mjs` 接管）
> **触发场景**：门岗红了，但它指给你的证据文件**根本不存在**（让你去看差异图 / 日志 / 快照，你去了发现目录是空的）；或同一条命令换个时间跑就全绿。

**结论**：门岗的每一句结论都必须有**这一趟真拿到的证据**撑着。说「视觉基线不符」的唯一许可证是磁盘上真的躺着 `-diff.png`；说「服务器不可达」的凭据是输出里的连接类错误。**证据不足时要说「没能得出结论」，不许拿一个听起来最像的结论顶上去。** 遇到这种红灯，先看它承诺的证据在不在——不在的话红的是工具，不是你的改动。

**为什么会踩**：`scripts/check-design-lab.mjs` 用 `spawnSync(..., { stdio: 'inherit' })` 跑 Playwright，**脚本自己看不见任何输出**，手里只剩一个退出码。于是 `if (result.status !== 0)` 后面无条件打印「❌ 视觉基线不符。差异图在 test-results/ 下……这是设计改动被拦住了，不是工具坏了」。那句话里有两个断言，一个都没验证过。

2026-09-06 实测两次（load ≈16 与 ≈30）：46 条用例全体 `page.goto: net::ERR_CONNECTION_REFUSED`、**0 张 `-diff.png`**，门岗照旧那么说。真实报错躺在 `test-results/**/error-context.md` 里，没人会想到去翻——因为门岗已经斩钉截铁地说「不是工具坏了」。机器闲下来时同一条命令 46/46 全绿。

底下还有一层根因：实验室的三个 dev server 端口写死成**整台机器的全局单例**（视觉道 5197、两条走查 5198/5200），而 `reuseExistingServer` 只探「这个 URL 有没有人应答」。这台机器常年挂 20+ worktree。当天 05:22 实测 `lsof -nP -iTCP:5197 -sTCP:LISTEN` → pid 21513，cwd 是 `Nomi-storyboard-v6-lab` **另一棵 worktree**：在本树跑门岗，比的会是别的分支的 UI（假绿），而那棵树的 vite 一退出，本树剩下的用例就全体连接被拒（那 46 条的来源）。走查那条更隐蔽——`vite` 用 `stdio: 'ignore'` 起，`--strictPort` 撞口的报错被咽掉，`waitForServer` 对着别人的服务器探测成功，整份截图静静地拍了别的分支。

**怎么用**：
- **判断门岗红灯前先验它承诺的证据**：`find test-results -name '*-diff.png' | wc -l`。是 0 就不是像素问题，去看 `test-results/**/error-context.md`。
- **写门岗时，结论由证据分档**：现在 `triageLabRun()` 分四档（视觉不符 / 预览服务器不可达 / 缺基线 / 基础设施可疑），每档的说辞只说该档的话，并把 `load` 和排查顺序一起报出来。加新的失败模式就加一档，**不要塞进现有那句话**。
- **失败说明控制在 15 行内**：`gates:contracts` 汇总只回放失败门岗输出的最后 `FAILURE_TAIL_LINES`(=15) 行，超出去的在汇总里看不见（已有断言钉住）。
- **本地开的服务端口不许写死**：用 `tests/ux/design-lab/labServer.mjs` 的 `labPortFor(role)` 按 worktree 派生，并在取像素前 `assertLabPortOwnership(role)` 证明应答者的 cwd 就是本树。**「有人应答」永远不等于「是我起的那个」。**
- 与 [[parallel-gates-thrash-the-machine]] 的分工：那条讲「超载时超时类红灯不作数、先看 `uptime`」；本条讲**为什么人看不出该去看 uptime**——门岗当时正言之凿凿地说这是设计问题。现在 load 由门岗自己打印，不再指望人记得。

**出处**：`docs/fixes/2026-09-06-design-lab-failure-mode-misreported.root-cause.json`；修复前后的死端口实跑日志见该 PR 描述。
