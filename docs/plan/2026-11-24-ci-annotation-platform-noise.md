# Q-ci-noise · GitHub 平台基础设施抖动注解归源委派

协作看板 #1586 · #7121704908 · 实现线 q-ci-noise-impl。纯 CI 脚本，不起 Nomi 窗口。

## 短版设计卡

- ★1｜合并值守在 job 完成后，由汇总 job 读取 GitHub job 结论、收集 Check Annotations、判定归属、写报告并生成收据。目标是基础设施恢复后收据继续流转，维护项和未归属错误仍阻断。量具为 `node --test scripts/ci-annotation-hygiene.node-test.mjs`：样本取 11-22 `752ade403` 下载与退避、11-23 `ade9c41a3`（#1639）检出、11-24 `f5c3cf05d`（#1647）缓存恢复三次事故，原文委派率从当前 2/4 到 4/4，负例拦截率维持 100%。无连带界面和存量应用数据迁移，现有报告格式继续可读。
- ★2｜GitHub 拥有 job 结论和注解字段，`scripts/ci-annotation-hygiene.mjs` 拥有审计中的注解归属，`scripts/lib/transientRetry.mjs` 的 `isTransientGitFetchError` 拥有 Git 瞬断判定。唯一生产调用方是 `.github/workflows/quality-gate.yml` 的 `Quality Gate` 汇总 job（`Audit CI annotations` 步骤）。`node scripts/door-map.mjs ci-annotation-hygiene.mjs --roots=.github/workflows,scripts --read=evaluateAnnotations,collectRunAnnotations` 枚举同一脚本内的两个读入口，分别采集和裁决。工作流引用另由 `rg -n 'ci-annotation-hygiene.mjs' .github/workflows` 核实。GitHub 负责重试和终态，`success` 才进入本次委派分支，证据不可用交审计报错。
- ★3｜① 继续给逐条文本加正则，`2c6d74d46` 只覆盖下载和退避，检出与缓存恢复再次停线，后续缓存保存或镜像拉取仍会遇到新文案。② 选择按来源结构判并检查自家输出，成功 job 的无标题 `.github` warning 统一委派，failure 还需匹配 Git 远端诊断并由共享函数判为瞬断，同提交删除旧正则。#1656 已修 Validation Scope 冷启动抓取，最新基线使用 checkout v7，官方 fetch 仍有重试。③ 将 `.github` 全部降为记账会放过弃用与吞错。Action、Node 运行时及 `save-state`、`set-output` 等弃用信号应进维护待办，迁移窗口可用有期 allowlist 并升级 Action。本补丁沿用当前 GitHub API 与 checkout；GitHub 若提供可核验的生产者身份，用三次事故和反例验证后替换结构推断。依据为 [GitHub Check Runs API](https://docs.github.com/en/rest/checks/runs#list-check-run-annotations)、[工作流警告命令](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands#setting-a-warning-message)、[checkout v7 fetch 实现](https://github.com/actions/checkout/blob/v7/src/git-command-manager.ts)。
- ★4｜空报告通过；采集中等待 GitHub 结论；成功后平台注解仍列 `delegated`；存在意外项或证据不可用时报告失败；部分委派仍由其余意外项决定失败；取消或未知结论不触发本次委派；过期 allowlist 仍判红。API 不可用时读报告并在证据恢复后重跑。
- ★9｜自验与接手线均用 `node --test scripts/ci-annotation-hygiene.node-test.mjs` 回放四条事故原文，保留带路径、带标题、弃用、job 失败、空缺结论、非瞬断 Git 错误、无 Git 证据的网络错误和步骤吞错为反例；故意加裸 warning 必须使扫描变红，带 `file` 或 `title` 的现有输出通过；旧实现和全拦版本均须红。回滚用 `git revert` 撤销此提交。比较的是相同注解和结论经过同一裁决的结果，合并 SHA 上的真实收据须另验。

## 系统改进

1. 定为 recurring。下载、检出和缓存共享注解裁决入口，原有判据按消息列白名单，遇到另一种已恢复的基础设施抖动会误阻断。
2. 最早可拦在注解门岗的来源判定和生产者约束。`scripts/ci-annotation-hygiene.mjs` 未绑定平台注解形状，仓库也没有扫描手写告警是否省略标识。
3. 用共享裁决删除旧的逐条规则，并由 `scripts/ci-annotation-hygiene.node-test.mjs` 扫描工作流与非测试脚本的手写告警命令。既有 `scripts/vitest-flaky-reporter.mjs` 直接带文件与标题，`scripts/run-gates-contracts.mjs` 通过格式化函数强制输出标题。2026-12-01 复查最近合并收据与测试，预测这类已恢复抖动误阻断为零，弃用和真实错误仍失败；复发则重开。静态扫描覆盖手写命令，动态拼接和第三方生产者身份仍依赖现有约定。按任务限定范围，根因记录随本卡交接。

适用仓库规则 P1、P2、P3、P5。门岗为注解卫生、`scripts/lint-changed.mjs`、`scripts/check-concept-owners.mjs` 与 `scripts/check-pr-judgement.mjs`。

## 真实场景复现

- 用户的流程：在 `main` 合并后等 `Quality Gate` 首次运行出收据，三次触发 job 自身成功但汇总失败。
- 我走的：从 Actions Jobs API 核对三次首尝试的结论，从 Check Runs API 取 job `137178160951`、`138007074731`、`138196946859` 的实际注解，交基线与新裁决逐组回放。
- 差别：本地回放使用历史响应，未再次触发 runner 网络故障或在新提交上生成远端收据。11-22 下载原文的 API 版本含末尾空格，单测保留任务提供的字面原文，API 回放保留末尾空格与该 job 的第二轮退避注解。
- 修前：最新基线的意外项数依次为 0、1、1，11-22 已被 `2c6d74d46` 覆盖。
- 修后：意外项数为 0、0、0，平台委派数为 4、1、1。两个 Unit job 的真实 vitest 重试提示仍走原委派。注入裸 warning 时两种语法均使扫描失败，带标识的对照通过。未验证：新提交的远端收据，本次仅本地提交。
