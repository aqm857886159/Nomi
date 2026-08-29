# 根因治理与媒体边界修复实施计划

日期：2026-08-27
状态：✅ 已交付
对应设计：`docs/superpowers/specs/2026-08-27-root-cause-remediation-governance-design.md`

## 范围

本计划同时交付可执行的根因修复治理、ComfyUI 媒体绑定类型约束与存量迁移、自定义调用引用角色生成约束、上传前本地图片字节校验，以及覆盖这三类行为的回归测试。没有可靠生成来源标记的既有 Custom Call 脚本不做静默迁移。

## 不动项

- 不改供应商模型 UI，不新增 Kling/MiniMax 专用界面。
- 不改变 `references` 已有公开字段名和正常脚本调用方式。
- 不为旧实现保留永久 fallback。
- 不把本地 `.claude` 配置作为 CI 依赖。
- 不猜测 BananaRouter 未能核验的具体 API 端点或字段。

## Task 1：建立根因合同门禁的红例

文件：

- 新建 `scripts/root-cause-contracts.mjs`
- 新建 `scripts/check-root-cause-contracts.mjs`
- 新建 `scripts/check-root-cause-contracts.node-test.mjs`

步骤：

1. 写 fixture：高风险生产文件变化但没有合同，期望失败。
2. 写 fixture：合同缺少类根因、来源或变化中的回归测试，期望失败。
3. 写 fixture：低风险文档变化，期望不触发。
4. 写 fixture：完整合同覆盖生产文件和测试，期望通过。
5. 运行测试确认红例先失败，再实现最小解析与验证逻辑。

## Task 2：接入仓库规则和单一技能真相源

文件：

- 修改 `CLAUDE.md`
- 运行 `scripts/gen-agents-md.mjs` 更新 `AGENTS.md`
- 修改 `.gitignore`
- 新建 `.agents/skills/root-cause-remediation/SKILL.md`
- 修改 `docs/engineering-rules.md`
- 修改 `package.json`
- 新建本次 `docs/fixes/*.root-cause.json`

步骤：

1. 新增短规则 R21，只定义触发条件和必须读取的技能/合同。
2. 把详细调查方法放在单一技能文件，不复制到多份 Agent 配置。
3. 将门禁测试和检查器加入 `gates`，保持 `check:gates-chain` 可达。
4. 提交本次真实根因合同，覆盖后续生产改动和回归测试。

## Task 3：封住 ComfyUI 非媒体槽绑定

文件：

- 修改 `electron/catalog/comfyuiWorkflowBindingNormalize.test.ts`
- 修改 `electron/catalog/comfyuiWorkflowBindingNormalize.ts`
- 新增 `electron/catalog/catalogMediaContractMigration.ts`
- 修改 catalog 版本与迁移接线

步骤：

1. 构造精确回归：旧图片绑定指向 `VHS_VideoCombine.frame_rate`，原值为 `24`。
2. 先确认现实现接受该绑定或最终覆盖数值。
3. 在统一归一化入口要求媒体目标当前为字符串槽。
4. 断言旧坏绑定被删除、`frame_rate` 保持数值、正常图片槽仍可绑定。
5. 用真实 v10 catalog fixture 证明旧 mapping 会在 v11 原子重建，用户无需删掉重导。

## Task 4：封住自定义调用的引用角色提升

文件：

- 修改 `electron/catalog/customCallContract.ts`
- 新增 catalog v11 的窄迁移逻辑
- 修改对应 `*.test.ts`

步骤：

1. 写测试证明只有 `images[]` 时 `firstFrame` 必须保持缺失，图片顺序与数量不变。
2. 写迁移反例证明 v11 不改任何既有 Custom Call 脚本：历史数据没有可靠生成来源标记，源码形状不能证明它不是用户或其他模型有意逻辑。
3. 更新脚本生成材料：禁止角色推断；官方材料不足时禁止猜接口。
4. 不在运行时用源码正则阻断任意脚本；证明注释、字符串和复杂用户逻辑不会被误改。

## Task 5：验证 Nomi 上传前本地图片字节

文件：

- 修改 `electron/catalog/assetLocalization.ts` 或新增边界验证模块
- 修改相应单元测试

步骤：

1. 写纯函数测试：栅格声明必须匹配全局媒体表对应魔数，HTML/XML、标签错配 SVG 与损坏文件失败。
2. 写集成测试：伪装成 `.png` 的网页字节不会调用任何上传端点。
3. 合法 SVG 用严格 XML parser 通过；AVIF/HEIC 同时识别 major/compatible brands，BMP/TIFF/ICO 补齐魔数验证。
4. 不主动回抓远端 URL，避免多图重复下载、取消泄漏与重定向 SSRF。

## Task 6：验证与交付

按顺序执行：

1. 相关 `node --test` / Vitest 精确测试。
2. `pnpm run check:filesize`
3. `pnpm run check:tokens`
4. `pnpm run check:i18n`
5. `pnpm run lint:ci`
6. `pnpm run typecheck`
7. `pnpm run test`
8. `pnpm run build`
9. `pnpm run gates`（确认新增门禁在完整链中）。
10. 刷新 `origin/main`，处理漂移后重复关键验证。
11. 只提交范围内文件，推送 `codex/fix-comfy-customcall-20260827`，创建 PR。

## 回滚

- 规则/门禁：回滚 R21、技能、检查器、合同与 `package.json` 脚本即可，不改变产品数据。
- ComfyUI：回滚 v11 迁移与新导入类型约束；迁移只在能由旧 prompt 证明错绑时写盘。
- 自定义调用：保留明确角色合同与新脚本生成约束；v11 和运行时都不改写任意既有脚本。
- 本地媒体验证：回滚上传前 markup/魔数检查；不涉及远端回抓或供应商分支。

## 验收门

- 每个生产修复都有先失败后通过的精确测试。
- 本次根因合同通过新的门禁并覆盖所有高风险生产文件。
- 不新增供应商专用分支或双实现。
- 用户原始两个报错都能映射到明确的不变量与测试证据。
- 完整门禁全绿后才允许提交和推送。
