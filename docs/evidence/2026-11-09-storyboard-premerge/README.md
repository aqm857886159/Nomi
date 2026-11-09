# 分镜合并前完整 App 证据

## 短版设计卡

- ★1：补齐真实 App 最小窗四档证据；量具为既有 createRuntimeWalk、resizeWindow、screenshotSettled 及末镜/浮条矩形比较。
- ★2：产品与拍板图仍为唯一真源；本轮只存截图和原始收据。
- ★3：复用上一轮隔离探针，只换证据落点、记录构建指纹；不改产品、断言或门岗。
- ★4：不发送 Agent 改镜或媒体请求；主线已知悬浮球遮页脚单列。
- ★9：1100×720，中英×亮暗，末镜参数底部382px、浮条顶部505px，余量123px；四档 paddingBottom=80px，浮条高42px；逐张亲眼查看。

执行 HEAD：716f437455db8d2ad77841aae7500a9ba7dd811f；完整构建源码树 fd6aeb3f3c3df5f304696e4b968db8ea59530c6f。renderer/electron 戳相同，见 app-receipt.json。后续证据/夹具提交不进入构建指纹。

| 截图 | 亲眼观察 |
| --- | --- |
| after-zh-CN-light-tail.png | 中文亮色，末镜提示词与参数完整，浮条在末镜下方，无重叠。 |
| after-zh-CN-dark-tail.png | 中文暗色，末镜参数可读，浮条未覆盖末镜内容。 |
| after-en-light-tail.png | 英文亮色，Ask Agent/Delete selected 完整，末镜与浮条无重叠。 |
| after-en-dark-tail.png | 英文暗色，末镜内容完整，浮条保持下方，不挤截标题。 |

## 主线已有：悬浮球覆盖页脚

四档均有：球 x1032 y652 44×44，与 Generate Remaining / 生成剩余 相交；与上一轮 main 收据一致。本 PR 不修。完整 App 的视觉通过仅指本轮的末镜滚达/浮条留白，不代表页脚遮挡消失。
