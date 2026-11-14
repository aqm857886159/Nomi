# 现有功能保留普查
基线：4af670000308d0fad812f3a5169fa163ad4fdc7d；独立只读普查线：/root/repo_provider_audit。所有新归宿是设计建议，未修改产品。

| 现有能力 | 来源 | 新归宿 / 保留要求 |
|---|---|---|
| 保存、检查、已保存待验证 | [KnownVendorKeyConnectPage](../../../../src/ui/onboarding/KnownVendorKeyConnectPage.tsx#L86) | S02/S05：新增连接可保存待验证，不要求重贴；更换旧Key失败不覆盖 |
| 连接列表、模型与搜索 | [ModelSettingsHome](../../../../src/ui/onboarding/ModelSettingsHome.tsx#L392) | S08/S18：保留实际启用状态与搜索 |
| 同平台多账户、多Key | [duplicateHostConnections](../../../../src/ui/onboarding/duplicateHostConnections.ts#L28)、[connectionVendorKey](../../../../electron/catalog/connectionVendorKey.ts#L86) | S18：独立连接身份；不同名字不覆盖兄弟连接，同名更新按原规则 |
| 修改API地址 | [VendorBaseUrlField](../../../../src/ui/onboarding/VendorBaseUrlField.tsx#L66) | S18地址与网络；S05故障可直接到达；保留修改/取消/校验/保存重探 |
| 更换、清除Key | [VendorOnboardCard](../../../../src/ui/onboarding/VendorOnboardCard.tsx#L124) | S18：保持加密保存，不回显；清Key与删连接分别操作 |
| 查询添加模型、手工登记 | [ExistingConnectionModelPicker](../../../../src/ui/onboarding/ExistingConnectionModelPicker.tsx#L30)、[OnboardingDrawer](../../../../src/ui/onboarding/OnboardingDrawer.tsx#L517) | S08/S18：保留已添加识别、类型确认、列表失败时手填；失败不判Key无效 |
| 模型启停、删除、类型与契约 | [OnboardingDrawer](../../../../src/ui/onboarding/OnboardingDrawer.tsx#L715) | 模型详情高级；官方schema不静默覆盖用户契约/启停 |
| 手工API、协议、header、代理 | [OnboardingWizardAdvancedFields](../../../../src/ui/onboarding/OnboardingWizardAdvancedFields.tsx#L119) | S18：继续允许新增与维护其他平台；不强制APIMart |
| 脚本、模式脚本、草稿、试跑/取消、修复 | [CustomCallEditor](../../../../src/ui/onboarding/CustomCallEditor.tsx#L95) | 原高级模型编辑器；保留草稿、试跑与发布差别，不重建供应商专属编辑器 |
| 连接健康、网络诊断 | [useVendorHealth](../../../../src/ui/onboarding/useVendorHealth.ts#L46)、[NetworkSection](../../../../src/ui/onboarding/NetworkSection.tsx#L72) | S05/S18：错误简述与原诊断；系统/关闭/自定义代理与部分可达区别保留 |
| 接入任务进度、取消、逐模型重试 | [AdapterTaskWorkspace](../../../../src/ui/onboarding/AdapterTaskWorkspace.tsx#L87) | 原任务区与模型详情；改首页不隐藏进行中的接入任务 |
| 导入、导出与冲突 | [ModelCatalogNotices](../../../../src/ui/onboarding/ModelCatalogNotices.tsx#L125)、[catalogStore](../../../../electron/catalog/catalogStore.ts#L602) | S18配置迁移；导出不带Key，冲突默认保留本机，覆盖显式选择 |
| 外部助手与AI辅助接入 | [AutomationPermissionsSection](../../../../src/workbench/settings/AutomationPermissionsSection.tsx#L126)、[AiAssistedOnboardingSection](../../../../src/ui/onboarding/AiAssistedOnboardingSection.tsx#L47) | 助手仍归自动化设置；模型页只链接，不把APIMart认证当助手握手 |
| 本地模型、ComfyUI、多实例、CLI/会员、数据源 | [OnboardingDrawer](../../../../src/ui/onboarding/OnboardingDrawer.tsx#L787) | S18保留原入口；离线模型/素材数据源不被API中转替代 |
| 旧生成任务与结果取回 | [taskResultQuery](../../../../electron/tasks/taskResultQuery.ts#L108)、[productionRetrievalReopen](../../../../electron/productionRun/productionRetrievalReopen.ts#L10) | 原任务和节点；保留vendorKey/modelKey/mapping/taskId及凭据关系 |
| 未保存保护、返回层级、焦点 | [ModelSettingsDetailDialog](../../../../src/ui/onboarding/ModelSettingsDetailDialog.tsx#L28) | 原设置导航；补原任务return context，未保存内容有明确处理，不建平行草稿库 |

## 不能因新稿未画细节而删除的内容
S18 只是高级入口归宿，不是完整替换原管理器。新推荐卡只影响无可用连接的新用户，已有用户不自动换默认平台。端点编辑仍归用户；联网失败不能硬锁成唯一地址。各类旧数据与真实升级测试须在生产实现PR补齐，本次只查源码。

## 现有 owner
账户事实扩主进程连接读取；价格扩 shared/contracts/shotPricingRule；schema投影至 ModelArchetype / modelAdmissionSchema；幂等能力需按模型/操作扩 mapping与执行准入，再接 productionGenerationSubmission 的耐久身份与去重门。任何一项都不另造第二套任务、模型或凭据数据库。
