# 方向检查：参数值的内部类型（时长等）

分镜行目录14天6个修复、1次回滚，画布控件目录10个修复；去重归类为收尾5、再修6、别处带坏2、回滚2；同形状确认1类（10处控件字符串声明、另2处操作默认）；推荐换做法：门口统一内部类型、出口按供应商编码；未跑测试、未实窗，行为结论为代码推断。
基线：`bd819e18c`；固定窗口为2026-11-03 11:00至2026-11-17 11:00（UTC+8），以下只读这一提交，不追随后续合并。复盘范围是参数数据形状，不裁决界面布局；本文是待拍板建议，未实施。
**这一处的全图在哪**：独立先画「目录/档案声明 → 控件字符串事件 → 参数解析 → 分镜字段或节点meta → 投影/请求 → 供应商编码」；最后查`docs/engineering/seams.json`归“档案→面板→请求体”，已有图`docs/plan/2026-11-15-archetype-single-entry.md`只收档案入口，未覆盖这条内部类型链；本次只读，不修改登记。
### 0. 一句话根因
控件长相、应用内部的语义值、供应商报文值共用一种宽泛的参数结构，字符串时长合法地进来，却被只认数字的业务读点当成另一种东西；缺的是一次明确的内部类型准入，而非某个控件少写Number。
直接原因（代码推断）：`electron/shared/videoCapabilities/runninghubSeedance.ts:11`声明字符串选项；`src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts:319`按选项原型返回，`:330`故得`"12"`；`src/workbench/creation/storyboard/shotRow/storyboardComposerModel.ts:89`只把number认作时长，落到`:90`普通参数；`shotRow/ShotComposerBar.tsx:91`只有duration分支写`durationSec`，`:92`实际写`params.duration="12"`。
旧`durationSec=5`因此保留：`ShotComposerBar.tsx:48`读它，`:59`覆盖面板meta；同目录`StoryboardComposerParams.tsx:95`合入覆盖。发送链的`src/workbench/generationCanvas/agent/storyboardPlan.ts:317`和`src/workbench/creation/storyboard/exec/storyboardProjection.ts:65`又以`durationSec`覆盖参数，因此新建、写回节点都仍取5；无画布覆盖、正常目录和有效提示词是本推断的条件。
画布直接操作没有这一处字段分流：`src/workbench/generationCanvas/nodes/NodeParameterControls.tsx:266`经`parameterControlChangePatch`把`"12"`写到`meta.duration`；`runner/catalogTaskActions.ts:341`复查时与字符串选项同型，可保留12。不能据此说画布整条链无问题：下表还有估时、准入与旧值类型分叉。
### 1. 归类表：提交 → 直接原因 → 类
| 日期 / 提交 | 目录（分=shotRow，画=controls）及修复内容/直接原因 | 类 |
|---|---|---|
| 11-03 `f9489e888` | 分：逐镜模型/片级画幅收口，保留关键帧草稿、移除重复入口；产品改造收尾 | 新功能收尾 |
| 11-07 `97bce1973` | 画：Run路与画布的角色词/并槽判据分散，改读共享角色表 | 同一个毛病再修 |
| 11-08 `94e59b73b` | 画：参考数组合并丢失已选槽语义，改走共享合并函数 | 同一个毛病再修 |
| 11-09 `1f8cb99a2` | 画：参考条目仍以url/slot私拼，改用binding/value及共同解析 | 同一个毛病再修 |
| 11-09 `e63324597` | 画：解析产物可被自由铺开，改为owner签发的冻结快照 | 同一个毛病再修 |
| 11-09 `f354f0b4b` | 分：换视频模型留下旧时长，局部按新模型默认重置，仍只认number | 同一个毛病再修 |
| 11-09 `0b35c89e9` | 分：撤销上一提交；提交正文明确要求跨入口先研究、整体替换 | 回滚 |
| 11-13 `312230c4f` | 画：方式参数owner把下拉修值也接走，改变既有边界；把修值退回渲染发送前 | 别处带坏 |
| 11-14 `735003d1b` | 分+画：新菜单缺素材名词、英文单复数和默认模型行呈现未做全 | 新功能收尾 |
| 11-14 `660b3efa2` | 画：新增说明Tooltip缺Provider，展开高级设置崩溃；原测试mock掉了真组件 | 新功能收尾 |
| 11-14 `725e198dc` | 画：高级设置行对齐、说明层级没有遵循设计系统 | 新功能收尾 |
| 11-14 `7a6e713cf` | 分+画：同类素材提示又漏“先放…”分支；未存方式露占位，未展示实际默认方式 | 同一个毛病再修 |
| 11-14 `c2c63dbfc` | 分：共享底栏窄宽/摘要/弹层/滚动收尾；同时删掉图片方式入口，后来需恢复 | 新功能收尾 |
| 11-15 `15454378d` | 画：目录声明错误波及控件契约；本目录只增Seedream旧值回归测试，不是控件生产实现再修 | 别处带坏 |
| 11-15 `42137b4d6` | 分：恢复被前次修补拿掉的图片方式入口，旧改图镜头可切回文生图（行为回滚） | 回滚 |
计数命令：`git log bd819e18c --no-merges --since='2026-11-03T11:00:00+08:00' --until='2026-11-17T11:00:00+08:00' --format='%h %cs %s' --grep='^fix\|^Revert.*fix' -- <目录>`；目录分别用`src/workbench/creation/storyboard/shotRow/`、`src/workbench/generationCanvas/nodes/controls/`。同提交触两目录各算一票，合计17票、去重15提交；14个fix标题+1个Revert，分类回滚2还包括`42137b4d6`，不是多出一次git revert。
复修簇：参考绑定/产物形状4次（`97bce1973`→`94e59b73b`→`1f8cb99a2`→`e63324597`）；素材菜单语义2次（`735003d1b`→`7a6e713cf`）；图片方式入口删后恢复（`c2c63dbfc`→`42137b4d6`）。时长局部重置被撤销，不等于字符串时长故障已修过两遍；不能把16个目录fix票都解释成参数类型故障。
### 2. 为什么这一类会一直出现
结构证据：`electron/shared/videoCapabilities/types.ts:9`的type是select/number等控件类别，不是独立的内部值类型；`:12`选项、`:32`默认值均为标量联合。`src/config/modelCatalogMeta.ts:187`只保留选项原型；`resolveModelParams.ts:29`明说保留既有政策差异，`:59`严格枚举、`paramConstraints.ts:68`字符串化比较又并存。共享函数增加了，但参数袋仍是`Record<string, unknown>`，未消除内部读者各猜类型的条件。
铁律落点是⑫“点了=以为的”：选12应改这一镜实际秒数；⑩只作跨入口一致性约束，不评价助手如何起草；⑪已有共用控件仍不能保证写回语义一致。目录修复成批还含界面收尾、引用形状、错误声明，是否存在统一的组织原因没有证据，不知道。
同形状普查：全仓搜索生产声明及下游，排除测试/生成物/文案/实验室后核对静态档案、目录和适配草稿；不读取用户自建目录。以下V=`electron/shared/videoCapabilities/`，M=`electron/shared/modelArchetypes/`，缩写文件均据此展开为仓库相对路径。
| 参数 | 字符串的家 | 数字的家 / 判断 |
|---|---|---|
| duration（同为秒，确认1类） | `V/runninghubSeedance.ts:11`；`V/runninghubVideoArchetypes.ts:24`、`:33`、`:34`、`:43`、`:44`、`:52`（Veo/Kling/Wan/海螺，文图模式分开声明）；`V/agnesVideo25.ts:5`（含Flash复用）；`V/kling.ts:14`（KIE等共享参数）；`electron/providerAdapter/builtinOpenAiCompatibleDraft.ts:199`；另有操作默认`electron/catalog/agnesVideos.ts:29`、`:47`（前者V2.0默认串与档案number并存） | 数字声明详列下一行；Kling在同文件`:23`为APIMart明确改成number，证明不能全局把供应商报文改成数字。 |
| duration数字声明 | 不适用 | `electron/catalog/newapiTransport.ts:324`；`M/minimaxMusic3.ts:6`；`M/sunoAudio.ts:47`；`V/agnesVideo.ts:10`；`V/dreaminaMultiframe.ts:18`；`V/dreaminaSeedance.ts:19`；`V/dreaminaSeedance.ts:68`；`V/geminiOmni11.ts:6`；`V/geminiOmni12.ts:19`；`V/grokImagine15Video.ts:12`；`V/grokImagineVideoOfficial.ts:13`；`V/hailuo23.ts:14`；`V/happyhorse.ts:24`；`V/happyhorse11.ts:15`；`V/kling.ts:23`；`V/kling30Turbo.ts:14`；`V/kling4.ts:14`；`V/kling4Flash.ts:14`；`V/minimaxH3.ts:40`；`V/minimaxH3Apimart.ts:9`；`V/minimaxH3Max.ts:5`；`V/museFluxVideo.ts:44`；`V/omniFlashExt.ts:23`；`V/pixverse6.ts:16`；`V/pixverse6.ts:52`；`V/runwayGen45.ts:7`；`V/runwayGen4Turbo.ts:6`；`V/runwayWireFacts.ts:147`；`V/seedance.ts:25`；`V/seedance.ts:37`；`V/seedance25.ts:54`；`V/seedance25Apimart.ts:15`；`V/seedanceApimart.ts:8`；`V/seedanceVolcengine.ts:9`；`V/seedanceVolcengine25.ts:51`；`V/veoOfficial.ts:17`；`V/viduNew.ts:15`；`V/viduNew.ts:56`；`V/viduQ3.ts:13`；`V/wan27.ts:19`；`V/wan30.ts:49`；`V/wan30Apimart.ts:48` |
| 张数、种子 | 未发现字符串静态声明 | `electron/catalog/newapiTransport.ts:320`的n、`M/higgsfieldSoul.ts:25`的batch_size均number；seed在`M/flux3.ts:27`、`V/agnesVideo25.ts:8`、`V/runwayGen45.ts:8`等均number。旧存值可能为字符串，是另一种输入边界问题，不能冒充目录异型。 |
| 比例、清晰度及其余参数 | aspect_ratio/aspectRatio/ratio/size的比例或像素选项、resolution均字符串；如`V/seedanceApimart.ts:6`、`:7`、`M/hitem3d.ts:13` | 未确认数字声明；`size`有时表示清晰度而非比例（`V/agnesVideo25.ts:6`），不能按键名猜语义。动态导入、未声明契约的值保持未知。 |
| style（异义同名，排除） | `M/sunoAudio.ts:45`、`:62`、`:77`是音乐风格文本 | `M/elevenAudio.ts:47`及`electron/shared/audioCapabilities/runwayAudioWireFacts.ts:154`是0–1风格强度；类型不同是正确契约，不合并。 |
控件10处/5文件的复算：`git grep -n -E 'key: "duration".*default(Value)?: "[0-9]+"|sel\("duration"' bd819e18c -- electron/providerAdapter electron/shared`；另2处默认值用`git grep -n 'defaultParams:.*duration: "' bd819e18c -- electron/catalog`复算；同语义1类是逐项阅读后的归类，不是正则能自动证明的结论。其它键普查用`git grep -n -E '(key|name):|sel\(' bd819e18c -- electron src`再按生产声明核对；未发现不等于用户自建模型不存在。
下游已核29个独立读写职责（按下表编号计，不按命中行数；媒体探测结果时长、展示用String不算输入解析）。结论都是静态判断，“不会”只指此表给定的合法标量输入，不代表整个功能已验证。
| 编号 / 文件:行 | 自判/转换及结论 |
|---|---|
| 1 `src/config/modelCatalogMeta.ts:187`；2 `src/workbench/generationCanvas/nodes/controls/parameterControlModel.ts:319` | 1保留目录标量；2按声明选项返回wire型；各自不会错，但都不产出统一内部秒数，组合后出错。 |
| 3 同上`parameterControlModel.ts:624`；4 同上`:725` | 3旧catalog时长默认Number化、4旧durs再Number化并取整：合法整数不会；第二套旧catalog路径仍在。 |
| 5 `src/workbench/creation/storyboard/shotRow/storyboardComposerModel.ts:89`；6 `src/workbench/creation/storyboard/ShotParamControls.tsx:35` | 5会：字符串时长走普通参数；6数值select未按option恢复类型，但全仓无生产调用者（只见实验室文案引用），当前用户影响不知道，最小可删除单位。 |
| 7 `electron/shared/videoCapabilities/paramConstraints.ts:24`；8 同上`:67`；9 `electron/shared/videoCapabilities/resolveModelParams.ts:59` | 7会：字符串数字档位全被滤掉，`modeDurationRange`变null；8会漏类型：字符串比较让12与“12”都合法；9会：又要求严格includes，把不同型的合法12重置成默认，而非规整为“12”。 |
| 10 `electron/capabilityCore/modelAdmissionSchema.ts:45`；11 `electron/capabilityCore/generationAuthoredDuration.ts:21` | 10按全部option推wire类型、11按秒比较再写回匹配option原型：本职责不会；但11的字符串输出会到下面只认number的读点，说明“已准入”仍不等于“内部类型可信”。 |
| 12 `electron/capabilityCore/mcpGenerationVideoResolve.ts:38`；13 同上`:79` | 会：合法字符串秒数分别不进推荐目标、估时返回undefined；这是代码可构造条件，未证明每一真实调用都达到该条件。 |
| 14 `electron/shared/storyboard/storyboardSubjectAdapter.ts:55`；15 同上`:70` | 会：没有显式authored.durationSec时，字符串候选在创建时变0、修改时保留旧秒数；有作者字段覆盖时该条件不成立。 |
| 16 `src/workbench/generationCanvas/nodes/director/model/directorPreviewState.ts:66`；17 `src/workbench/generationCanvas/runner/catalogTaskResolve.ts:83` | 16非空字符串转有限正数，不会；17为seed/steps等再转一遍，合法数值不会，但空白会Number成0，不能把它当安全准入。 |
| 18 `electron/catalog/taskParams.ts:295`；19 同上`:329`；20 同上`:385` | 18保留duration数/串，不会自行规整；19把n转数，合法张数不会，非法/0却静默回1；20为speed/seed/steps再转数，合法值不会，非数值保留给供应商，仍非内部保证。 |
| 21 `electron/catalog/runwayOfficial.ts:187`；22 `electron/catalog/dreaminaCodec.ts:318` | 21把duration转数后按本家档位选值，合法档位不会；22合法整数字符串不会，但parseInt会吞掉`5x`的尾巴，是需留在边界处理的风险，不可复制进门内。 |
| 23 `src/workbench/generationCanvas/nodes/controls/ParameterControlBody.tsx:354`；24 `src/workbench/creation/storyboard/shotRow/ShotComposerBar.tsx:94` | 23滑杆显示从字符串转数、24图片停留时长事件Number化，合法选项不会；它们是UI原始输入边界，不可与供应商编码一刀删光。 |
| 25 `src/ui/onboarding/comfyuiCanvasPreview.ts:124`；26 `electron/catalog/paramTranslate.ts:234`；27 同上`:169`；28 同上`:204`；29 同上`:189` | 25再解析number/boolean、select复用已声明选项；合法值不会，非法number却回默认/0；26将标量转字符串供transform，27秒×fps转帧、28秒转毫秒、29编码字符串，合法值不会。它们在导入边界/供应商出口，单位或报文转换必须保留，不能算作门内冗余一并删掉。 |
入口/连带面：声明读入（含自定义/ComfyUI）、分镜镜头/参考卡、画布面板/底栏、模型菜单换模型/档位默认值、Agent/MCP候选和修改、旧项目/节点恢复、建节点与写回、GUI发送与无界面发送、估时/预演/时间轴；用`git grep -n 'parseControlInput\|resolveModelParams\|parameters.duration\|meta.duration\|numericWireParam' bd819e18c -- electron src`复查调用者。三处界面继续同一套组件，不新增界面实现；未知档案不按同名键猜。
### 3. 不改结构的话，接下来会冒出什么
预测一：RunningHub Veo/Kling/Wan/海螺、Agnes 2.5的分镜改时长会遇到同样分流；以后按各目录合法档位逐项走“选择→持久镜头→新建/写回节点→请求”，不是都强行选12。
预测二：字符串枚举模式会被范围计算报成不支持时长，或推荐器写出该枚举没有的秒数；以后用`paramConstraints.ts`、`recommendation.ts`、`planResolver.ts`的真实档案对拍，证伪它。
预测三：仅修分镜Number后，数字12进字符串目录，在`resolveModelParams.ts:59`仍会回默认；以后对拍旧节点12/“12”、合法非默认档位和最终wire的类型和值，不能只断言行上显示12s。
### 4. 靶子独立性检查
现有`shotRow/storyboardComposerModel.test.ts:43`只拿数字型Seedance，`:74`把meta当请求冻结，没跨过`durationSec`覆盖和发送前修值；`parameterControlModel.test.ts:18`只分“数字duration”与“字符串resolution”，没字符串duration。尺子和修法都沿目录原型推，覆盖不独立；本次复盘未执行或新增测试。
明确的回滚`0b35c89e9`因跨入口方案边界未定，不是评测掉分；`42137b4d6`是恢复误删入口。未找到“修对了反而掉分”的证据，不知道。下一次oracle应独立取创作者选择的秒数及供应商契约，逐项对存储/显示/编码值，不能拿同一解析结果自比。
### 5. P0：这些是我们独有的吗？现成方案有哪些
亲自打开：[JSON Schema Type-specific Keywords](https://json-schema.org/understanding-json-schema/reference/type)，`type`单类型及number示例段：数字42通过、字符串“42”不通过；标准只声明/校验，不在任何一步自动转换。影响：给内部值和wire各自明确schema，不能指望select或JSON Schema替业务规整。
亲自打开：[Ajv Type coercion rules](https://ajv.js.org/coercion.html)，开头`coerceTypes`及`Coercion from string values`段：在调用validator、输入不符type时才尝试转换，默认关闭；多类型/oneOf可重复转。影响：转换只放一次边界，不给每个下游或所有schema全局开强转。
亲自打开：[Zod Defining schemas / Coercion](https://zod.dev/api?id=coercion)，`z.coerce`及input/output段：在schema.parse处把unknown变成目标型，number沿用Number语义。影响：复用已安装Zod，门口先排空串/null/布尔及非法文本，再coerce并校验合法档位；不用盲目的全参数Number。另打开Zod v3地址`https://v3.zod.dev/?id=coercion-for-primitives`，页面无可读正文，不能声称已核其段落。
`package.json:312`已有Zod `^3.25.76`、`:363`已有Ajv `8.20.0`；上条可读官网是v4，不据此引入v4专用codec。类型解析非独有业务，优先现有Zod的parse/coerce/transform；“逐镜时长、旧镜头优先级、供应商映射”才是要保留的领域规则。仓内已有完整先例：`V/geminiOmni11.ts:6`用数字时长，`electron/catalog/kieGeminiOmni11.ts:35`记录真实供应商要求字符串，`:38`仅在paramMap用toString；优先推广此现成做法，不另造供应商转换框架。
### 6. 三条路对比表 + 推荐
| 路 | 做什么 / 依据 | 代价、还会不会再来、第二处转换、老用户 |
|---|---|---|
| 沿原方向修 | 在分镜change按合法档位把duration字符串转秒数；上面直接链条可解释 | 最便宜；范围/估时/严格下拉仍会再来；第二处Number照样写得出。旧节点继续分叉，双字段旧镜头仍须处理，不推荐。 |
| 换一种做法（推荐） | 复用Zod，把已有共享参数owner `electron/shared/videoCapabilities/resolveModelParams.ts`补成真正的内部类型入口；目录解析时分开“内部语义型+枚举”与“供应商wire映射”，时长在门内只为number，发送出口复用paramMap一次编码回供应商契约（已有映射可覆写控件原型，以调用契约为准） | 需要一次接齐入口并同提交删旧判断，不能只给resolveModelParams加一档而留下并行路径；可信参数与raw袋用不同类型/私有构造，业务函数不再收unknown。旧值也经这一入口，详见下一行；类型本身挡不住Number(number)，还必须由现有边界门岗拒绝门内重解析。 |
| 删掉 | 先删无生产调用的`ShotParamControls.tsx`解析器；地基完成后最小下一单位是分镜duration的typeof分流，再删数值枚举补丁、重复seconds/asFiniteNumber/numericWireParam中的同职责部分 | 单独删防守会让旧字符串进来后更坏；第二处转换仍写得出，必须依赖上一条才可整块删。保住三处共用面板、实际时长、厂商报文类型；不能删供应商编码/新外部输入的校验；不能靠删除把旧数据隐式改默认。 |
老用户：合法“12”读入转内部12，节点/镜头都同型，编码时按原目录发“12”或12；读时不改磁盘，下次正常保存写规范值，迁移幂等。已有`durationSec=5`与`params.duration="12"`相冲突时不能证明12是用户有效选择：保留原件和当前有效秒数，报告冲突、重新明确选择后才改，不静默择优；无声明明确未验证；非法值按既定的“取最近、付费前说明”政策处理，类型规整不另改裁决，不自动当0/默认，不批量重写用户资料。
推荐理由：它消除同一语义跨供应商流入业务的类型差，同时保住正确的报文契约；“门”是外部原始参数进入共享owner并取得可信内部值的那个交接，目录、UI、Host、旧项目调用同一实现；进程间收到序列化数据属于新信任边界，不能把入口校验也删掉。
第二处自己再转：今天写得出来；推荐实现中，普通调用方拿不到原始联合型/私有解析器、造不出可信参数，编译和依赖门岗拦绕行；对已可信number再写Number仍能通过TS，必须用现有AST/边界检查拒绝，未加该门岗就不能声称“写不出来”。归一者内部允许解析、供应商出口允许编码，其余只消费值。
选错信号：出现无法无损映射的合法契约、原来能发的旧项目被阻断、必须为每个UI再写一个解析器、费用/模型/方式被类型迁移顺便改掉，就停止推广复审。创作者可见变化仅供拍板：选定秒数立即与合计/节点/请求一致；旧冲突明确提示；界面三处仍同一套，不增加配置学习成本。
### 7. 用户要权衡的核心
是在每个漏点继续补一次转换，还是一次把“内部秒数”和“供应商写法”分清并删除漏点；推荐后者，但要承担旧数据冲突显式处理和所有入口同时接齐的成本。
### 8. 独立完成前七步之后，才对照指定全图（三行）
有无：`docs/plan/2026-11-16-agent-writes-params-seam.md`§1步骤1、7涉及档案到宿主参数，没画控件字符串→durationSec→meta/wire的这处类型交接。
关系：本题主归“档案→面板→请求体”；与那张图共享档案和宿主准入底座，交叠而非同一处Agent命名/拒收文字交接，不把其全部历史算成本题类型修复。
方向：与“宿主按同一档案落参数”一致；内部类型和供应商编码必须分开，不能只翻字段名。类型无损规整不冲突于该图§5已定的“值摆不成原样取最近、付费前写明”，也不改助手起草规则；该图的旧基线状态未当作当前事实采信，未查其所述分支或PR。
### 9. 系统哪里没拦住、怎么改
最早应在设计/声明层就分清内部值与报文型（`types.ts:9`只有控件型）；随后现有`electron/catalog/paramConsistency.test.ts:44`只验证参数键被codec消费，非跨入口值/类型一致；`storyboardComposerModel.test.ts:43`判据漏字符串时长和完整发送链。不是“没人注意”，是这类判据尚无；不推断这些测试本轮是否被人跑过。
改那一步：补既有声明/一致性检查而非再加文字；共享owner发出可信参数，删门内重解析并扩既有边界检查，禁止再收原始袋/另写Number或typeof分流。后续用本次RunningHub选12、旧案数字select发串被400（`parameterControlModel.test.ts:16`的真实旧案记录）验证拦截，以Suno文本style与Eleven数字style作不误伤样本；这些是应补的证明，目前未执行，不能写成已拦住。
验收合同/复查：后续实施者接齐上述入口，独立验收按真实档案×供应商×合法非默认选项×旧数/串跑存值/回显/新建/写回/GUI与无界面wire；预测不一致数=0、错误wire型=0、门内重解析=0，量具扩现有一致性测试及边界检查，另实窗zh/en；复查日建议2026-11-24，未达标则重开升档，非本次创建任务。
自验：完整读模板；抽5提交`f354f0b4b 97bce1973 312230c4f 660b3efa2 42137b4d6`打开diff复核，分别确认只认number的局部重置、角色表收口、下拉修值边界退回、真Tooltip补Provider、图片方式入口恢复，与归类一致；命令`git show --format=short --unified=2 <上述短哈希> -- src/workbench/creation/storyboard/shotRow/ src/workbench/generationCanvas/nodes/controls/`；类别总数可用`awk -F'|' '/^\| 11-/ {gsub(/^[ \t]+|[ \t]+$/, "", $4); n[$4]++} END {for(k in n) print k,n[k]}' <本报告>`逐行复算，`735003d1b`与`7a6e713cf`只在去重总数中各计一次。
未检查/风险：设计卡★9“改坏→红/还原→绿”本次只读不适用、无该执行日志；`pnpm run gates:contracts`、构建、测试、设计实验室、走查均未跑，未起窗、不用verify-nomi、不交verify-line-meter。仓库文件改动0，无提交/推送/PR/合并，未读用户资料或Key、未启动代理、未付费；运行行为及旧数据迁移仍unverified，本文不是修复收据。
