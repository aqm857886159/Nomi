# 分镜合并前完整 App 证据

## 短版设计卡

- ★1：补齐真实 App 最小窗四档证据；量具为既有 createRuntimeWalk、resizeWindow、screenshotSettled 及末镜/浮条矩形比较。
- ★2：产品与拍板图仍为唯一真源；本轮只存截图和原始收据。
- ★3：复用上一轮隔离探针，只换证据落点、记录构建指纹；不改产品、断言或门岗。
- ★4：截图探针不发送 Agent 改镜或媒体请求；主线已知悬浮球遮页脚单列。
- ★9：1100×720，中英×亮暗，末镜参数底部382px、浮条顶部505px，余量123px；四档 paddingBottom=80px，浮条高42px；逐张亲眼查看。

续拍执行 HEAD：32129be7e396a3a05461c91112cc1ce3b138a3f7；完整构建源码树 774debc5a56bfdc4d0fe0babf83e107074133efa。旧截图的 fd6aeb3f… 与当前树不同，唯一差异为新增 electron/projects/storyboard.oldUser.test.ts，因此已重新构建并重拍四档，未沿用旧图。renderer/electron 戳相同，见 app-receipt.json。本次截图和收据的提交仅改 docs/evidence，属于 package-build-stamp.mjs 的 NON_INPUTS，构建身份不变。四张续拍图已再次逐张亲眼查看，观察结论与表中一致。

| 截图 | 亲眼观察 |
| --- | --- |
| after-zh-CN-light-tail.png | 中文亮色，末镜提示词与参数完整，浮条在末镜下方，无重叠。 |
| after-zh-CN-dark-tail.png | 中文暗色，末镜参数可读，浮条未覆盖末镜内容。 |
| after-en-light-tail.png | 英文亮色，Ask Agent/Delete selected 完整，末镜与浮条无重叠。 |
| after-en-dark-tail.png | 英文暗色，末镜内容完整，浮条保持下方，不挤截标题。 |

## 主线已有：悬浮球覆盖页脚

四档均有：球 x1032 y652 44×44，与 Generate Remaining / 生成剩余 相交；与上一轮 main 收据一致。本 PR 不修。完整 App 的视觉通过仅指本轮的末镜滚达/浮条留白，不代表页脚遮挡消失。

## 续验：文稿选择后的等待边界

core首跑在文稿树重开时失败，四份方案已真实建立，failure.png中抽屉关闭。ShellRail.tsx 的 selectionKey effect 在文稿/方案/模式变化后收抽屉；core在点文稿后立即重开，抢在该effect之前。沿既有流程等待抽屉真正关闭（选）；改共享打开helper会把不发生选择变化的入口也绑到关闭条件，删打开验证会丢原编辑器验收。只在三处确实发生selectionKey变化的文稿切换后，加现有共享预算的hidden等待，原断言不变，不改ShellRail或任何产品代码。依赖决策：not-applicable。症状日志、源码与截图在协调验收报告；这是获准的走查等待修正，不作为产品问题已解决的凭据。

同一条core走查原先在第10项后因重开抽屉失败，补等待后18项全部通过（含中文流程、英文冷启动恢复）。原断言逐字保留；见本线续验报告的core-creation与core-creation-after-wait原始日志。

## ★9 第6条：双语完整App与请求取证

在HEAD `64cefcdff1ef3c079212a152d7a9d927b7a47d13`、构建树 `774debc5a56bfdc4d0fe0babf83e107074133efa` 的完整隔离App里，真人下拉把整片从1:1切成9:16；保留一镜显式16:9覆盖，另放一镜使用不支持画幅的档案。仅远端为本机夹具，renderer、store、materialize、runner和请求映射均走生产路径；未使用真实模型/付费服务，夹具图片本身不用于证明真实成片像素比例。

| 语言 | 继承镜 / 覆盖镜的显示属性 | 实际POST的aspect_ratio | 两类提示 |
| --- | --- | --- | --- |
| zh-CN | 9:16 / 16:9 | 9:16 / 16:9，各一次 | 已覆盖画幅的 1 镜不跟着变；1 镜的模型不吃整片画幅，按它自己的尺寸或参考图走 |
| en | 9:16 / 16:9 | 9:16 / 16:9，各一次 | 1 shots with an overridden aspect stay as they are；1 shots run a model that does not take the film aspect; they follow its own size or reference image |

两张本轮额外截图已逐张亲眼查看，提示可见，行参数区分别为9:16/16:9；完整原始报告运行号 `storyboard-film-scope-proof-development-1794214729675`，SHA256 `0ec9b7f94027592058d2c0408ede520553d51a0745d9defed4bb001b16aec75a`。原始报告、临时探针、两张截图和命令路径在协调验收报告中。首跑在重载尚未完成时直接读取plan抛TypeError；补真实项目界面就绪和持久化等待后通过，未改业务断言或加retry。

### audit 选择器复核（验证脚本，不改产品）

保住的结果：P7 清掉选择后，P9 仍在原第4镜验证生成结果。原脚本把浮条最后一颗按钮当清除选择，实际为删除，导致4镜变3镜、P9找不到第4行；这是测试动作定位错，不是产品删除失效。只把这个定位器换成双语精确可访问名「取消选择 / Clear selection」，其余点击、等待、观察和断言不变。三种办法中选择精确名称定位；保留位置会继续误删，改产品排列或跳过P9都会改变验收对象，因此不选。调用面以 rg 核过，本行是 audit 唯一的浮条 last()；不扩改其它走查或共享组件。首跑日志与 observations 保留在本线临时证据目录，后续中英重跑结果按报告交付。

复验结果：中文206.4秒、英文134.0秒（均含排锁），exit0、11个phase均errors={}。两语各4次本地图片请求、0视频请求、真实供应商出网记录为空；取消批量前后节点0→0，引用chip双击预览/移除、锚结果回绑及4镜保留已观察。1100×690审计补图中浮条完整、无横向溢出，两语33-min-window-selected-row.png均亲眼查看。此审计补图不替代上方1100×720四档合同截图。边界：预设锚失败未发生，heroFailedBeforeRetry=false，因此不认失败重试验证；useAsMenu/rowMenuItems为空不算动作覆盖。日志/observations均在本线resume2证据，单文件ESLint通过。

### PB07 当前抽屉入口定位

保住的结果：从真实创作面打开同一份方案后，原六镜和提示词/请求断言照跑。首跑第2步找不到侧栏方案，失败图确认文稿抽屉关闭；不是方案数据丢失。只在原方案选择点复用 ensureCreationResourceTree / openStoryboardEditor 的真实UI入口，原可见性与六镜断言不变。三路选择：沿旧常驻侧栏定位会一直找不到；更改产品默认抽屉越界；复用既有抽屉入口最小且与仓库唯一入口合同一致，因此选后者。不改共享helper、模式、种子数据、断言或预算。调用面是PB07初始方案入口，后续原有helper继续使用。本验证线至此恰好15个交付文件，不再新增改动文件。

PB07中文入口适配后的实跑仍exit2：方案已打开、标题与页脚均6镜，但原toHaveCount(6)观察到5个完整DOM行；虚拟列表按视口挂载，完整行数不是总镜数。没有改断言、关闭虚拟化或通过扩大窗口造绿。E1–E4花钱提示词合同尚未执行，不能认PB07通过；需要对虚拟列表的总数/逐行reveal另行适配量具。单文件ESLint通过。
