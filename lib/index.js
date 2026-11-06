// dsh-archive-delete — Host half.
//
// DSH deliberately has no Session-delete primitive: a Session can be archived
// but never removed, and the shipped workspace README says so explicitly.
// This plugin adds exactly one narrow destructive operation on top of that:
// permanently delete a Session that is *already archived* and *not running*.
//
// It never deletes a visible Session. The archived set is the admission gate,
// which makes the action opt-in twice: archive first, then delete.
//
// The Host owns the filesystem operation and exposes one authenticated HTTP
// route for the browser half. The route lives outside /api so it cannot be
// confused with a generated Typert Remote endpoint.

import { rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'

export const name = 'dsh-archive-delete'

const DEFAULT_ROUTE = '/plugin/archive-delete/delete'
const MAX_BODY_BYTES = 64 * 1024

/** One in-flight deletion per Session, so a double click cannot race itself. */
const inFlight = new Set()

// ── path encoding (mirrors @deepseek-ai/dsh-session-persistence-jsonl) ──────
// The backend's session directory name is a stable, documented projection of
// the header cwd + Session id. We reproduce it instead of importing the
// package: a plugin installed into a profile cannot resolve @deepseek-ai/*
// bare imports, and the encoding is part of the on-disk format.

function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

function dshHome(options) {
  return resolve(options.dshHome || process.env.DSH_HOME || join(homedir(), '.dsh'))
}

function sessionsRoot(options) {
  return resolve(options.sessionsRoot || join(dshHome(options), 'sessions'))
}

function sessionDirectory(root, header, sessionId) {
  const key = header.cwd === undefined ? '_no-cwd' : projectKey(header.cwd)
  const dir = join(root, key, encodeSegment(String(sessionId)))
  const fence = root.endsWith(sep) ? root : root + sep
  if (!isAbsolute(dir) || !dir.startsWith(fence)) {
    throw new Error('refusing a session path outside the configured sessions root')
  }
  return dir
}

// ── errors ──────────────────────────────────────────────────────────────────

class DeleteError extends Error {
  constructor(code, status, message) {
    super(message)
    this.name = 'ArchiveDeleteError'
    this.code = code
    this.status = status
  }
}

// ── core operation ──────────────────────────────────────────────────────────

/**
 * Permanently delete one archived Session.
 *
 * Preconditions: the id is in the durable archived set, no live Agent owns it,
 * and no other writer holds the Session handle. The log directory is removed
 * first; only then is the registry cleaned up. A failure between the two leaves
 * an archived, file-less id that a retry can finish cleaning (the operation is
 * idempotent).
 *
 * @param {object} scoped Cordis context carrying the required services.
 * @param {string} sessionId Session to delete.
 * @param {object} options Normalized plugin options.
 * @returns {Promise<{sessionId: string, removed: boolean}>}
 */
export async function deleteArchivedSession(scoped, sessionId, options) {
  const id = String(sessionId)
  if (id === '') throw new DeleteError('bad-request', 400, 'sessionId is required')

  const registry = scoped.workspaceRegistry
  if (registry === undefined) throw new DeleteError('unavailable', 503, 'Workspace registry is unavailable')

  if (!registry.archivedSessionIds.includes(id)) {
    throw new DeleteError('not-archived', 409, 'only archived sessions can be permanently deleted')
  }

  const agents = scoped.get('agents')
  if (agents !== undefined && agents.get(id) !== undefined) {
    throw new DeleteError('active', 409, 'the session is currently running')
  }

  if (inFlight.has(id)) throw new DeleteError('busy', 409, 'another delete is already in progress')
  inFlight.add(id)

  try {
    const persistence = scoped.get('sessionPersistence')
    const snapshot = persistence === undefined ? undefined : await persistence.stat(id)

    // Claim write ownership for the duration of the check. This refuses a
    // session another process is writing and makes the window as small as the
    // persistence API allows.
    if (snapshot !== undefined && persistence !== undefined) {
      let handle
      try {
        handle = await persistence.open(id, 'write')
      } catch (error) {
        if (String(error?.name) === 'SessionPersistenceNotFoundError') {
          handle = undefined
        } else if (String(error?.name) === 'SessionAlreadyOwnedError') {
          throw new DeleteError('locked', 423, 'the session is owned by another writer')
        } else {
          throw error
        }
      }
      if (handle !== undefined) await handle.close()
    }

    let removed = false
    if (snapshot !== undefined) {
      const dir = sessionDirectory(sessionsRoot(options), snapshot.header, id)
      await rm(dir, { recursive: true, force: true })
      removed = true
    }

    // Best-effort: stale projection rows are keyed by a header identity that no
    // longer has a log, so they are harmless, but removing them keeps storage
    // tidy.
    await rm(join(dshHome(options), 'storages', 'session_projcache', 'sessions', `${id}.json`), {
      force: true
    }).catch(() => {})

    // Registry cleanup last: a failure here leaves the id archived and the log
    // already gone, which a retry finishes without touching any other Session.
    for (const workspace of registry.list()) {
      if (!workspace.sessionIds.includes(id)) continue
      if (typeof workspace.detachSession === 'function') await workspace.detachSession(id)
    }
    await registry.unarchiveSession(id)

    return { sessionId: id, removed }
  } finally {
    inFlight.delete(id)
  }
}

// ── HTTP surface ────────────────────────────────────────────────────────────

async function readJsonBody(req) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new DeleteError('payload-too-large', 413, 'request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new DeleteError('bad-request', 400, 'request body must be JSON')
  }
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body)
  })
  res.end(body)
}

function rejectionMessage(status) {
  return status === 403 ? 'forbidden' : 'unauthorized'
}

function makeHandler(scoped, options) {
  return async function handleArchiveDelete(req, res) {
    try {
      // Host/Origin fence + browser-session authentication, shared with every
      // other Host API. Without the browser cookie this route is closed.
      const connection = scoped.connection
      const rejection = connection === undefined ? undefined : connection.requestRejection(req)
      if (rejection !== undefined) {
        res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(rejectionMessage(rejection))
        return
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }

      const body = await readJsonBody(req)
      const result = await deleteArchivedSession(scoped, body.sessionId, options)
      sendJson(res, 200, { ok: true, ...result })
    } catch (error) {
      if (error instanceof DeleteError) {
        sendJson(res, error.status, { ok: false, code: error.code, message: error.message })
        return
      }
      const logger = scoped.logger
      if (logger !== undefined && typeof logger.warn === 'function') logger.warn(`[dsh-archive-delete] ${String(error)}`)
      else console.error('[dsh-archive-delete]', error)
      sendJson(res, 500, {
        ok: false,
        code: 'internal',
        message: 'failed to delete the session'
      })
    }
  }
}

/**
 * Mount the Host half: one exact route, owned by this plugin's fiber.
 *
 * @param {object} ctx Cordis context.
 * @param {object} [config] Plugin options.
 * @param {string} [config.route] Route path, default `/plugin/archive-delete/delete`.
 * @param {string} [config.sessionsRoot] Override the JSONL persistence root.
 * @param {string} [config.dshHome] Override the DSH home used for the cache path.
 */
export function apply(ctx, config = {}) {
  const options = {
    route: typeof config.route === 'string' && config.route.startsWith('/') ? config.route : DEFAULT_ROUTE,
    sessionsRoot: typeof config.sessionsRoot === 'string' ? config.sessionsRoot : undefined,
    dshHome: typeof config.dshHome === 'string' ? config.dshHome : undefined
  }

  ctx.inject(['webServer', 'connection', 'workspaceRegistry'], (scoped) => {
    const handler = makeHandler(scoped, options)
    scoped.effect(
      () =>
        scoped.webServer.register({
          kind: 'exact',
          path: options.route,
          handler
        }),
      `dsh-archive-delete: ${options.route}`
    )
  })
}

export const __test = {
  DeleteError,
  deleteArchivedSession,
  encodeSegment,
  makeHandler,
  projectKey,
  sessionDirectory,
  sessionsRoot
}
