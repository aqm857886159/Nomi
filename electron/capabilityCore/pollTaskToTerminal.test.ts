import {afterEach,expect,it,vi} from 'vitest'
import {pollTaskToTerminal} from './pollTaskToTerminal'
afterEach(()=>vi.useRealTimers())
it.each([1000,2000])('does not start a fetch after sleep exhausts the remaining budget: %i',async intervalMs=>{
 vi.useFakeTimers();const fetch=vi.fn(async()=>({result:{id:'task',status:'queued' as const,assets:[]}}));
 const pending=pollTaskToTerminal({initial:{id:'task',status:'queued',assets:[]},fetch,vendor:'fixture',taskKind:'text_to_image',prompt:'fixture',modelKey:'fixture',timeoutMs:1000,intervalMs});
 await vi.advanceTimersByTimeAsync(1000);
 expect(fetch).not.toHaveBeenCalled();
 await expect(pending).resolves.toMatchObject({ended:'timeout',waitedMs:1000,result:{id:'task',status:'queued'}});
})
