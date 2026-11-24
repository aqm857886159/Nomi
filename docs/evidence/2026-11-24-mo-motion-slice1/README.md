# MO-motion Slice 1 验收收据

实现提交 `72b04f98b8ddc0b7f5c985175c2b27677c8bdf63`，对照提交 `1730b7ea3db4adb513e0166c0376cce113f3f018`。独立验收线在真实 macOS Electron 窗口里完成 6/6 组前后对照，每组都操作顶栏三阶段、画布节点工具栏和生成框、Agent 面板。[12 条录像及逐组测量](window-acceptance.md) · [对照帧](window-frames.png)

## 创作操作成绩单

| 场景 | 设备和样本 | 修改前 → 修改后 |
|---|---|---|
| 按住文字钮、发送钮 | 中英亮暗各一组，加 1100×690 窄窗，共 5 组 | 宽度比 1.00 → 0.97。节点工具图标两版均为 1.00 |
| 减弱动态时适应视图 | zh-CN 亮色，系统偏好 reduce，1 组 | 视口写入的新姿态 11 → 1，正常到达新位置。按钮过渡 150 → 0 ms |
| 加载时保持标签宽度 | 同版真实生产组件，另用隔离 Chromium 测量 2 种文字钮 | WorkbenchButton 宽度变化 +20 → 0 px，DesignButton +22 → 0 px。减弱动态下保留 busy 语义且加载标透明度 0.65 |

窗口读数来自实际渲染。五个普通模式窗口均可看到明显的按钮反馈，密集工具图标位置稳定。减弱动态另计，已检查忙态、禁用和最终位置。全部媒体请求数为零。真人样本 0，SEQ、误点、回退、求助均为 null。Windows 未实测。[窗口探针](window-probes.json) · [按钮探针](button-probes.json)

## 性能

四场均完成修改前、修改后和修改后复测，每批各五轮。聊天滚动在同机基点和两批实现版均超过 16.7 ms 预算，三批的聊天长任务计数均为零。[完整对照与逐轮原始数据](performance.md)

## 结构与交付验证

- `pnpm build` 成功，生产构建的源码树指纹为 `707fb9dfed808060f8220643f4dbddcea8cf9bb0`。
- `check:tokens`、`check:board-parity`、`check:boundary-owners`、`check:self-written` 及 `check:concept-owners` 通过。ESLint 拒绝普通文件和已有例外文件内新增的 `duration-200`，接受 `duration-nomi-fast-exit ease-nomi-in`。棘轮冻结八个禁改文件已有的九项命中。
- 此版本未注册 `pnpm run lint:changed` 别名。运行仓库推送门岗使用的 `node scripts/lint-changed.mjs`，41 个改动文件，错误 0，警告数未增加。
- `node scripts/verify-line-meter.mjs /tmp/mo1-window-evidence --json` 读到 2 个驱动脚本、194 行、6 次常驻驱动命令。
- 应用、Electron、electron-pi、浏览器夹具及测试类型五项均通过。夹具与测试类型在单独运行时完成。
