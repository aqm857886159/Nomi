const fs = require('node:fs')
const inspector = require('node:inspector')

const output = process.env.NOMI_CARD12_CPU_PROFILE
if (!output) throw new Error('NOMI_CARD12_CPU_PROFILE is required')

let session
let running = false

process.on('SIGUSR1', () => {
  if (running) return
  session = new inspector.Session()
  session.connect()
  session.post('Profiler.enable', (enableError) => {
    if (enableError) throw enableError
    session.post('Profiler.start', (startError) => {
      if (startError) throw startError
      running = true
    })
  })
})

process.on('SIGUSR2', () => {
  if (!running || !session) return
  session.post('Profiler.stop', (stopError, result) => {
    if (stopError) throw stopError
    fs.writeFileSync(output, JSON.stringify(result.profile))
    session.post('Profiler.disable', () => {
      session.disconnect()
      running = false
      session = undefined
    })
  })
})
