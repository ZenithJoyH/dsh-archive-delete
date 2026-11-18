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
  localStorage: (() => {
    const map = new Map()
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)) },
      removeItem: (k) => { map.delete(k) }
    }
  })(),
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
assert.deepEqual(Array.from(loaded.inject), ['slots', 'locale', 'sessions', 'uiWorkspace'])
const api = loaded.__test
assert.ok(api, 'test hooks should be exported')

// post-delete cleanup: current session is removed from the list and left
{
  const removed = []
  let started = 0
  const ctx = {
    sessions: {
      list: { getSnapshot: () => ({ byId: { 'session-1': { retainedBy: { mainView: 1 } } } }) },
      manager: { handleSessionRemoved: (id) => removed.push(id) }
    },
    uiWorkspace: { startSession: () => { started += 1 } }
  }
  api.cleanupDeletedSession(ctx, 'session-1')
  assert.deepEqual(removed, ['session-1'])
  assert.equal(started, 1)
}

// post-delete cleanup: a non-current session is removed without navigation
{
  const removed = []
  let started = 0
  const ctx = {
    sessions: {
      list: { getSnapshot: () => ({ byId: {} }) },
      manager: { handleSessionRemoved: (id) => removed.push(id) }
    },
    uiWorkspace: { startSession: () => { started += 1 } }
  }
  api.cleanupDeletedSession(ctx, 'session-2')
  assert.deepEqual(removed, ['session-2'])
  assert.equal(started, 0)
}

// ── unread marks ────────────────────────────────────────────────────────────

{
  assert.equal(api.isUnread('session-a'), false)
  api.setUnread(undefined, 'session-a', true)
  assert.equal(api.isUnread('session-a'), true)
  assert.deepEqual(JSON.parse(sandbox.localStorage.getItem('dsh-archive-delete.unread')), ['session-a'])
  api.setUnread(undefined, 'session-a', false)
  assert.equal(api.isUnread('session-a'), false)
  assert.deepEqual(JSON.parse(sandbox.localStorage.getItem('dsh-archive-delete.unread')), [])
}

// a mark clears only when the Session transitions into the main view
{
  let main = { 'session-b': { retainedBy: { mainView: 0 } } }
  const subscribers = []
  const sessions = {
    list: {
      getSnapshot: () => ({ byId: main }),
      subscribe: (fn) => { subscribers.push(fn); return () => {} }
    }
  }
  const ctx = {
    sessions,
    effect: (fn) => { fn() }
  }
  api.setUnread(undefined, 'session-b', true)
  assert.equal(api.isUnread('session-b'), true)
  api.installUnreadReconciler(ctx)

  // still not main: the mark survives
  main = { 'session-b': { retainedBy: { mainView: 0 } } }
  subscribers.forEach((fn) => fn())
  assert.equal(api.isUnread('session-b'), true, 'mark survives while not opened')

  // marking the already-open session does not instantly clear
  main = { 'session-b': { retainedBy: { mainView: 1 } } }
  subscribers.forEach((fn) => fn())
  assert.equal(api.isUnread('session-b'), false, 'opening clears the mark')

  // a removed session drops its mark
  api.setUnread(undefined, 'session-b', true)
  main = {}
  subscribers.forEach((fn) => fn())
  assert.equal(api.isUnread('session-b'), false, 'removed session drops its mark')
}

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
