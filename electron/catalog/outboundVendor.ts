// 一个 vendor key 离开这台机器时的样子。只有这一个判据：出门的模型目录、日志尾巴、反馈上下文、Agent 轨迹都读它。
//
// 用户自建中转的 key 是从用户的地址和连接名铸出来的（`gw-example-com`、`internal-proxy-corp-local`），
// 模型名是用户起的别名：塌成 `custom`，模型不出门。
// 内置家的 root 是代码里的字面量，留着；兄弟连接（`apimart--mini`）的后半段是用户起的连接名，不要。
// 种子地址就在这台机器上的内置家：名字照样是代码里的字面量，留着，开发者要靠它分清是本机后端还是中转；
// 名下的模型是用户自己接进来的（工作流、提示词、文件名都在里面，模型名也是用户起的），和自建一样不出门。
// 判种子，不判当前地址：用户把地址改成局域网、再接一台都还算。
//
// 放在这里而不是 `shared/builtinVendorIdentity`：判据要读种子，那个文件渲染层也用，种子不能进浏览器 bundle。
import { builtinVendorKeyOfKey } from "../shared/builtinVendorIdentity";
import { builtinVendorSeed, isLocalSeed } from "./builtinVendorSeeds";

export const CUSTOM_VENDOR = "custom";

export type OutboundVendor = {
  /** 出门用的名字：内置家的 root，其余 `custom`。 */
  vendor: string;
  /** 这一家的模型名、模型行、映射能不能出门。只有云端内置家能。 */
  modelsLeave: boolean;
};

export function outboundVendor(vendorKey: string): OutboundVendor {
  const root = builtinVendorKeyOfKey(vendorKey);
  const seed = builtinVendorSeed(root);
  if (seed === undefined) return { vendor: CUSTOM_VENDOR, modelsLeave: false };
  return { vendor: root, modelsLeave: !isLocalSeed(seed) };
}
