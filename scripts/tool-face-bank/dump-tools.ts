// 把 4 个工具的对外定义原样 dump 成 JSON，给真实模型跑分用。
// 不手抄任何描述/schema：真实模型看到的必须和 tools/list 广播的**逐字节相同**，
// 否则量的就不是生产工具面（docs/lessons/assert-you-are-in-the-situation-you-claim）。
import { MODEL_ONBOARDING_TOOLS } from '../../electron/capabilityCore/modelOnboarding/tools'
process.stdout.write(JSON.stringify(MODEL_ONBOARDING_TOOLS, null, 2))
