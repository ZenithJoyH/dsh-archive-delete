// Smoke test for the browser half (no real browser needed).
const fs = require('fs')
const vm = require('vm')
const path = require('path')
const assert = require('assert')

const code = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')

const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useRef: (value) => ({ current: value }),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useSyncExternalStore: (subscribe, get) => get()
}

let loaded = null
const responses = []
const sandbox = {
  window: {
    __ModuleLoader__: {
      load(definition) {
        loaded = definition.factory((name) => {
          if (name === 'react') return reactStub
          if (name === '@deepseek-ai/dsh-client-ui-primitives') throw new Error('not available in this lane')
          throw new Error('unexpected require: ' + name)
        })
      }
    }
  },
  document: {
    head: { appendChild() {} },
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    addEventListener() {},
    removeEventListener() {}
  },
  fetch: async (url, init) => {
    responses.push({ url, init })
    return { ok: true, json: async () => ({ ok: true, sessionId: 'session-1', removed: true }) }
  },
  setTimeout,
  clearTimeout,
  console,
  Date,
  Math,
  Object,
  String,
  Number,
  Array,
  Map,
  Set,
  Symbol,
  JSON,
  Promise
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(code, sandbox, { filename: 'lib/client.js' })

assert.ok(loaded, 'bundle should expose a module')
assert.equal(typeof loaded.apply, 'function')
assert.deepEqual(Array.from(loaded.inject), ['slots', 'locale'])
const api = loaded.__test
assert.ok(api, 'test hooks should be exported')

// store lifecycle
assert.equal(api.getPending(), null)
api.openDelete({ sessionId: 'session-1', title: 'Demo' })
assert.equal(api.getPending().phase, 'confirm')
assert.equal(api.getPending().title, 'Demo')

// a successful confirm clears the pending target and POSTs the exact route
const run = api.confirmDelete()
assert.equal(api.getPending().phase, 'deleting')
run.then(() => {
  assert.equal(api.getPending(), null)
  assert.equal(responses.length, 1)
  assert.equal(responses[0].url, '/plugin/archive-delete/delete')
  assert.equal(responses[0].init.method, 'POST')
  assert.deepEqual(JSON.parse(responses[0].init.body), { sessionId: 'session-1' })

  // closing while deleting is refused
  sandbox.fetch = async () => ({ ok: false, json: async () => ({ ok: false, code: 'active' }) })
  api.openDelete({ sessionId: 'session-2', title: '' })
  const failing = api.confirmDelete()
  api.closeDelete()
  assert.equal(api.getPending().phase, 'deleting')
  failing.then(() => {
    assert.equal(api.getPending().phase, 'confirm')
    assert.equal(api.getPending().error, 'active')
    console.log('client tests: ok')
  }).catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
