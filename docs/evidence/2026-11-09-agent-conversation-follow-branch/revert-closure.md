# 撤销单帧例外与推送档复核

9be45c36c通过git revert撤销cbb00c202，不重写历史。走查字节与a66e3c477一致，回到原每帧≤70px，无单帧例外；临时纯判定及其单测删除。514f9664f的反例、全帧和截图全部保留作历史证据：实测连续2帧、合法例外0/0，错误前提下的特例不保留。

按协调恢复的原决定：main输出中625px，本分支输出中≤49px，仅发送首挂2帧83/104px（中文原始103.5px）是库ResizeObserver→rAF调度间隙。合同不改、两格仍红，作为已知限制交付；D3-12先查上游同步选项，再量人眼可见性。本次没有重跑原生走查，没有把旧两红改标绿。

协调已经复核用户报的输出跟随与切线程落点，账本status/manualReview转reviewed；evidence有原70px修后日志、修前B534px图及几何、最近一次29格结果和逐帧限制，completionCommits为08f780393与c6f87434c两个真实祖先修复提交。实际reviewedContracts推送判定通过；无fixed/fixedInPr，真实PR号和独立验收留待推送后。

正文六项预检全0：[回执](revert-body-precheck.txt)。推送档reviewed被接受；不等于合并/独立验收或原生两红转绿。

## 实际检查

在a30d248b3、槽A锁和原security-run.py内顺序执行：

1. pnpm run typecheck：退出0，5份通过，27.9s。
2. NOMI_PR_BODY_FILE=.tmp-pr-body.md node scripts/pre-push-contracts.mjs：退出1，50.8s，67项通过、仅check:filesize红。

[原始typecheck收据](revert-typecheck.txt)、[完整快检收据](revert-quick.txt)、[摘要](revert-validation-summary.json)。其中test:scan-guards 62文件、test:related的18份vitest及5份node:test、check:test-waits、check:walkthroughs、check:escape-ledger、check:pr-judgement全部通过。这里是完整运行的结果，没有把专项测试当全套通过。

唯一非提醒的阻塞为现origin/main（ab5a9d290）已在69daa390c收紧三条体积基线：

| 文件 | 本分支继承上限 | 当前origin/main |
| --- | --- | --- |
| electron/runtime.ts | 660 | 657 |
| electron/productionRun/productionRunDriverOps.ts | 1141 | 1130 |
| electron/productionRun/productionGenerationSubmission.ts | 772 | 755 |

三处产品和scripts/file-size-baseline.json相对已合入的f88b7f042均无本分支修改。守卫按当前origin/main比较全部基线，因此旧上限被判为上调。没有改守卫/基线，也没有设置NOMI_FILESIZE_ORIGIN_REF绕比较；未整合范围外产品变更。此红不属于“fixed等真实PR号”的允许提醒，不能报快检达标。

本轮未跑thinking-overlap、真实模型或付费，未起Electron；无推送、PR或gates。仍需处理主线基线整合，且原两条70px检查保留为已知限制。
