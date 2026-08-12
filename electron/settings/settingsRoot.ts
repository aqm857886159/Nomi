import { app } from "electron";
import path from "node:path";

/** 评测/测试隔离：覆盖固定设置根，防临时项目污染真实 userData。 */
export const SETTINGS_ROOT_ENV = "NOMI_SETTINGS_DIR";

/**
 * 应用设置的固定根目录。它不能依赖可自定义的项目位置，否则项目位置设置会形成自举环。
 *
 * **绝对路径是硬不变量**：全项目十余处都写成 `path.join(getSettingsRoot(), 文件名)`，
 * 根一旦是空串或相对路径，join 出来就还是相对路径 —— 落到 `process.cwd()`：开发/测试时
 * 即仓库根目录（单测曾因此在仓库里写出 model-catalog.json），打包运行时则是启动进程时
 * 碰巧所在的任意目录。这类故障**静默**：文件确实写成功了，只是写错了地方。
 * 故这里当场炸掉，而不是让每个调用点各自去防 —— 真实来源（Electron 的 userData、
 * main.ts 启动时注入的 NOMI_ELECTRON_USER_DATA_DIR、各 e2e 的 NOMI_SETTINGS_DIR）
 * 全都是绝对路径，能走到这个分支就说明接线本身错了。
 */
export function getSettingsRoot(): string {
  const configured = String(process.env[SETTINGS_ROOT_ENV] || "").trim();
  const root = configured || app.getPath("userData");
  if (!path.isAbsolute(root)) {
    throw new Error(
      `[nomi] settings root must be an absolute directory, got ${JSON.stringify(root)}. ` +
        `Set ${SETTINGS_ROOT_ENV} to an absolute path, or make sure Electron's userData path is available before this runs.`,
    );
  }
  return root;
}
