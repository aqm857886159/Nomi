'use strict'
const { Session } = require('node:inspector')
let session
const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (error, result) => error ? reject(error) : resolve(result)))
globalThis.__nomiDiagnosticCpu = {
  async arm() { session = new Session(); session.connect(); await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: 1000 }); await post('Profiler.start') },
  async take() { try { return (await post('Profiler.stop')).profile } finally { session.disconnect(); session = null } },
}
