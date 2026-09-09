import console from 'node:console'
import process from 'node:process'
import { makeIsolatedDirs, spawnMcpStdioClient } from '../../../tests/ux/_mcpJourney.mjs'
const dirs = makeIsolatedDirs('nomi-b6-visible-')
const mcp = spawnMcpStdioClient({ ...dirs, clientInfo: { name: 'Claude MCP inspection', version: '1' }, capabilities: {}, captureStderr: true })
try {
  const init = await mcp.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Claude MCP inspection', version: '1' } }, 10000)
  console.log('B6 | Real Electron MCP stdio | isolated fixture | '+process.argv[2])
  console.log('initialize:', init.result?.protocolVersion)
  const listed = await mcp.rpc('tools/list', {}, 10000)
  for (const name of ['nomi_canvas_edit','nomi_run_start','nomi_timeline_edit','nomi_export_job']) {
    const tool = listed.result.tools.find(t=>t.name===name)
    console.log('\n'+name+'\n  '+tool.title)
  }
  const timeline = listed.result.tools.find(t=>t.name==='nomi_timeline_edit')
  console.log('\nTimeline plan operation fields:\n'+Object.keys(timeline.inputSchema.properties.plan.properties.operations.items.properties).join(', '))
  const prompts = (await mcp.rpc('prompts/list', {},10000)).result.prompts
  const prompt = prompts.find(p=>p.name==='director-cinematography')
  console.log('\nSkill prompt published fields:',Object.keys(prompt).join(', '))
  console.log('Total tools:',listed.result.tools.length,'| Total skill prompts:',prompts.length)
} finally { await mcp.terminate() }
