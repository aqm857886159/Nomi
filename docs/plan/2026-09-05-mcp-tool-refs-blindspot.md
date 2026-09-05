# MCP 工具引用门岗盲区修复

> 状态：✅ 已交付

## 范围

- 从 `MCP_TOOL_RESOLVER` 派生合法工具名，扫描 `tests/` 与 docs 可执行示例中的 `callTool(...)`、`tools/call` `name` 和模板字面量。
- 用 node:test 固定阳性旧名、阴性现役名、host fixture 与 NUL 字节输入。
- 删除 4 个无 runner 且依赖已退役 `nomi_generate` 的走查文件；不为退役单镜生成伪造等价调用。
- 不修改 `electron/capabilityCore/mcpIntegrationTools.ts`。

## 验收

1. 修复前门岗对 9 处调用 exit 0 的证据保存在交付记录中；修复后门岗报告全部引用命中目录。
2. node:test 阳性对照在 `callTool('nomi_retired_x')` 上识别为非法，阴性与 host fixture 通过。
3. `pnpm run gates` 全绿；提交与推送前由版本化 Ponytail hooks 评审。

## 回滚

回滚本提交即可恢复扫描器、node:test 和已删除的孤立走查；不涉及用户数据迁移。
