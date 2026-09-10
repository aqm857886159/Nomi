# 实验夹具必须经过真实调用点的投影

2026-09-10：分镜可靠性 loopback 手写 GPT Image 2 的 `params.size=1K/2K`，生产档案却使用 `resolution`。前两轮由此产生环境假阴性，不能靠改断言或重复付费修复。

目录从 catalog DTO 经 `tests/ux/agent-runtime-fixture.mjs` 的 `projectAgentRuntimeModels` 调用真实 `toCatalogModelOptions → buildAgentModelEntries`。案例参数从返回的 mode.params 导出键和值；缺少模型或档位时在提交前显式失败。供应商线缆字段名不等于计划 canonical 字段。

回归：`tests/ux/storyboard-reliability-cases.test.mjs` 覆盖两个供应商、两档清晰度与缺失前提。原失败证据留在 round-1/2，不回写成成功。真实模型仍接收原用户十句，不接收 loopback 的工具参数。
