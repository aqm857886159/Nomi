// Test-only subprocess: models the documented NDJSON contract, no network.
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { setInterval, setTimeout } from 'node:timers';
import { execFileSync, execSync, spawn } from 'node:child_process';
import path from 'node:path';
const [mode, output, ...args] = process.argv.slice(2);
const runShell = (command, options = {}) => process.platform === 'win32'
  ? execSync(command, options) : execFileSync('/bin/sh', ['-c', command], options);
if (mode === 'discovery') {
  process.stdin.resume();
  process.stdin.on('end', () => process.stdout.write(args.includes('--version')
    ? 'agy 1.1.21\n' : 'gemini-3.7-flash-high\tGemini 3.7 Flash (High)\n'));
} else {
  const agent = args[args.indexOf('--agent') + 1];
  const log = args.includes('--log-file') ? args[args.indexOf('--log-file') + 1] : undefined;
  if (log && mode !== 'missing-log') fs.writeFileSync(log, mode === 'agent-fallback'
    ? `Agent "${agent}" not found, falling back to default\n`
    : mode === 'oversize-log' ? 'x'.repeat(2 * 1024 * 1024 + 1) : 'CLI initialized\n');
  if (log && ['fifo-log', 'symlink-log'].includes(mode)) {
    fs.unlinkSync(log);
    if (mode === 'fifo-log') execFileSync('mkfifo', [log]);
    else {
      fs.writeFileSync(path.join(output, 'symlink-target'), 'CLI initialized\n');
      fs.symlinkSync(path.join(output, 'symlink-target'), log);
    }
  }
  const media = mode.startsWith('media-');
  const conversationId = media ? '019c2751-ebc7-4d12-b62a-3b5e4d9e02e7' : 'one';
  const profile = path.join(process.cwd(), '.agents', 'agents', agent, 'agent.md');
  if (fs.existsSync(profile)) fs.copyFileSync(profile, path.join(output, 'profile'));
  if (args.includes('--add-dir')) fs.writeFileSync(path.join(output, 'mounted-cwd'), args[args.indexOf('--add-dir') + 1]);
  fs.writeFileSync(path.join(output, 'cwd'), process.cwd());
  let policy; let hook;
  if (media) {
    const plugin = path.join(process.cwd(), 'task-gate');
    policy = JSON.parse(/^const policy = (.+);$/m.exec(fs.readFileSync(path.join(plugin, 'gate.cjs'), 'utf8'))[1]);
    const hooks = JSON.parse(fs.readFileSync(path.join(plugin, 'hooks.json'), 'utf8'))['nomi-task-gate'];
    hook = (phase, event) => JSON.parse(runShell(phase === 'init'
      ? hooks.PreInvocation[0].command : hooks.PreToolUse[0].hooks[0].command,
      { input: JSON.stringify(event), encoding: 'utf8', timeout: 3000 }));

  }
  const send = (event) => process.stdout.write(JSON.stringify(event) + '\n');
  if (mode === 'hang') setInterval(() => {}, 100);
  else if (mode === 'auth') { process.stderr.write('Please sign in to view available models.'); process.exit(1); }
  else {
    const init = JSON.stringify({ event: 'init', conversation_id: conversationId, init: {
      agent, cwd: process.cwd(), tools: ['run_command', 'generate_image', 'view_file'], permission_mode: 'request-review',
    } }) + '\n';
    process.stdout.write(init.slice(0, 11));
    setTimeout(() => process.stdout.write(init.slice(11)), 5);
    let input = ''; process.stdin.setEncoding('utf8');
    let handshaken = false;
    process.stdin.on('data', (chunk) => {
      input += chunk; fs.writeFileSync(path.join(output, 'input'), input);
      if (media && !handshaken && input.includes('\n')) {
        handshaken = true;
        if (mode !== 'media-missing-hook') hook('init', {});
        const prompt = JSON.parse(input.trim()).message.content;
        fs.writeFileSync(path.join(output, 'preflight-files'), JSON.stringify(policy.images.map(image => fs.existsSync(image.path))));
        send({event:'result',result:{status:'SUCCESS',conversation_id:conversationId,response:prompt,
          num_turns:1,duration_seconds:0.1,usage:{input_tokens:1,output_tokens:1,thinking_tokens:0,cache_read_tokens:0,total_tokens:2}}});
      }
    });
    process.stdin.on('end', async () => {
      if (media) {
        const vision = mode === 'media-vision';
        const name = vision ? 'view_file' : 'generate_image';
        const args = vision ? { AbsolutePath: policy.images[0].path } : {
          ImageName: policy.imageName, ImagePaths: policy.images.map(image => image.path), Prompt: 'test scene',
        };
        if (mode === 'media-wrong-reference') args.ImagePaths = ['/unrelated/private.png'];
        const decision = mode === 'media-missing-hook' ? {} : hook('tool', {toolCall:{name,args}});
        if (decision.decision === 'deny') {
          send({event:'step_update',step_update:{conversation_id:conversationId,step_index:2,state:'ERROR',step_type:'tool',tool_info:{name}}});
          return;
        }
        if (mode === 'media-double-generate') {
          const again = hook('tool', {toolCall:{name,args}});
          fs.writeFileSync(path.join(output, 'second-decision'), JSON.stringify(again));
          send({event:'step_update',step_update:{conversation_id:conversationId,step_index:2,state:'DONE',step_type:'tool',tool_info:{name}}});
          send({event:'step_update',step_update:{conversation_id:conversationId,step_index:3,state:'ERROR',step_type:'tool',tool_info:{name}}});
          return;
        }
        if (!vision) {
          const root = path.join(process.env.HOME,'.gemini','antigravity-cli','brain',conversationId);
          const system = path.join(root,'.system_generated');
          fs.mkdirSync(path.join(system,'logs'),{recursive:true});
          fs.mkdirSync(path.join(system,'steps','2'),{recursive:true});
          const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5foAAAAASUVORK5CYII=','base64');
          let generated = path.join(root,policy.imageName+'_1787760625514.png');
          if (mode === 'media-artifact-outside') generated = path.join(output,path.basename(generated));
          if (mode === 'media-artifact-symlink') {
            const other = path.join(output,'image.png');fs.writeFileSync(other,png);fs.symlinkSync(other,generated);
          } else if (mode === 'media-artifact-fifo') execFileSync('mkfifo',[generated]);
          else fs.writeFileSync(generated,mode === 'media-artifact-corrupt' ? png.subarray(0,30) : png);
          fs.writeFileSync(path.join(system,'steps','2','output.txt'),'Generated image is saved at '+generated+'.\n');
          fs.writeFileSync(path.join(system,'logs','transcript_full.jsonl'),[
            {step_index:1,source:'MODEL',type:'PLANNER_RESPONSE',status:'DONE',tool_calls:[{name,args}]},
            {step_index:2,source:'MODEL',type:'GENERIC',status:'DONE'},
          ].map(JSON.stringify).join('\n'));
        }
        send({event:'step_update',step_update:{conversation_id:conversationId,step_index:2,state:'DONE',step_type:'tool',tool_info:{name}}});
      }
      if (mode === 'tool-call') {
        send({ event: 'step_update', step_update: { step_type: 'tool', tool_name: 'run_command' } });
        return;
      }
      if (mode === 'silent-descendant-success' || mode === 'silent-descendant-cancel') {
        const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); process.send('ready'); setInterval(()=>{},100)"],
          { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        await new Promise((resolve) => child.once('message', resolve));
        fs.writeFileSync(path.join(output, 'child-pid'), String(child.pid));
        child.disconnect(); child.unref();
        if (mode === 'silent-descendant-cancel') { setInterval(() => {}, 100); return; }
      }
      if (mode === 'descendant') {
        const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},100)'], { stdio: ['ignore', 'inherit', 'inherit'] });
        fs.writeFileSync(path.join(output, 'child-pid'), String(child.pid));
        child.unref();
        process.exit(0);
      }
      if (mode === 'stuck') { process.on('SIGTERM', () => {}); setInterval(() => {}, 100); return; }
      if (mode === 'malformed-tail') { process.stdout.write('bad JSON'); return; }
      if (mode === 'malformed') { process.stdout.write('bad JSON\n'); return; }
      if (mode === 'missing') return;
      send({ event: 'step_update', step_update: { conversation_id: conversationId, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: '你' } });
      const result = { event: 'result', result: { status: 'SUCCESS', conversation_id: conversationId, response: '你好',
        duration_seconds: 0.1, num_turns: media ? 2 : 1, usage: { input_tokens: 2, output_tokens: 2, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 4 } } };
      send(result); if (mode === 'duplicate') send(result);
      if (mode === 'trailing-garbage') process.stdout.write('bad JSON');
      if (mode === 'nonzero') process.exitCode = 1;
    });
  }
}
