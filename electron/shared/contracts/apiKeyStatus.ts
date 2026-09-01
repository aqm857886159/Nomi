// 凭据 key 解密态的**中立契约单一 owner**（electron/shared/contracts/ 是 renderer+main 都可合法 import 的层，
// 见 .dependency-cruiser.mjs 的 src-no-import-electron 豁免）。
//
// 为什么在这儿：这套状态既被主进程凭据层用（electron/catalog/secrets.ts 的 ApiKeyDecryptStatus），
// 又要跨 IPC 出现在渲染层的 connector DTO（src/desktop/bridgeConnector.ts）。过去这类跨进程状态
// 各写各的、只能列 debt；这里立成中立 owner，两侧都从它 derive，消掉重复（R14.1 单一语义 owner）。
//
//   · ok           ：safeStorage 记录解出非空明文 → 真能用。
//   · missing      ：根本没记录或没 key 材料 → 没配过。
//   · locked       ：记录在且是 safeStorage 密文，但当前宿主身份解不开（decrypt 抛错/吐空串）。
//   · needs_resave ：legacy/plain 材料可识别，但必须显式重存为 safeStorage 后才能认证。

export const API_KEY_DECRYPT_STATUSES = ["ok", "missing", "locked", "needs_resave"] as const;

export type ApiKeyDecryptStatus = (typeof API_KEY_DECRYPT_STATUSES)[number];
