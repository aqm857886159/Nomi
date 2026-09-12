// Agent lane 失败码 → 用户读到的那句话。
//
// 码表的真相源是 `electron/shared/agentLane/laneErrorCodes.ts`；这里每个键都必须与它一一对应，
// 少一条或多一条由 `check:error-surface` 报红。
//
// 写法约束（R2 用户视角 + 极简）：每句话只说两件事——**发生了什么** + **他现在该做什么**。
// 不出现「workspace」「lane」「IPC」这类我们内部的词；它们在用户那里没有指称。
export const zhAgentLaneError = {
  agent_lane_bridge_absent: '这个版本里 Agent 没接上，用桌面版打开再试。',
  agent_lane_closed: '这个窗口还没有打开的对话，新建一条再发。',
  agent_lane_disposed: 'Nomi 正在退出，Agent 已经停了。',
  agent_lane_opening: '对话还在打开，稍等一下再发。',
  agent_lane_owner_mismatch: '另一个窗口正在用这个项目的 Agent，关掉那个窗口再试。',
  agent_lane_workspace_stale: '对话已经换过了，刚才那句没发出去，重新发一次。',
  agent_lane_invalid_command: '这条消息发不出去，内容太长或者格式不对，改短一点再试。',
  agent_lane_request_duplicate: '同一个请求已经在跑了，等它出结果。',
  agent_lane_provider_error: '模型没给出结果，也没说原因，再试一次。',
  agent_lane_model_unconfigured: '还没有能用的文本模型，去「模型接入」连一个。',
  agent_skill_unavailable: '这条消息引用的技能已经不在了，重新选一个。',
  project_binding_stale: '项目在这句话发出去的途中换了，没有执行，回到项目里重新发。',
  project_identity_unavailable: '找不到项目文件夹，重新打开一次项目。',
  project_agent_unavailable: '这个项目的 Agent 现在用不了。',
  agent_lane_conversation_missing: '这条对话已经不在了，选另一条或新建一条。',
  agent_lane_conversation_exists: '已经有同名的对话了，换个名字。',
  agent_lane_conversation_in_use: '正在用的这条删不掉，先切到另一条。',
  agent_lane_busy_running: '这一轮还在跑，先按停再换模型。',
  agent_lane_approval_missing: '这张卡已经不在等了，不用再答。',
  agent_lane_execute_failed: '这次没执行成功，再试一次。',
} as const

export const enAgentLaneError = {
  agent_lane_bridge_absent: 'The agent is not available in this build. Open Nomi desktop and try again.',
  agent_lane_closed: 'No conversation is open in this window. Start one, then send.',
  agent_lane_disposed: 'Nomi is shutting down, so the agent has stopped.',
  agent_lane_opening: 'The conversation is still opening. Give it a moment, then send.',
  agent_lane_owner_mismatch: 'Another window is using this project’s agent. Close that window and try again.',
  agent_lane_workspace_stale: 'The conversation changed, so that message was not sent. Send it again.',
  agent_lane_invalid_command: 'That message could not be sent — it is too long or malformed. Shorten it and try again.',
  agent_lane_request_duplicate: 'That request is already running. Wait for its result.',
  agent_lane_provider_error: 'The model returned no result and no reason. Try again.',
  agent_lane_model_unconfigured: 'No text model is connected yet. Connect one under Models.',
  agent_skill_unavailable: 'The skill this message refers to is gone. Pick another one.',
  project_binding_stale: 'The project changed while this message was in flight, so nothing ran. Reopen the project and send it again.',
  project_identity_unavailable: 'The project folder could not be found. Reopen the project.',
  project_agent_unavailable: 'The agent is unavailable for this project.',
  agent_lane_conversation_missing: 'That conversation is gone. Pick another one or start a new one.',
  agent_lane_conversation_exists: 'A conversation with that name already exists. Pick another name.',
  agent_lane_conversation_in_use: 'You cannot delete the conversation you are in. Switch to another one first.',
  agent_lane_busy_running: 'This turn is still running. Stop it before changing the model.',
  agent_lane_approval_missing: 'That request is no longer waiting for an answer.',
  agent_lane_execute_failed: 'That did not go through. Try again.',
} satisfies TranslationShape<typeof zhAgentLaneError>

type TranslationShape<T> = {
  [K in keyof T]: T[K] extends string ? string : TranslationShape<T[K]>
}
