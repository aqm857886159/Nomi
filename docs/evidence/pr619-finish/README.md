# PR #619 补验现场

> 状态：🚧 局部验证完成；完整任务尚未通过，不可据此合并。

对应方案及逐项差异：[2026-09-10-pr619-finish.md](../../plan/2026-09-10-pr619-finish.md)。

## 实机记录

运行原有 `tests/ux/find-reference.walk.mjs`，没有改断言或超时。真实 TikHub 检索 **1 次**，查询「护肤精华」，返回 **7 条**、封面 **7/7** 绘制成功；一条素材真实保存为 `reference_only`，返回后出现在「找来的参考」筛选内。使用全隔离 Electron 设置、项目与 user-data，未碰真实资料库，key 仅来自环境变量。

| 步骤 | 截图 | 人眼判断 |
|---|---|---|
| 空素材库 | [空态](before/03-asset-library-empty.png) | CTA 可发现；与获批 EmptyEntry 的就地输入有差异。 |
| 搜索结果 | [结果](before/08-results-covers-settled.png) | 三列卡片，点赞/收藏清楚，封面真实加载；未提供画板中的筛选与平台说明。 |
| 加入后返回 | [返回](before/12-back-to-library.png) | 刚加入素材可见；接管区+返回条属 09-08 已实现布局，与 handoff Main 的原素材网格共存布局不同。 |

本次只验证了 **关键词搜索→加入 1 条**。未把它冒称为「链接找 3 条」，也未把实验室空结果冒称为供应商真实失败。

## 实验室回归快照

四态均为现役产品组件，数据来自仓内真实响应夹具经 `referenceSearch.ts` 正常归一；只去掉短时远程封面以避免像素回归访问网络。每平台现有夹具只有 2 条，未复制成 3 条充数。没有造中文转译结果：英文索引直接输入英文，清楚保留未接转译这一缺口。

- [Main](specimen/fr-main.png)
- [EmptyEntry](specimen/fr-empty-entry.png)
- [PlatformEvidence](specimen/fr-platform-evidence.png)
- [FailStates](specimen/fr-fail-states.png)

快照实际保存在 `tests/ux/design-lab/__baselines__/find-reference/`，统一 Playwright 视觉规格在禁更新模式下 **5/5** 通过（含注册表活性）。四态截图均已人眼查看：证据顺序正确，空结果出口可用；空态/筛选/平台持久化/自动转译仍未对齐，**不能称为设计验收通过**。

## 复跑

```sh
node tests/ux/find-reference.walk.mjs
pnpm exec playwright test -c tests/ux/design-lab/playwright.config.mjs --grep 'design lab · find-reference'
python3 scripts/with-gates-lock.py -- pnpm run gates
```

真实脚本需要环境变量 `TIKHUB_API_KEY`；不得为了复跑从用户设置或钥匙串提取 key，不得突破任务书真实检索次数上限。

## 链接真实任务的失败证据

新增 `tests/ux/pr619-reference-task.walk.mjs` 探针原定「贴已知公开抖音链接导入，再搜索同主题并加入 3 条」，明确不是相似检索。前两次未进入检索，分别暴露探针的 hash 路由取值和素材库未展开问题；仅修取值和真实导航，没有改断言或超时。

第三次成功走到真实链接入口，但 TikHub 返回预期外数据，UI 已显示该失败。保持 60 秒落盘判据，结果 **0 条素材**，任务失败。尚未执行其后的搜索和加入三条，不重试碰运气。

[贴入链接](task/02-pasted-link.png) · [真实失败界面](task/failure.png) · [机器收据](task/receipt.json)

累计：真实关键词搜索 **1 次**；另有 **1 次真实贴链接解析尝试**（解析链内部可能访问主/备接口，此处不将一次 UI 操作冒称为一次 HTTP 请求）。无相似检索成功证据，无三条入库成功证据。

## 第一轮固定超时门岗冲突（第二轮已迁移）

`check:test-waits` 在并入最新 main 后拒绝旧 `find-reference.walk.mjs` 的 7 处固定 timeout；新诊断脚本有 4 处相同风格。任务书禁止改走查断言或超时换绿，因此保留原样并明确报告。没有修改 gate、基线豁免、断言或延长等待。


## 整合修正后复验

main 更新至 `e114ae0a10f9`，本地整合 head `a06208d2416c56790c570db9edb602c0d2828908`。构建成功后再次原样跑 `find-reference.walk.mjs`：通过、控制台零错误。新增真机后图：

- [空态 after](after/03-asset-library-empty.png)
- [结果 after](after/08-results-covers-settled.png)
- [返回 after](after/12-back-to-library.png)

本轮累计 **2 次关键词检索 + 1 次贴链接解析操作**，停止真实调用。该复验仍仅证明关键词搜索/加入一条的闭环，不证明链接找三条；四画板差异未被此次整合修正消除。

## 第二轮收尾验证

两个走查的 11 处固定预算迁入共享 `stationTimeout`；DOM/落盘 predicate 和成功 matcher 均保留，未延长上限、未修改门岗或截图基线。`check:test-waits` 从 11 处新增违规变为 0；共享断言测试 8/8 通过。完整 gates 结果以 PR 第二轮收据为准。

第二轮不追加真实检索；累计仍为 2 次关键词检索 + 1 次贴链接解析操作。上面的 R13 截图来自第一轮真实运行，链接任务失败与四画板差异仍然成立。

实验室四态基线名单：

- `tests/ux/design-lab/__baselines__/find-reference/fr-main.png`
- `tests/ux/design-lab/__baselines__/find-reference/fr-empty-entry.png`
- `tests/ux/design-lab/__baselines__/find-reference/fr-platform-evidence.png`
- `tests/ux/design-lab/__baselines__/find-reference/fr-fail-states.png`
