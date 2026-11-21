// 用到生成规划的位置（门的权威、派发入口、界面的窄通道、常驻生成面）只认生成装配工厂发的那一个。
// 测派发和门、不测装配的测试要递一个桩进去：桩经 `issueGenerationPlanningForTest` 进名单，
// 而「可以发测试桩」这件事只在这里打开——生产里没有人调过这一行，发放口一调就抛错。
import { openGenerationPlanningTestIssue } from "../../electron/capabilityCore/generationPlanningIssue";

openGenerationPlanningTestIssue();
