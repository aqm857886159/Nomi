// 主人存盘文件名（27 个）：不手写字面量，直接取产品里已有的两张表。
// `SEEDED_CONFIG_FILES` + `DELIBERATELY_NOT_SEEDED` 本来就是「设置根里所有配置文件」的全集，
// 并且 sideBySideInstallSeed.test.ts 会扫产品代码里真实出现的文件名、名单外的新文件名它自己就红——走散由它兜。
// 这里只读，不改产品代码。
import { DELIBERATELY_NOT_SEEDED, SEEDED_CONFIG_FILES } from "../../electron/settings/sideBySideInstallSeed";

export const OWNER_FILE_NAMES: ReadonlySet<string> = new Set<string>([...SEEDED_CONFIG_FILES, ...DELIBERATELY_NOT_SEEDED]);
