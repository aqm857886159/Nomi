# 设计卡：Windows 上旧文件身份判断（L-winlegacy）

改动名：文件身份比较收成一个共享判断    线/负责人：L-winlegacy    类别：[其他]（纯修 bug，不花钱、不长跑、无界面）

| 格 | 内容 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当 Windows 用户升级后首次打开有旧 Agent 对话的项目，我想让旧对话被迁移而不是报 `legacy-file-identity-or-content-changed`。不做：不改迁移协议、不改读写顺序。已知坑：产品跑在 Electron 43（libuv 1.52.1），实测 dev 本就一致，用户端当前不会中招；会中招的是 libuv<1.51 的 Node（本机 22.15 / 验收线），以及全仓 Number 版 ino 在 Windows 丢精度的隐患。真实任务：lane-legacy-migration 34 条用 Electron Node 与 Node 22.15 各跑一遍。 | `.tmp/agent-runtime-tests/.../lane-legacy-migration.test.mjs` |
| ★2 谁说了算 | 概念：文件身份。唯一 owner：`electron/fileIdentity.ts` 的 `sameFileIdentity`。消费者：laneLegacyFiles、antigravityArtifacts、assetWriteContext。碰 1 个概念。 | `node scripts/door-map.mjs sameFileIdentity`（4 处出现，3 个调用文件，1 个实现） |
| ★3 一致与复用 | 之前三处各写各的，antigravityArtifacts 为同一差异单独写过 win32 分支；现收成一份并删旧。不是通用能力的重写，是 Node 自带 stat 的包一层规则，理由是领域约束（保住「读的过程中被换文件」防线）。 | `git grep -nE "\.ino\s*[!=]==?"` 只剩 fileIdentity.ts；类级测试 |
| ★4 全状态 | 无界面。失败仍是原来的内容无关错误 `legacy-file-identity-or-content-changed`，文案不变。 | 不适用：无用户可见文案 |
| ★9 验收与回滚 | 验收：另一条线在 Windows + Node 22.15 与 Electron Node 各跑 lane-legacy-migration 与 `electron/fileIdentity.test.ts`；变异（回到旧判断）必红。回滚：revert 本分支提交，无落盘数据变化。 | 测试命令见 PR 正文 |

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [ ] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
