// Host-half tests: run with `node test/host.test.mjs` (no DSH process needed).
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  __test,
  deleteArchivedSession
} from '../lib/index.js'

const {
  DeleteError,
  encodeSegment,
  projectKey,
  sessionDirectory,
  sessionsRoot
} = __test

// ── path encoding ───────────────────────────────────────────────────────────

assert.equal(encodeSegment('session-1'), 'session-1')
assert.equal(encodeSegment('a/b'), 'a~002Fb')
assert.equal(encodeSegment('.'), '~002E')

assert.equal(
  projectKey('/Users/baai/Documents/deepseek-harness/default-workspace'),
  '--Users-baai-Documents-deepseek-harness-default-workspace--'
)
assert.equal(projectKey('C:\\work\\x'), '--C-work-x--')

const root = '/tmp/dsh-sessions'
assert.equal(
  sessionDirectory(root, { cwd: '/Users/baai/x' }, 'session-1'),
  join(root, '--Users-baai-x--', 'session-1')
)
assert.equal(sessionDirectory(root, { cwd: undefined }, 'session-1'), join(root, '_no-cwd', 'session-1'))
// Path traversal is neutralized by segment encoding rather than rejected.
assert.equal(
  sessionDirectory(root, { cwd: '/a' }, '../../etc'),
  join(root, '--a--', '..~002F..~002Fetc')
)

// sessionsRoot honours explicit config and DSH_HOME.
assert.equal(sessionsRoot({ sessionsRoot: '/custom/root' }), '/custom/root')
assert.ok(sessionsRoot({}).endsWith('/sessions'))

// ── fixtures ────────────────────────────────────────────────────────────────

const home = await mkdtemp(join(tmpdir(), 'dsh-ad-home-'))
const sessions = join(home, 'sessions')
const cwd = '/Users/baai/Documents/demo'
const sessionId = 'session-11111111-2222-3333-4444-555555555555'
const dir = sessionDirectory(sessions, { cwd }, sessionId)
await mkdir(dir, { recursive: true })
await writeFile(join(dir, 'session.v4.jsonl.zstd'), 'stub')

function makeScoped(overrides = {}) {
  const cleaned = []
  const registry = {
    archivedSessionIds: [sessionId],
    list() {
      return [
        {
          sessionIds: [sessionId],
          async detachSession(id) {
            cleaned.push(['detach', id])
            this.sessionIds = this.sessionIds.filter((value) => value !== id)
          }
        }
      ]
    },
    async unarchiveSession(id) {
      cleaned.push(['unarchive', id])
      this.archivedSessionIds = this.archivedSessionIds.filter((value) => value !== id)
    },
    ...overrides.registry
  }
  const persistence = {
    async stat(id) {
      if (id !== sessionId) return undefined
      return { header: { id, cwd } }
    },
    async open() {
      return { close: async () => {} }
    },
    ...overrides.persistence
  }
  return {
    cleaned,
    registry,
    persistence,
    agents: overrides.agents ?? { get: () => undefined },
    get(name) {
      if (name === 'agents') return this.agents
      return undefined
    },
    workspaceRegistry: registry,
    sessionPersistence: persistence
  }
}

// ── happy path ──────────────────────────────────────────────────────────────

{
  const scoped = makeScoped()
  const result = await deleteArchivedSession(scoped, sessionId, {
    sessionsRoot: sessions,
    dshHome: home
  })
  assert.deepEqual(result, { sessionId, removed: true })
  await assert.rejects(access(dir), /ENOENT/)
  assert.deepEqual(scoped.cleaned, [
    ['detach', sessionId],
    ['unarchive', sessionId]
  ])
}

// ── refuses a non-archived session ──────────────────────────────────────────

{
  const scoped = makeScoped({ registry: { archivedSessionIds: [] } })
  await assert.rejects(
    deleteArchivedSession(scoped, sessionId, { sessionsRoot: sessions, dshHome: home }),
    (error) => error instanceof DeleteError && error.code === 'not-archived'
  )
}

// ── refuses a running session ───────────────────────────────────────────────

{
  const scoped = makeScoped({ agents: { get: (id) => (id === sessionId ? { id } : undefined) } })
  await assert.rejects(
    deleteArchivedSession(scoped, sessionId, { sessionsRoot: sessions, dshHome: home }),
    (error) => error instanceof DeleteError && error.code === 'active'
  )
}

// ── refuses a session owned by another writer ───────────────────────────────

{
  const owned = new Error('owned')
  owned.name = 'SessionAlreadyOwnedError'
  const scoped = makeScoped({ persistence: { open: async () => Promise.reject(owned) } })
  await assert.rejects(
    deleteArchivedSession(scoped, sessionId, { sessionsRoot: sessions, dshHome: home }),
    (error) => error instanceof DeleteError && error.code === 'locked'
  )
}

// ── idempotent cleanup when the log is already gone ─────────────────────────

{
  const scoped = makeScoped({ persistence: { stat: async () => undefined } })
  const result = await deleteArchivedSession(scoped, sessionId, {
    sessionsRoot: sessions,
    dshHome: home
  })
  assert.deepEqual(result, { sessionId, removed: false })
  assert.deepEqual(scoped.cleaned, [
    ['detach', sessionId],
    ['unarchive', sessionId]
  ])
}

await rm(home, { recursive: true, force: true })
console.log('host tests: ok')

// ── HTTP surface ────────────────────────────────────────────────────────────

function mockRequest(method, body) {
  const payload = body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body))
  return {
    method,
    async *[Symbol.asyncIterator]() {
      if (payload.length > 0) yield payload
    }
  }
}

function mockResponse() {
  return {
    status: 0,
    headers: undefined,
    body: '',
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    end(body = '') {
      this.body += body
    }
  }
}

{
  const scoped = makeScoped()
  scoped.connection = { requestRejection: () => 401 }
  scoped.webServer = { register: () => () => {} }
  const handler = __test.makeHandler(scoped, { sessionsRoot: sessions, dshHome: home })
  const res = mockResponse()
  await handler(mockRequest('POST', { sessionId }), res)
  assert.equal(res.status, 401)
}

{
  const scoped = makeScoped()
  scoped.connection = { requestRejection: () => undefined }
  scoped.webServer = { register: () => () => {} }
  const handler = __test.makeHandler(scoped, { sessionsRoot: sessions, dshHome: home })
  const res = mockResponse()
  await handler(mockRequest('GET'), res)
  assert.equal(res.status, 405)
  assert.equal(res.headers.allow, 'POST')
}

{
  const scoped = makeScoped()
  scoped.connection = { requestRejection: () => undefined }
  scoped.webServer = { register: () => () => {} }
  const handler = __test.makeHandler(scoped, { sessionsRoot: sessions, dshHome: home })
  const res = mockResponse()
  await handler(mockRequest('POST', { sessionId }), res)
  assert.equal(res.status, 200)
  assert.deepEqual(JSON.parse(res.body), { ok: true, sessionId, removed: true })
}
