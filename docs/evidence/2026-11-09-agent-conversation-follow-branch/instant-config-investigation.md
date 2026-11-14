# 1.1.6 即时跟随配置查证

本次协调决定要求解决原70px两红，撤销此前“已知限制可交”的决定。尚未通过，不能据旧决定结账。

## 官方包与本分支现状

lockfile importer与snapshot均锁定use-stick-to-bottom 1.1.6；安装包package.json同为1.1.6。逐字读了随包README、dist/useStickToBottom.d.ts、dist/StickToBottom.d.ts和dist/useStickToBottom.js。文档与实现哈希见[配置核对](instant-config-semantics.json)。没有改node_modules或依赖版本。

| 项 | 类型及官方实现语义 | 当前接法 |
| --- | --- | --- |
| resize | Animation；内容ResizeObserver在首个高度之后，非负高度差时选它。仅在跟随意图仍成立时恢复位置；不负责强拽上翻读者 | instant |
| initial | Animation或boolean；首个ResizeObserver高度用它；false使初始跟随意图为false | instant |
| instant | 跳过速度/弹簧插值，在scrollToBottom的下一次rAF直接写calculatedTargetScrollTop；不是同步DOM写入 | 已显式配置 |
| smooth/弹簧对象 | 走速度积分；默认damping0.7、stiffness0.05、mass1.25。damping为阻尼系数，stiffness为加速刚度，mass越大越慢；均不能绕过共同rAF入口 | 未使用 |
| wait/duration | 程序调用的排队/保持选项，不是动画耗时；ResizeObserver内部wait:true，非instant另保留350ms | 没有自定义 |

README展示smooth示例，不代表项目已用smooth。实际唯一生产hook在AgentPanelV4Panel.tsx:274，已是`useStickToBottom({ initial: 'instant', resize: 'instant' })`。四个显式scrollToBottom调用（线程变化、面板尺寸恢复、发送、回底按钮）均传instant。以安装包原mergeAnimations函数做5项断言，确认resize/initial/显式调用均解析为instant，smooth解析为默认弹簧，instant优先于全局弹簧参数。

安装包源码路径/行：dist/useStickToBottom.js:151–174，先new Promise(requestAnimationFrame)，然后instant分支写入位置；:334–342，首个高度选择initial，之后选择resize。类型SpringAnimation注释和ScrollToBottomOptions注释定义参数含义。instant仍保留库的观察与帧调度，不可把它解释为同一布局阶段同步贴底。

设计卡原文§5表格及§6已明确initial/resize都instant、主动回底也instant，理由是不用弹簧与流式吐字争帧；切线程与发送要求及时看到最新。继续保持这些选择。改为smooth或弹簧不会比已有instant更早越过rAF；没有官方“同步ResizeObserver跟随”配置。重复写相同配置、改成等价写法不构成修复，因此没有制造配置提交，也没有补自写滚动。

## 作用范围与判断边界

全仓useStickToBottom仅此一个生产调用，三个面通过共享AgentPanelV4Panel接入；scrollToBottom四处全部核实。door-map扫描3127个源文件，面板导出有26个读门；本次没有改共享读面或产品代码。原生走查、70px阈值、采样窗口、夹具及thinking-overlap均保持原样。

历史[逐帧定位](follow-diagnostic-summary.json)证明旧两次超限发生于用户气泡首挂、新回答出现之前，随后回1px；输出中最大49px。结合当前安装库源码，最强证据指向ResizeObserver到下一次rAF之间的几何落差；并非尚未配置instant。逐帧几何采样不是实际paint证据，不能据此断言肉眼闪动或测量误报。本次重跑若红，原判据仍失败，不能以新回答出现后的49px替换全窗口峰值。

## 本次完整重跑：仍失败，停止

在源码HEAD 1a6957d41、原有instant配置上，槽A锁内先pnpm build通过（Vite8.48s），再完整走查一次：29项27绿2红。中文259帧、maxGap104px；英文274帧、maxGap83px。原始70px阈值与全采样窗口不变。14次免费文本、0图片、0付费、unexpected为空。详见[逐格原始值](instant-config-follow-checks.json)、[摘要](instant-config-follow-summary.json)、[脱敏完整日志](instant-config-follow.txt)。

本次没有新增逐帧诊断，不能把旧诊断的帧号说成本次帧号；现读源码和旧几何凭据支持调度间隙判断，新整体结果证实已有instant仍不满足原判据。尚无证据证明是弹簧或其它产品逻辑，也未采样paint来证明误报。纯配置范围内没有已查到的更快选项；不升级/修改库、不补通用同步逻辑、不改测量。

按“还红就停”，账本不改reviewed，未跑后续typecheck、完整快检、正文六项预检，未跑thinking-overlap。已亲眼Read[中文回底图](instant-config-zh-after-jump.png)与[英文回底图](instant-config-en-after-jump.png)，两张都在流式输出中显示底部内容、回底按钮已隐藏；图能证明按钮结果，不能证明每帧70px通过。其它10张新图不计本轮已阅。
