# 方向检查：文件身份比较（lane-legacy-migration 登记，30 天第 4 个 fix）

### 0. 一句话根因
「是不是同一个文件」没有共享实现：三个模块各写各的，Windows 上 Node 的 stat 在不同 libuv 版本下 dev 不一致、ino 还丢精度，每个新写这种检查的模块都会再踩。

### 1. 归类表

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| antigravityArtifacts 的 win32 特例分支（已合） | lstat dev=0 / fstat dev 真值 | 文件身份比较没有共享实现 |
| laneLegacyFiles sameIdentity 在 Windows + Node 22.15 全红（V-1041 发现） | 同上，另加 Number ino 丢精度 | 同上 |
| lane-legacy-migration 登记的其余 3 个 fix | 迁移协议本身（锁、归档、顺序） | 不同类，这次不碰 |

### 2. 为什么这一类会一直出现
Node 的 `fs.Stats` 在 Windows 上的 dev/ino 语义随 libuv 版本变（路径 stat 与句柄 fstat 不对称，libuv/libuv#4698 一类修复在 1.51+），ino 超 2^53。没有共享边界，每个模块只能凭当时遇到的现象补。类根因落在「没有唯一的文件身份判断」，不是迁移逻辑错。体验铁律 ⑩⑪⑫ 不适用（无意图、无模型选项、无可点目标）。

### 3. 不改结构会冒出什么
| 预测 | 怎么验证 |
|---|---|
| 下一个手写 dev/ino 比较的模块在旧 Node 的 Windows 上同样全红 | `git grep -nE "\.ino\s*[!=]==?" electron` 只应剩 fileIdentity.ts（类级测试 electron/fileIdentity.test.ts 守） |
| 相邻 NTFS 文件 ID 被 Number 折叠为同一个 | 表驱动用例「NTFS ids adjacent above 2^53」 |

### 4. 靶子独立性
测试用真实文件的 lstat / fstat / rename 换文件，不是 mock；验收线（V-1041）独立发现，不是实现线自己的尺子。变异（改回旧判断）实测变红。

### 5. P0：这是我们独有的吗
不是通用库能解的：Node 自带 stat 本身有差异，没有现成包能「按句柄 + 路径比身份」且符合我们的防换文件语义；自写只有 12 行的 `electron/fileIdentity.ts`，登记归在文件身份防线（防「读的过程中被换成另一个文件 / 符号链接」，属领域安全约束）。lane-legacy-migration 登记 to-replace 的迁移本体这次不动，替换时间仍按 docs/plan/2026-09-07-agent-runtime-rebuild.md。

### 6. 对比表
| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 无成熟包覆盖该语义 | — | — | 不适用 |
| 补（每处各补一刀） | 复制 antigravity 的 win32 分支 | 小 | 第 4、5 处还会踩，且丢精度没修 | 否 |
| 重写（限一个模块） | 收成共享的 bigint 判断，同提交删三处手写 | 约 12 行 + 三处调用 | 低，测试覆盖 | 是 |
| 删 | 去掉身份校验 | — | 丢掉防换文件 / 符号链接防线 | 否 |

### 7. 用户要权衡的核心
把三处手写比较收成一个共享判断（已选），代价只是 dev 为 0 时不再比卷号。

## 特征测试清单
- tests/agent-runtime/lane-legacy-migration.test.mts（34 条，改前 Node 22.15 全红，改后 33 过 1 跳过）
- electron/fileIdentity.test.ts（13 条：真实文件、换文件、换目录、符号链接、表驱动、类级扫描）
