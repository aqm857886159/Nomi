# 走查凭据来源方向检查

Direction-Check: 独立复盘来自 R-walk-rot-direction 实现外调查线，用户已按任务书批准换做法。以下整理 C 节；原证据保留在私有协调报告，不在公开仓嵌入本机绝对路径。


本节按`docs/engineering/direction-check-template.md`的0–7节组织。先独立写初稿（独立线证据）及时间戳（独立线证据），再读现有启动屏障报告对照。任务书禁止写代码/跑测试，因此模板的“先写特征测试”本次仅列清单，**未写也未跑，不能作为修复已获准的收据**。

### 0 一句话根因

**平台开关已经集中，但“这个隔离profile使用哪种凭据来源”的事实没有统一拥有后端选择权；用启动前是否已有密文猜未来会不会保存密钥，漏掉合法的首次接入路径。** 此类是测试运行环境不变量缺失，不是证实产品应当绕开安全存储。

要保住的创作者结果：第一次通过可见接入页保存后确实能使用模型；假凭据演练不碰真钥匙串、真凭据副本不被换后端、任何失败都有原始原因而非超时假象。

### 1 bug → 直接原因 → 类

| 提交 / 所属PR | 实际改的入口 | 直接原因 / 范围 | 为何没覆盖13条 |
|---|---|---|---|
| db1bc23f6（独立线证据） / #1343（10-27） | foreground guard、buildNomiLaunchEnv、isolate:false启动与退出 | 走查抢前台、环境继承把安静模式打开、退出0/125掩盖失败。 | **不是凭据修复**；它没声称统一凭据策略。不能写成三次相同key bug连续修漏。 |
| e0d6f23c6（独立线证据） / #1425（11-06） | 开发electron.launch选项、_playwrightReady.cjs | 显式executablePath跳过官方ready屏障；采用loader后要还原调用方原来后端。 | 修就绪与不改变已有后端，保留“根据已有catalog猜启用”的原决定。 |
| 8330fc8be（独立线证据） / #1446（11-08） | syntheticCredentialBackendArgs、encryptFixtureKey、decideSyntheticCredentialStorage、真实资料标记 | Mac隔离测试可能触发真钥匙串；收敛三份加密spawn，平台表集中。 | Mac隔离默认true，但Linux仍只有既存safeStorage密文才true；_launchApp.test.mjs:691–693还明确把空Linux目录false写成期望。 |
| 12条seedApimartKey:false演练 + 1条recorded包装 | createRuntimeWalk→launchNomiApp→decideSyntheticCredentialStorage；UI再保存 | 故意不预种密文，或默认loopback只种plain；启动时无法由磁盘推断后续UI写入，合成后端未启用。 | 错在“是否启用”的判据；给12条各补true仍会漏recorded、其它供应商和未来同类调用。 |

以上三个提交都在14天内触碰同文件，足以按P1触发复盘；**但只第三个在改变凭据策略**。修改热点与同一类缺陷三次复发是两个不同事实。

13条逐条核对（原始日志独立保存在本次raw目录，不只转述上一份结论）：

| 编号 / 走查 | 凭据前置 | 首错及位置 | 原始日志 |
|---|---|---|---|
| #014 `agent-shot-scope-real.rehearsal.walk.mjs` | seedApimartKey:false，后续走可见保存 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |
| #024 `agent-video-landing-paid.rehearsal.walk.mjs` | seedApimartKey:false，后续走可见保存 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |
| #025 `anchor-outbound-real.rehearsal.walk.mjs` | seedApimartKey:false，后续走可见保存 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |
| #044 `composer-b3-reference-paid.rehearsal.walk.mjs` | seedApimartKey:false，后续走可见保存 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |
| #047 `creation-ai-rewrite-real.rehearsal.walk.mjs` | seedApimartKey:false，后续走可见保存 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |
| #052 `deconstruct-real.rehearsal.walk.mjs` | seedApimartKey:false，后续走可见保存 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |
| #088 `look-at-canvas-selection-real.rehearsal.walk.mjs` | seedApimartKey:false，后续走可见保存 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |
| #104 `paid-env-key-connect.rehearsal.walk.mjs` | seedApimartKey:false，后续走可见保存 | lockRefusalFull先记录_paidEnvKey:154的success超时；随后二次调用又在:143等home失败 | raw（独立线证据） |
| #115 `reference-dead-link-real.rehearsal.walk.mjs` | seedApimartKey:false，后续走可见保存 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |
| #116 `reference-dead-link.walk.mjs` | seedApimartKey:false，后续走可见保存 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |
| #118 `relay-video-onboarding-real.rehearsal.walk.mjs` | recorded→createRuntimeWalk默认loopback，plain种子 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |
| #139 `tool-schema-real.rehearsal.walk.mjs` | seedApimartKey:false，后续走可见保存 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |
| #141 `try-model-intent-lock-real.rehearsal.walk.mjs` | seedApimartKey:false，后续走可见保存 | _paidEnvKey.mjs:154，等data-key-only-success 15000ms超时 | raw（独立线证据） |

**因果强度**：13条都证明同一“接入成功屏障没到”；12条false与#118默认loopback的代码链核对成立，逐条配置证据在credential-13-source-config.json。但raw中没有安全存储保存失败原文，也没有选中后端的运行收据，所以“Linux safeStorage未启用造成保存失败”仍是中置信代码推断。不能把13条都报成已复现后端错误，更不能报修好。#1446合入在11-08这次夜跑SHA745b3c5之后；当前Linux分支仍保留旧判据，但本次没有修后夜跑。

### 2 为什么这类会持续出现；门在哪里

**入口数必须分口径**：本仓真正设置/重放凭据后端有**4处生效点**：GUI配置、预加密子进程、MCP stdio、Playwright入口适配器。平台开关字面量只有1张表，不等于策略只有1扇门。

第一次数门实际运行：

```text
node scripts/door-map.mjs decideSyntheticCredentialStorage withSyntheticCredentialStorage configureSyntheticCredentialStorage syntheticCredentialBackendArgs encryptFixtureKey isolatedCatalogHasSafeStorageCredentials --roots=src,electron,tests,scripts,evals --include-tests
```

输出15个file+symbol门/38处出现；6个是_launchApp.test里的断言门，**9个是非断言调用门**。同文件同符号调两次只算一门，不拿调用次数混充入口数。JSON（独立线证据） / 原始摘要（独立线证据）。

| 非断言入口文件 | 符号 | 对决定的影响 |
|---|---|---|
| tests/ux/_launchApp.mjs | syntheticCredentialBackendArgs / withSyntheticCredentialStorage / decideSyntheticCredentialStorage / isolatedCatalogHasSafeStorageCredentials / configureSyntheticCredentialStorage（5门） | 将显式布尔、isolate、标记、现有catalog推成启用，再拼参数并在窗口之后配置Linux。 |
| tests/ux/agent-runtime-fixture.mjs | encryptFixtureKey | 预加密是强制synthetic=true；省略预种子时不会执行到它。 |
| tests/ux/_mcpL2Fixture.mjs | encryptFixtureKey | MCP夹具的预加密。 |
| scripts/model-identity-walkthrough.mjs | encryptFixtureKey | 另一组预加密调用。 |
| tests/ux/_mcpJourney.mjs | withSyntheticCredentialStorage | startStdioClient默认false，独立显式布尔；不能从GUI那个决定自动获得事实。 |

第二次跟进实际生效调用：

```text
node scripts/door-map.mjs --write=appendSwitch,removeSwitch,setUsePlainTextEncryption --roots=electron,tests/ux --include-tests
```

输出6个门/10处出现。electron/main.ts的appendSwitch只设其它Chromium参数，排除为凭据误报；剩下5个符号门分布在下表4处。原始输出仍全部保留，不手工伪装成机器只报了4。JSON（独立线证据） / 原始摘要（独立线证据）。第二次扫描时HEAD为707ed7a；与S的这些文件diff为空。

| 实际生效点 | 固定S源码证据 | 对启用/时序的意义 |
|---|---|---|
| GUI | `_launchApp.mjs:733–767,879` | 先决定及传开关，窗口/renderer阶段之后才configureSyntheticCredentialStorage。 |
| 预加密进程 | `_encryptFixtureKey.cjs:5–10` | ready后从NOMI_E2E_SYNTHETIC_CREDENTIAL_STORAGE决定Linux内存口令，再加密。 |
| MCP无窗进程 | `electron/capabilityCore/mcpStdioServer.ts:225–228` | startMcpStdioServer自己看同一env，但上游启用仍来自startStdioClient布尔值。 |
| Playwright入口适配器 | `_playwrightReady.cjs:7–11` | 移除官方loader隐式basic/mock开关，只按argv重放调用方显式开关。它是下一跳，第一次只数导出函数会漏。 |

另外运行`door-map launchNomiApp --roots=src,electron,tests,scripts,evals --include-tests`得到422个file+symbol调用门，其中417个不在*.test/.node-test文件；包括helpers/scripts/evals，**不是422条走查**。原始结果（独立线证据）。这也说明逐调用者补参数的范围过大。

表示层问题：`enc`描述的是已落盘数据的加密形状，不能描述未来这个profile是否会创建凭据。`seedApimartKey:false`的意义正是“要通过UI完成首次保存”，与“不要合成安全存储”无关。Mac默认合成、Linux看磁盘，进一步制造跨平台假绿。

测试为何没拦：_launchApp.test:685–698核的空Linux目录期望本来就是false；同后端组装测试:703–729使用explicit:true，避开了该分支；literal扫描:803–816只认同文件upsertVendorApiKey+apiKey字面量+显式true，UI的fill(apiKey)和包装器在它视野外；后端单出口扫描:760–769只管字面量和_encryptFixtureKey，不管是否启用、什么时候初始化。

体验铁律：⑩说的=摆的、⑪能选到对本次测试环境不变量不直接适用；⑫点了=以为的对应“保存后真正可用”，13条屏障仍有价值。这里要补的是前置环境和可诊断性，不能删成功屏障或让产品无条件保存明文来消红。没有检查逃逸账本、没有新建账本项；本次只读报告不结账。

### 3 不改结构，接下来会冒什么

| 可证伪预测 | 下一条实现/验收线怎样验证（本次未执行） |
|---|---|
| 同一合成流程只因目录是空/plain/safeStorage而得到不同Linux后端；首次UI保存会暴露这一区别。 | 同平台同fixture三份目录，输出不含密文/Key的来源、后端、isEncryptionAvailable与保存错误包络；分别走UI保存并读可用性。 |
| 同一rehearsal在Mac看似通过，Linux仍在保存前置失败。 | 两平台、同commit/fixture/语言各跑一遍；不得用Mac绿替代Linux收据。 |
| 只补12个false调用者，recorded/loopback、另一个vendor或重启后补key仍会再漏。 | 同一共享环境合同至少覆盖seeded、empty→save、recorded wrapper、MCP子进程；GUI加密→MCP解密以及反向各做一次。 |

附加时序风险（待验证）：GUI在窗口阶段后才setUsePlainTextEncryption，首轮catalog读取可能早于它；当前材料不足以证明这导致了哪一条红。新边界应在首次catalog读/写之前完成后端初始化，不把它留作另一个补丁。

### 4 靶子独立性检查

本次是独立调查，未参与列出的三次修；先锁独立初稿再对照旧报告。源码/测试由原实现线一同修改，量具锁住了旧判据，因而单测通过不反证首次保存可用。本次没有找到“因评测掉分而回滚”的原始证据，不虚构先例。先改尺子的不变量，再修共享边界；保留失败红样本。

### 5 P0：是否我们独有；依赖生命周期

凭据加解密、Linux后端、macOS钥匙串均是通用能力：复用现有Electron43.4.1 safeStorage、Chromium测试后端和Playwright1.60.0 ready loader，不造加密封装或另一套key持久化。Nomi独有的是“隔离profile与付费/非付费测试如何证明不触碰真实资料”的来源合同。

生命周期建议 `retain-with-exit`：本轮保留所装版本与ready适配器；上游loader不再隐式追加后端且跨平台初始化/真副本保护矩阵通过后，才删适配器。Electron同步API迁移按支持目标版本另立范围，最新文档对45/46的描述不是43.4.1当场升级理由。本次未验证最新版本兼容，不推荐借这轮修复顺手升级。

### 6 三条路对比 + 推荐

| 路 | 最小完整做法 | 证据与代价 | 风险/取舍 |
|---|---|---|---|
| 沿原方向修 | 对每条演练补true，或按seedApimartKey/provider在wrapper补if。 | 能碰到12条false，但#118没有false；launchNomiApp已有417个非断言调用门。小diff但持续依赖作者记忆。 | 不推荐继续扩特例；共享平台表保留，启用猜测不保留。 |
| **换做法（推荐）** | **在隔离profile创建/认领边界按来源统一定后端**：自建无真副本标记的隔离资料就是synthetic；真凭据副本用已有REAL_CREDENTIAL_MARKER明确辨认；非隔离就是real。GUI/预加密/MCP使用同一决定，在首次凭据读写前初始化；显式冲突fail closed。 | 复用原生safeStorage、已有平台表和标记。删除Linux“已有密文才开”及绕过来源的独立opt-in；迁移旧profile-copy调用者/未标真实副本时先拒绝，不能重加密或覆盖原数据。由走查基础设施线在获批任务分支按共享边界一刀实施，先矩阵后13条Linux演练。后端来源不授予出网或花钱许可；现有网络闸、付费拒跑仍独立校验。 | 比加一个if多迁移成本，但覆盖空/后种/不同供应商与无窗路径。无需为来源再造平台库、通用加密层或per-walk配置。 |
| 删掉 | 最小删除单位是**由catalog密文形状猜后端的机制**，再删重复opt-in；保留13条UI首次保存覆盖、真副本标记、ready保护。 | #028/#030等说明删除过时机制可减少维护，但这里13条仍守实际接入价值，不能整批删。真实用户profile格式/凭据不迁移；仅自建测试资料重新建立。 | 不能把visible-save改成直接种密文，也不能自动抹掉真实副本；只删启发式本身若不统一其它门，仍不完整。 |

**最早共享边界**不是catalog解密失败分支，也不是_paidEnvKey的15秒等待；是任何测试进程读取/创建凭据之前，profile来源被建立并交给启动器的那一刻。来源决定一次，开关装配、ready后初始化、MCP继承都只消费它；真资料标记检查仍在共同边界做强制校验。

### 7 用户要权衡的核心

愿不愿意一次迁移测试资料来源合同，换掉“每个演练作者自己记得启用后端”的长期维护负担；这轮不改变真实用户的加密安全策略。

特征测试清单（**全部未在本轮新增/执行**）：现有_launchApp.test和_launchAppReady.test仅作现状参考；新不变量必须补空/plain/safeStorage三种合成资料、real-marker、冲突值、非隔离、GUI/MCP/预加密、开发/打包、Linux/Mac/Windows、跨进程同身份解密及首次UI保存；反例是去掉synthetic初始化/后端参数后，同一类测试必红。真实资料用授权的专用副本验证，不能用一把真实Key来绕过夹具问题。

**独立初稿之后的对照**：I-walk-launcher-ready-barrier.md（独立线证据）说明初版换官方loader后曾改变凭据后端、后来用12行适配器恢复；与e0d6f23的diff一致。它约束“采用屏障不改变后端”，没有承诺解决无密文的首次保存。8330fc8说明称平台后端一处定，这对开关表成立，对启用和4处实际生效时序不成立。独立结论保留；追加发现适配器也在重放开关，因此不能只统计exported函数或贸然删它。
