// P1 ③ 的**被杀掉的那半**：用生产路径 `openLane` 打开一条 lane，闸永远不回答，
// 把会话 id 打到 stdout，然后等着被父进程 `SIGKILL`。
//
// 不是测试文件（没有 `.test.`），只被 `stage3-probe-p1-approval-wait.test.mts` spawn。
// 为什么必须是子进程：同一进程里第二次打开同一条会话会被 `laneSession.mts` 的单持有者
// 名单拦下；绕过它就等于测了一条生产走不到的路。真崩溃 = 进程没了、盘上有一个 open 的操作。
import { openLane } from '../../electron/agentLane/laneHost.mjs';
import { createDocumentLaneTools } from '../../electron/agentLane/laneDocumentTools.js';
import { createDocumentPort, LANE_SYSTEM_PROMPT } from './laneFixture.mjs';

const [projectDir, baseURL] = process.argv.slice(2);
if (!projectDir || !baseURL) throw new Error('usage: stage3-probe-crash-child <projectDir> <baseURL>');

const lane = await openLane({
  projectDir,
  systemPrompt: LANE_SYSTEM_PROMPT,
  model: { kind: 'openai-compatible', providerId: 'nomi-lane', modelId: 'chosen-model', baseURL, authType: 'api-key', apiKey: 'fixture-key' },
  tools: createDocumentLaneTools(createDocumentPort()),
  gate: () => {
    process.stdout.write(`PARKED session=${lane.sessionId}\n`);
    return new Promise(() => {});
  },
});
// 不 await：这一轮永远不会结束。进程活着，直到父进程杀掉它。
void lane.execute({ kind: 'prompt', text: 'Append something.' });
setInterval(() => {}, 60_000);
