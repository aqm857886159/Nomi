# MCP elicitation e2e 可达性补漏

## 范围

- 为 `tests/ux/mcp-generation-elicitation-first.e2e.mjs` 增加明确的 `pnpm` 脚本入口。
- 将该零额度、隔离 Electron 的 journey 接入 Linux quality gate 与 desktop RC 的 release-critical journeys。
- 更新 workflow 合同测试，锁住“脚本存在且 CI 会执行”的接线。
- 修正该 e2e 对当前 MCP session/mode、capability 目录装配和 loopback provider fixture 合同的漂移，保证它能到达既有断言。

## 不动项

- 不改 e2e 的断言、确认流程或 skip 行为；provider fixture 只按现行隔离 loopback 合同修复，不引入真实额度。
- 不改现有 `skills-lock.json` 脏改动。

## 验收与回滚

- 合同测试先因缺少新 lane 红灯；补齐接线后恢复绿。
- 直接运行新脚本，保留 `started` 断言通过原始输出。
- 临时使 gate receipt 缺失，直接运行新脚本必须红；恢复后再次运行必须绿。
- 回滚仅删除新增脚本与两处 workflow lane，并同步撤销合同测试期望；e2e 的 fixture 合同修复随同回滚。
