# Ponytail 大分支读取修复

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

本次A＋T7交付遇到真实阻断：`review:branch`在模型调用前报`spawnSync git ENOBUFS`。最终分支unified=80 diff为8,106,786字节，大于既有8,064,000字节Git捕获缓冲。先整读、后分块使150KB分块机制还没执行就失败。已推任务分支，未合并；旧deferred收据不代表通过，补审前门岗继续红。

## 范围与原实现复用

只修原`scripts/ponytail-review-branch.mjs`的diff读取/分块边界和原node-test。保留真实merge-base→HEAD、80行上下文、150KB模型输入、原packUnits、每块10分钟、二进制摘要、明确的超大单文件截断政策和现有receipt/hook身份验证。不改变产品、分镜、T7、包或供应商执行；不增预算、不过滤审查路径、不改默认分支、不合并。

原实现已经有`splitFilePatches → makeUnit → packUnits`，问题只是它依赖整份stdout先装入内存。优先用Node原生child_process/fs：Git stdout直接落私有临时文件，再以固定缓冲读取并按真实`diff --git`行切边界。单个超大文件也要边读边计数、只留原单块所需前缀；失败必须抛错而不是空diff/pass，临时文件finally清理。无第三方依赖、无新通用框架。先检查实际实现与门表，实施代理可在这些约束内选择更小的等价写法。

## 验证与收货

1. 真实临时Git仓复现超过旧总缓冲的多文件，以及单个超大文件；保末尾文件、UTF-8、原限额和显式截断。先红后绿，不仅mock child返回。
2. 原receipt/tree/failure/findings/hook/deferred测试一并运行。原非法Git范围不能产pass收据。
3. 主代理独立审查所有新差异，更新根因合同和最终完整审计账本。产品生产源码仍与已验build相同，不把工具修复冒称重新跑GUI。
4. 提交工具修复后真实重跑Ponytail全分支，处理报告发现。只有实际通过/处理完发现后才按既有流程清理旧deferred；未成功保持明确阻断。PR正文写实际结果，不反写旧失败。

## 回滚

若实现证明不正确，仅撤此后续工具读取修复，保留原A＋T7产品提交及全部失败证据；不删除审计文件，不伪造收据或绕hook。回滚后的Ponytail仍为未完成，不可合并。

## 先查别人

以下为本次实际查阅依据的集中记录，补齐方案模板；不把后补文档写成事前已经完成的外部调研。

- 依赖已有：已读安装的 `node_modules/@types/node/child_process.d.ts:669`（stdio支持fd）、`fs.d.ts:1967/2707`（mkdtempSync/readSync）、`string_decoder.d.ts:1–58`（跨缓冲多字节保护）。复用Node原生API，UTF8没有自写codec；其引用的[Node源码](https://github.com/nodejs/node/blob/v22.x/lib/string_decoder.js)为来源链接，本轮未声称额外联网核验。
- 仓库已有：已完整读[原适配器](../../scripts/ponytail-review-branch.mjs)的range/packUnits/makeUnit、[原评审测试](../../scripts/ponytail-review-branch.node-test.mjs)和[原收据hook](../../scripts/ponytail-review-hook.mjs)。保留它们的范围、截断/装箱策略和树身份，不新建评审服务。
- 既有安全边界：已读[收据校验测试](../../scripts/ponytail-review-hook.node-test.mjs)与[延后账本测试](../../scripts/check-ponytail-deferred.node-test.mjs)，证据身份仍按tree匹配，Git读取失败不得落pass，旧deferred须真实补审后关闭；保留原判据，新增读取器不另签收据。
- 生态/通用解法：标准进程stdout重定向加固定缓冲文件读取已覆盖问题；原始症状与Git实际输出字节数能直接证伪“分块已保证上游有界”的假设。不新增第三方stream框架或Git库。
- TikHub/用户自媒体：本次是内部交付脚本的可复现缓冲错误，用户反馈不能决定Node字节读取不变量，未作自媒体调研；不编造链接或声称查过。
- 反方/结论：增大maxBuffer只是移动阈值；缩上下文、删除审查文件会削弱评审；逐文件启动Git会重复进程开销。复用原Git输出、Node读取和原装箱，在最早入口约束内存；独立审查必须核UTF8及最后文件，实际发现并修复了初版行首切半问题。
