# MO-motion Slice 1 验收收据

最终实现提交 `1dcfe089b35daf7846fb3d92e134477c4b1f4d4a`，对照提交 `1730b7ea3db4adb513e0166c0376cce113f3f018`。独立验收线在真实 macOS Electron 窗口里完成 6/6 组前后对照，每组都操作顶栏三阶段、画布节点工具栏和生成框、Agent 面板。[12 条录像及逐组测量](window-acceptance.md) · [对照帧](window-frames.png)

## 创作操作成绩单

| 场景 | 设备和样本 | 修改前 → 修改后 |
|---|---|---|
| 按住文字钮、发送钮 | 中英亮暗各一组，加 1100×690 窄窗，共 5 组 | 宽度比 1.00 → 0.97。节点工具图标两版均为 1.00 |
| 减弱动态时适应视图 | zh-CN 亮色，系统偏好 reduce，1 组 | 视口写入的新姿态 11 → 1，正常到达新位置。按钮过渡 150 → 0 ms |
| 加载时保持标签宽度 | 同版真实生产组件，另用隔离 Chromium 测量 2 种文字钮 | WorkbenchButton 宽度变化 +20 → 0 px，DesignButton +22 → 0 px。减弱动态下保留 busy 语义且加载标透明度 0.65 |

窗口读数来自实际渲染。五个普通模式窗口均可看到明显的按钮反馈，密集工具图标位置稳定。减弱动态另计，已检查忙态、禁用和最终位置。全部媒体请求数为零。真人样本 0，SEQ、误点、回退、求助均为 null。Windows 未实测。[窗口探针](window-probes.json) · [按钮探针](button-probes.json)

## 性能

四场均完成同机修改前和最终构建各五轮采样。最终聊天滚动 17.3 / 17.5 ms（中位数 / p95），预算 16.7 ms；同机修改前为 17.6 / 17.7 ms，静止不滚动对照为 17.5 / 17.6 ms。正式聊天场景五轮均无长任务。[完整对照与逐轮原始数据](performance.md)

## 结构与交付验证

- `pnpm build` 成功，生产构建的源码树指纹为 `161d017154df16a917e8f52b1041abb1b2c8f496`。
- `check:tokens`、`check:board-parity`、`check:boundary-owners`、`check:self-written` 及 `check:concept-owners` 通过。ESLint 拒绝普通文件和已有例外文件内新增的 `duration-200`，接受 `duration-nomi-fast-exit ease-nomi-in`。棘轮冻结八个禁改文件已有的九项命中。
- 此版本未注册 `pnpm run lint:changed` 别名。运行仓库推送门岗使用的 `node scripts/lint-changed.mjs`，44 个改动文件，错误 0，警告数未增加。
- `node scripts/verify-line-meter.mjs /tmp/mo1-window-evidence --json` 读到 2 个驱动脚本、194 行、6 次常驻驱动命令。
- 应用、Electron、electron-pi、浏览器夹具及测试类型五项均通过。夹具与测试类型在单独运行时完成。
- 全量单测在 `src/design/iconTiers.test.ts` 捕获 5 个失败。图标测试原先将整个 safelist 带进单元素的 Tailwind 编译夹具，并把生成的每个 CSS 规则都解释为图标尺寸。仓内只有这一处用 raw content 编译图标测试。夹具现使用 Tailwind 的空 safelist，继续沿用生产主题、插件和全部 6 个原断言；单独复现 5 红，修后 6 绿。
- 先前的 GPU 探针直接捕获模块依赖，序列化后会引用不存在的函数。最终实现通过独立 Chromium 页面逐一验证两种系统偏好，同时保留 WebGL 释放与监听器回收。根因合同和概念登记通过。
- Vitest 全部 8 个分片，以 VITEST_MAX_WORKERS=2 运行。2464 个测试文件通过，2 个文件按配置跳过。36234 个用例通过，39 个预期失败，23 个跳过。修复后复跑了第 5、6 分片。Node 单测另有 747 个通过。[分片收据](unit-tests.json)
- 正文合并档使用 `NOMI_PR_BODY_FILE=/tmp/mo1-pr-body.md node scripts/check-pr-judgement.mjs --stage=merge`。同类证据有任一条符合即可满足正文格式；对四场分别执行性能判据时，聊天滚动仍为超预算。
