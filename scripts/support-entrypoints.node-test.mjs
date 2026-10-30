import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import {makeTempDir,cleanupTestTemp} from './_test-temp.mjs'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {build} from 'vite'
const exec=promisify(execFile)
test('converter bundles its current public API and preview provider',async()=>{
 const result=await build({configFile:false,logLevel:'silent',build:{write:false,lib:{entry:'.design-sync/support/ds-entry.mjs',formats:['es']},minify:false}})
 assert.ok((Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code.includes('NomiPreviewHost'))
 assert.ok((Array.isArray(result)?result[0]:result).output.find(item=>item.type==='chunk').code.includes('WorkbenchButton'))
})
test('director synthetic oracle starts and exercises a real card without inference',async()=>{
 const dir=makeTempDir('nomi-support-oracle-')
 try {const result=await exec(process.execPath,['node_modules/tsx/dist/cli.mjs','evals/director/agentLoop/run.mts','--mode','synthetic-oracle','--cards','courtyard-standoff','--out',dir],{windowsHide:true,maxBuffer:1024*1024});assert.ok(result.stdout.includes('courtyard-standoff'));assert.ok((await fs.readdir(dir)).length>0)}finally{cleanupTestTemp(dir)}
})
