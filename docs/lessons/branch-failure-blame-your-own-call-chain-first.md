# 真机走查里的失败先查自己这条分支的调用链，再怪环境

> 📎 教训 · 首次记录 2026-09-14 · 状态：现行
> **触发场景**：在自己的分支上跑真机/隔离实例走查，某个工具恒定失败，你正准备把它归因成「隔离 profile 解不开密钥」「供应商不可用」「环境没装好」并写进 PR 正文。

**结论**：**一个在你分支上 100% 复现、错误码来自你自己代码的失败，默认是你的分支引入的，不是环境。** 先做两件事再下结论：① 顺着错误码反查它在你分支上的**产生点**（`grep` 那个字面量），看产生条件需不需要「环境坏」才能成立；② 在 `origin/main` 上跑同一条探针，看名字/形状是不是本来就对得上。两步都做完仍指向环境，才许写「环境问题」。

**已经栽过的那次**：PR #777 把模型面改成 20 个动词，`draft_shots` 在真机上 5/5 次返回 `generation_surface_unavailable`。作者把它归因成「隔离 profile 无法解密存储的凭据」（`generation-readiness-20260913.md`），并在 PR 正文写成「was safely blocked by generation_surface_unavailable」当安全证据。实际上：`generationTransportAdapters.ts` 的 `safeFailure` 会把任何含 `provider|catalog|credential|model` 的错误码统一映射成 `generation_provider_unavailable`——凭据问题**结构上产不出** `generation_surface_unavailable`；那个码只从 lane 的 `?? failure('generation_surface_unavailable')` 出来，条件是适配器 `return null`，而 `return null` 的条件是翻译层翻出的 `nomi_generation_plan` 不在适配器手写的白名单里。与环境无关，整组生成动词恒死。一条 20 行的探针（`probe2.mts`：遍历延迟目录，逐动词问适配器认不认翻出来的名字）当场照出四条红。

**怎么用**：
- 错误码是自己代码的字面量 → 先 `grep -rn '<code>' electron src` 找产生点，读它的**触发条件**；条件里没有「环境」这个变量，就不是环境。
- 「隔离实例」「凭据」「供应商」这类解释要带**排除证据**：在 main 上同一探针绿、或把那个变量换掉后失败消失；没有排除证据的环境归因不进 PR 正文。
- 修法要加**门岗**而不是补名字：两份真相源之间加机器判据（`laneVerbTransport.test.ts` 那种「翻出来的名字必须被认」），否则下一次改名照样静默失败。
