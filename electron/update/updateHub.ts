// 更新状态的唯一持有者：主进程在这里用共享 reducer 记下「现在到哪一步」，同时广播给所有窗口。
// 渲染层窗口晚于事件打开（比如项目库页在新版被发现之后才挂载）时，用快照补上，不靠重放事件。
import { BrowserWindow } from "electron";
import { reduceUpdaterState, UPDATER_INITIAL_STATE, type UpdateEvent, type UpdaterState } from "../shared/updateReminder";

export const UPDATE_EVENT_CHANNEL = "nomi:update:event";

let state: UpdaterState = UPDATER_INITIAL_STATE;

export function currentUpdaterState(): UpdaterState {
  return state;
}

export function publishUpdateEvent(event: UpdateEvent): void {
  state = reduceUpdaterState(state, event);
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(UPDATE_EVENT_CHANNEL, event);
  }
}

/** 测试隔离用。 */
export function resetUpdateHubForTests(): void {
  state = UPDATER_INITIAL_STATE;
}
