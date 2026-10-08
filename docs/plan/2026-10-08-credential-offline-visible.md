# 离线凭据可见性修复设计卡

变更名：离线保存的密钥显示“已保存 · 未验证”，材料存在与可用性分离
负责人：当前修复线
类别：[功能交付][长跑]

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当用户离线保存密钥时，设置页继续显示“已保存 · 未验证”；联网后沿用现有自动复验；验证失败保留原密钥并显示失败原因。 | `tests/ux/credential-offline.walk.mjs`；`src/ui/onboarding/KnownVendorKeyConnectPage.tsx` |
| ★2 谁说了算 | 主进程 `readCatalog` 是 `hasApiKey` 的唯一投影 owner；`deriveModelAvailability` 是“当前能不能用”的唯一 owner；渲染层只消费两者。 | `electron/catalog/catalogStore.ts`；`electron/shared/modelAvailability.ts` |
| ★3 一致与复用 | 复用现有 `apiKeyDecryptStatus`、`credentialRecordCounts` 与 `createCatalogAvailability`，只拆开材料存在和启用门槛；不新增供应商分支。 | `electron/catalog/secrets.ts`；`electron/catalog/catalogModelAvailability.ts` |
| ★4 全状态 | 无材料显示未配置；有材料且待验证显示已保存·未验证；验证通过且启用显示已接入/可用；解密失败显示锁定原因；验证失败不覆盖旧密钥并显示失败原因。 | `electron/catalog/credentialStateMatrix.test.ts`；中英文 `onboardingProviders.keyOnly` 文案 |
| ★9 验收与回滚 | 先跑红的状态矩阵和本地 Electron 走查，再跑改动目录测试、根因契约检查和 `pnpm run build`；回滚为还原本提交。 | `pnpm exec vitest run ...`；`node tests/ux/credential-offline.walk.mjs`；`pnpm run build` |

### 功能分类
- [x] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 异步状态
- [ ] 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 长列表
- [ ] 生成结果
- [x] 数据格式 / 状态投影
