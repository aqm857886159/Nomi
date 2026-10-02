# 源任务身份的结构评审

状态：针对本次再生成故障的评审完成；非全仓审计。

`src/workbench` 近期的 video-reference-default 与 canvas-generate-ignores-production-shot 合同分别暴露了槽偏好双真相源、生成所有权分裂。本次第三个表现是“媒体连线”被当作足够的源身份。

共同问题是画布展示状态不能替代执行契约。已有参考槽继续负责媒体内容，productionShotOwnership 继续负责执行权；本次将源任务约束声明在档案，由共享 sourceTaskInput 验证来源，画布只做结果投影。禁止读取已被用户改过的源节点当前模型和分辨率。

`electron/catalog` 的 profile preflight 原来以存在 request_transform 为必要条件，导致持久化映射绕过输入验证。现在源任务契约独立触发检查，验证渲染后的 HTTP body，覆盖无 transform 的旧映射和 headless 调用。

`electron/shared` 持有字段和资格判据，渲染层与主进程分别使用各自翻译入口，不反向依赖主进程文案模块。手填 ID 只能验证非空，账号、时效和白名单仍由供应商判断，不声称本地能验证远端状态。

`src/i18n` 的聚类是上述错误展示的随行改动；本次只增中英文键，不在文案层重新判断模型资格。错误种类仍从共享 validator 派生，静态键映射让翻译门岗能逐条验证。

验收：错误用例先红后绿；覆盖连线、同节点、跨供应商、手填冲突、2K 源、旧模式和映射丢字段。真实媒体解码已确认现场输出为 2560×1440；Windows 桌面及真实付费链路分别记结果，不用单测代替实测。
