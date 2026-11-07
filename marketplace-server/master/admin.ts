// The reviewers' web pages: queue, submission detail with decisions, published
// plugins (revoke), publishers and mirrors.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { DatabaseSync } from 'node:sqlite'
import { sha256Hex, type PackageReport, type TrustTier } from '../shared/index.ts'
import { readZip } from '../lib/zip.ts'
import { cookieValue, login, logout, rateLimiter, sessionFor, type Session } from './auth.ts'
import type { MasterConfig } from './config.ts'
import type { MasterCore } from './core.ts'
import { adminNav, h, page } from './html.ts'

const COOKIE = 'aipg_admin'
const decoder = new TextDecoder()

type Form = Record<string, string | undefined>

export function registerAdminRoutes(
  app: FastifyInstance,
  core: MasterCore,
  config: MasterConfig,
  db: DatabaseSync,
) {
  const loginLimiter = rateLimiter(10, 60_000)

  const sessionOf = (request: FastifyRequest) =>
    sessionFor(db, cookieValue(request.headers.cookie, COOKIE))

  const render = (reply: FastifyReply, session: Session, title: string, body: string) =>
    reply.type('text/html').send(page(title, body, adminNav(session.username, session.csrf)))

  const csrfField = (session: Session) =>
    `<input type="hidden" name="csrf" value="${h(session.csrf)}">`

  /** GET pages: a session or a redirect to the login form. */
  function guardPage(request: FastifyRequest, reply: FastifyReply): Session | undefined {
    const session = sessionOf(request)
    if (!session) void reply.redirect('/admin/login')
    return session
  }

  /** POST actions: a session and a matching CSRF token, or a 403. */
  function guardAction(request: FastifyRequest, reply: FastifyReply): Session | undefined {
    const session = sessionOf(request)
    const form = (request.body ?? {}) as Form
    if (!session || form.csrf !== session.csrf) {
      void reply
        .code(403)
        .type('text/html')
        .send(
          page(
            'Forbidden',
            '<p>Your session expired. <a href="/admin/login">Sign in again</a>.</p>',
          ),
        )
      return undefined
    }
    return session
  }

  const flash = (request: FastifyRequest) => {
    const msg = (request.query as { msg?: string }).msg
    return msg ? `<div class="flash">${h(msg)}</div>` : ''
  }
  const back = (reply: FastifyReply, to: string, msg: string) =>
    reply.redirect(`${to}?msg=${encodeURIComponent(msg)}`)

  // ── sign in / out ────────────────────────────────────────────────────────

  app.get('/admin', async (_request, reply) => reply.redirect('/admin/queue'))

  app.get('/admin/login', async (request, reply) => {
    reply.type('text/html')
    return page(
      'Sign in',
      `${flash(request)}<form method="post" action="/admin/login" class="card">
        <label>Username <input name="username" required autocomplete="username"></label>
        <label>Password <input name="password" type="password" required autocomplete="current-password"></label>
        <button class="primary">Sign in</button></form>`,
    )
  })

  app.post('/admin/login', async (request, reply) => {
    if (!loginLimiter(request.ip))
      return back(reply, '/admin/login', 'Too many attempts; wait a minute')
    const form = (request.body ?? {}) as Form
    const session = login(db, form.username ?? '', form.password ?? '')
    if (!session) return back(reply, '/admin/login', 'Wrong username or password')
    const secure = config.secureCookies ? '; Secure' : ''
    reply.header(
      'set-cookie',
      `${COOKIE}=${session.id}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=43200${secure}`,
    )
    return reply.redirect('/admin/queue')
  })

  app.post('/admin/logout', async (request, reply) => {
    const session = guardAction(request, reply)
    if (!session) return reply
    logout(db, session.id)
    reply.header('set-cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0`)
    return reply.redirect('/admin/login')
  })

  // ── review queue ─────────────────────────────────────────────────────────

  app.get('/admin/queue', async (request, reply) => {
    const session = guardPage(request, reply)
    if (!session) return reply
    const row = (s: ReturnType<typeof core.submissionsByStatus>[number]) => {
      const report = JSON.parse(s.report_json) as PackageReport
      const warnings = report.issues.filter((i) => i.level === 'warning').length
      return `<tr><td><a href="/admin/submissions/${s.id}">#${s.id}</a></td><td>${h(s.plugin_id)}</td><td>${h(s.version)}</td>
        <td>${h(s.publisher_id)}</td><td><span class="badge ${h(s.status)}">${h(s.status)}</span>${s.trust ? ` <span class="muted">${h(s.trust)}</span>` : ''}</td>
        <td class="${warnings ? 'warn' : 'muted'}">${warnings} warning${warnings === 1 ? '' : 's'}</td><td class="muted">${h(s.updated_at.slice(0, 16).replace('T', ' '))}</td></tr>`
    }
    const table = (rows: ReturnType<typeof core.submissionsByStatus>, empty: string) =>
      rows.length
        ? `<table><tr><th>#</th><th>Plugin</th><th>Version</th><th>Publisher</th><th>Status</th><th>Checks</th><th>Updated</th></tr>${rows.map(row).join('')}</table>`
        : `<p class="muted">${empty}</p>`
    return render(
      reply,
      session,
      'Review queue',
      `${flash(request)}${table(core.submissionsByStatus('in-review'), 'Nothing is waiting for review.')}
       <h2>Recently decided</h2>${table(core.submissionsByStatus('decided', 20), 'No decisions yet.')}`,
    )
  })

  app.get<{ Params: { id: string } }>('/admin/submissions/:id', async (request, reply) => {
    const session = guardPage(request, reply)
    if (!session) return reply
    const s = core.submission(Number(request.params.id))
    if (!s) return reply.code(404).send('Not found')
    const owner = core.publisher(s.publisher_id)!
    const report = JSON.parse(s.report_json) as PackageReport
    const files = filesOf(core.readPackage(s.sha256))
    const previousVersion = core.latestPublished(s.plugin_id)
    const previous = previousVersion
      ? core.releases().find((r) => r.plugin_id === s.plugin_id && r.version === previousVersion)
      : undefined
    const diff = previous ? diffFiles(filesOf(core.readPackage(previous.sha256)), files) : undefined

    const issues = report.issues.length
      ? `<ul>${report.issues.map((i) => `<li class="${i.level === 'error' ? 'error' : 'warn'}"><code>${h(i.code)}</code>${i.path ? ` <span class="muted">${h(i.path)}</span>` : ''} — ${h(i.message)}</li>`).join('')}</ul>`
      : '<p class="ok">No warnings.</p>'
    const presets = report.presets
      .map((p) => {
        const file = files.get(p.path)
        let pretty = ''
        try {
          pretty = JSON.stringify(
            JSON.parse(decoder.decode(file?.data ?? new Uint8Array())),
            null,
            2,
          )
        } catch {
          pretty = '(unreadable)'
        }
        return `<details><summary>${h(p.name)} <span class="muted">[${h(p.type)}] ${h(p.path)}</span></summary><pre>${h(pretty)}</pre></details>`
      })
      .join('')
    const fileRows = [...files.values()]
      .map(
        (f) =>
          `<tr><td><code>${h(f.path)}</code></td><td>${f.data.length.toLocaleString()} B</td><td class="muted"><code>${f.sha.slice(0, 12)}</code></td></tr>`,
      )
      .join('')
    const diffHtml = diff
      ? `<h2>Changes since ${h(previousVersion)}</h2>${
          diff.added.length + diff.removed.length + diff.changed.length === 0
            ? '<p class="muted">No file changes.</p>'
            : `<ul>${diff.added.map((p) => `<li class="ok">added <code>${h(p)}</code></li>`).join('')}${diff.removed.map((p) => `<li class="error">removed <code>${h(p)}</code></li>`).join('')}${diff.changed.map((p) => `<li class="warn">changed <code>${h(p)}</code></li>`).join('')}</ul>`
        }`
      : '<h2>Changes</h2><p class="muted">First version of this plugin.</p>'

    const actions =
      s.status === 'in-review'
        ? `<h2>Decision</h2><form method="post" action="/admin/submissions/${s.id}/decision" class="card">${csrfField(session)}
            <label>Note to the publisher <textarea name="note" rows="3" placeholder="Required when requesting changes or rejecting"></textarea></label>
            <div class="row">
              <button class="primary" name="decision" value="approve-community">Approve as Community</button>
              <button class="primary" name="decision" value="approve-verified" ${owner.verified ? '' : 'disabled title="Verify the publisher first"'}>Approve as Verified</button>
              <button name="decision" value="changes-requested">Request changes</button>
              <button class="danger" name="decision" value="rejected">Reject</button>
            </div></form>`
        : `<p>Status <span class="badge ${h(s.status)}">${h(s.status)}</span> by ${h(s.reviewer)}${s.review_note ? ` — ${h(s.review_note)}` : ''}</p>`

    return render(
      reply,
      session,
      `${s.plugin_id}@${s.version}`,
      `${flash(request)}
       <p>Submission #${s.id} by <strong>${h(owner.name)}</strong> (<code>${h(owner.id)}</code>${owner.verified ? ', <span class="ok">verified publisher</span>' : ', unverified publisher'}) · ${h(s.created_at.slice(0, 16).replace('T', ' '))} · ${s.size.toLocaleString()} bytes · sha256 <code>${h(s.sha256.slice(0, 16))}…</code></p>
       ${actions}
       <h2>Automated checks</h2>${issues}
       ${diffHtml}
       <h2>Presets (${report.presets.length})</h2>${presets}
       <h2>README</h2><pre>${h(s.readme ?? '(none)')}</pre>
       <h2>Manifest</h2><pre>${h(JSON.stringify(JSON.parse(s.manifest_json), null, 2))}</pre>
       <h2>Files</h2><table><tr><th>Path</th><th>Size</th><th>sha256</th></tr>${fileRows}</table>`,
    )
  })

  app.post<{ Params: { id: string } }>(
    '/admin/submissions/:id/decision',
    async (request, reply) => {
      const session = guardAction(request, reply)
      if (!session) return reply
      const id = Number(request.params.id)
      const form = (request.body ?? {}) as Form
      const note = form.note ?? ''
      try {
        if (form.decision === 'approve-community' || form.decision === 'approve-verified') {
          const trust: TrustTier = form.decision === 'approve-verified' ? 'verified' : 'community'
          const { release } = core.approve(id, session.username, trust, note)
          return back(
            reply,
            '/admin/queue',
            `Published ${release.id}@${release.version} as ${trust}; pushing to mirrors.`,
          )
        }
        if (form.decision === 'changes-requested') core.requestChanges(id, session.username, note)
        else if (form.decision === 'rejected') core.reject(id, session.username, note)
        else throw new Error('Unknown decision')
        return back(reply, '/admin/queue', `Submission #${id}: ${form.decision}.`)
      } catch (e) {
        return back(reply, `/admin/submissions/${id}`, (e as Error).message)
      }
    },
  )

  // ── published plugins ────────────────────────────────────────────────────

  app.get('/admin/plugins', async (request, reply) => {
    const session = guardPage(request, reply)
    if (!session) return reply
    const downloads = core.downloads()
    const rows = core
      .releases()
      .map(
        (
          r,
        ) => `<tr><td>${h(r.plugin_id)}</td><td>${h(r.version)}</td><td>${r.seq}</td><td>${downloads[r.plugin_id] ?? 0}</td>
          <td>${r.revoked ? `<span class="error">revoked</span> <span class="muted">${h(r.revoke_reason)}</span>` : '<span class="ok">live</span>'}</td>
          <td>${
            r.revoked
              ? ''
              : `<form method="post" action="/admin/revoke" class="row" style="margin:0">${csrfField(session)}
            <input type="hidden" name="pluginId" value="${h(r.plugin_id)}"><input type="hidden" name="version" value="${h(r.version)}">
            <input name="reason" placeholder="Reason users will see" required><button class="danger">Revoke</button></form>`
          }</td></tr>`,
      )
      .join('')
    return render(
      reply,
      session,
      'Published plugins',
      `${flash(request)}<p class="muted">Revoking removes a version from every mirror's catalog and disables it in apps that installed it.</p>
       ${rows ? `<table><tr><th>Plugin</th><th>Version</th><th>Seq</th><th>Downloads</th><th>State</th><th></th></tr>${rows}</table>` : '<p class="muted">Nothing published yet.</p>'}`,
    )
  })

  app.post('/admin/revoke', async (request, reply) => {
    const session = guardAction(request, reply)
    if (!session) return reply
    const form = (request.body ?? {}) as Form
    try {
      core.revoke(form.pluginId ?? '', form.version ?? '', form.reason ?? '')
      return back(reply, '/admin/plugins', `Revoked ${form.pluginId}@${form.version}.`)
    } catch (e) {
      return back(reply, '/admin/plugins', (e as Error).message)
    }
  })

  // ── publishers ───────────────────────────────────────────────────────────

  app.get('/admin/publishers', async (request, reply) => {
    const session = guardPage(request, reply)
    if (!session) return reply
    const rows = core
      .publishers()
      .map(
        (p) => `<tr><td><code>${h(p.id)}</code></td><td>${h(p.name)}</td><td>${h(p.email)}</td>
          <td>${p.verified ? '<span class="ok">verified</span>' : 'unverified'}${p.disabled ? ' <span class="error">disabled</span>' : ''}</td>
          <td><form method="post" action="/admin/publishers/${h(p.id)}" class="row" style="margin:0">${csrfField(session)}
            <button name="action" value="${p.verified ? 'unverify' : 'verify'}">${p.verified ? 'Unverify' : 'Verify'}</button>
            <button name="action" value="${p.disabled ? 'enable' : 'disable'}">${p.disabled ? 'Enable' : 'Disable'}</button>
            <button name="action" value="rotate">New token</button></form></td></tr>`,
      )
      .join('')
    return render(
      reply,
      session,
      'Publishers',
      `${flash(request)}<p class="muted">Registration is <strong>${config.registration}</strong>${config.registration === 'open' ? ` — publishers sign up at <a href="/register">/register</a>` : ''}. Verify a publisher only after checking who they are; it unlocks the Verified tier for their plugins.</p>
       ${rows ? `<table><tr><th>Id</th><th>Name</th><th>Email</th><th>State</th><th></th></tr>${rows}</table>` : '<p class="muted">No publishers yet.</p>'}
       <h2>Create a publisher</h2>
       <form method="post" action="/admin/publishers" class="card">${csrfField(session)}
         <label>Publisher id <input name="id" required pattern="[a-z0-9][a-z0-9-]{1,38}"></label>
         <label>Display name <input name="name" required maxlength="60"></label>
         <label>Email <input name="email" type="email" required></label>
         <button class="primary">Create and show token</button></form>`,
    )
  })

  const tokenPage = (reply: FastifyReply, session: Session, publisherId: string, token: string) =>
    render(
      reply,
      session,
      'Publisher token',
      `<div class="card"><p>Token for <strong>${h(publisherId)}</strong>. It is shown once; any older token stops working.</p><pre class="token">${h(token)}</pre>
       <p><a href="/admin/publishers">Back to publishers</a></p></div>`,
    )

  app.post('/admin/publishers', async (request, reply) => {
    const session = guardAction(request, reply)
    if (!session) return reply
    try {
      const { publisher, token } = core.registerPublisher(
        (request.body ?? {}) as { id: string; name: string; email: string },
      )
      return tokenPage(reply, session, publisher.id, token)
    } catch (e) {
      return back(reply, '/admin/publishers', (e as Error).message)
    }
  })

  app.post<{ Params: { id: string } }>('/admin/publishers/:id', async (request, reply) => {
    const session = guardAction(request, reply)
    if (!session) return reply
    const id = request.params.id
    const action = ((request.body ?? {}) as Form).action
    if (action === 'rotate') return tokenPage(reply, session, id, core.rotateToken(id))
    if (action === 'verify' || action === 'unverify')
      core.setPublisherFlag(id, 'verified', action === 'verify')
    if (action === 'disable' || action === 'enable')
      core.setPublisherFlag(id, 'disabled', action === 'disable')
    return back(reply, '/admin/publishers', `${id}: ${action}.`)
  })

  // ── mirrors ──────────────────────────────────────────────────────────────

  app.get('/admin/mirrors', async (request, reply) => {
    const session = guardPage(request, reply)
    if (!session) return reply
    const seq = core.currentSeq()
    const rows = core
      .mirrors()
      .map(
        (
          m,
        ) => `<tr><td>${h(m.name)}<br><code class="muted">${h(m.id)}</code></td><td>${h(m.url)}</td>
          <td class="${m.last_acked_seq >= seq ? 'ok' : 'warn'}">${m.last_acked_seq} / ${seq}</td>
          <td class="muted">${h(m.last_contact?.slice(0, 16).replace('T', ' ') ?? 'never')}</td><td class="error">${h(m.last_error ?? '')}</td>
          <td><form method="post" action="/admin/mirrors/${h(m.id)}/delete" style="margin:0">${csrfField(session)}<button class="danger">Remove</button></form></td></tr>`,
      )
      .join('')
    return render(
      reply,
      session,
      'Distribution servers',
      `${flash(request)}<p class="muted">Every approval and revocation is pushed to these servers; a server that was offline catches up from the master when it starts.</p>
       ${rows ? `<table><tr><th>Mirror</th><th>URL</th><th>Synced seq</th><th>Last contact</th><th>Last error</th><th></th></tr>${rows}</table>` : '<p class="muted">No distribution servers yet.</p>'}
       <h2>Add a distribution server</h2>
       <form method="post" action="/admin/mirrors" class="card">${csrfField(session)}
         <label>Name <input name="name" required maxlength="60" placeholder="eu-west-1"></label>
         <label>Base URL the master can reach <input name="url" required placeholder="https://mirror1.example.com"></label>
         <button class="primary">Add and show its configuration</button></form>`,
    )
  })

  app.post('/admin/mirrors', async (request, reply) => {
    const session = guardAction(request, reply)
    if (!session) return reply
    try {
      const { mirror, secret } = core.addMirror(
        (request.body ?? {}) as { name: string; url: string },
      )
      const env = [
        `MIRROR_ID=${mirror.id}`,
        `MIRROR_SECRET=${secret}`,
        `MASTER_URL=${config.publicUrl}`,
        `MASTER_PUBLIC_KEY_FILE=./master-public-key.pem`,
      ].join('\n')
      return render(
        reply,
        session,
        'Distribution server added',
        `<div class="card"><p>1. Put these lines in the mirror's <code>.env</code>. The secret is shown once.</p><pre class="token">${h(env)}</pre>
         <p>2. Save the master public key next to it as <code>master-public-key.pem</code> (key id <code>${h(core.keys.keyId)}</code>):</p>
         <pre>${h(core.keys.publicKeyPem)}</pre>
         <p>3. Start the mirror. The master pushes the catalog to it within seconds.</p>
         <p><a href="/admin/mirrors">Back to mirrors</a></p></div>`,
      )
    } catch (e) {
      return back(reply, '/admin/mirrors', (e as Error).message)
    }
  })

  app.post<{ Params: { id: string } }>('/admin/mirrors/:id/delete', async (request, reply) => {
    const session = guardAction(request, reply)
    if (!session) return reply
    core.removeMirror(request.params.id)
    return back(reply, '/admin/mirrors', `Removed ${request.params.id}.`)
  })
}

type PackageFile = { path: string; data: Uint8Array; sha: string }

function filesOf(bytes: Uint8Array | undefined): Map<string, PackageFile> {
  const files = new Map<string, PackageFile>()
  if (!bytes) return files
  const zip = readZip(bytes)
  if ('error' in zip) return files
  for (const e of zip.entries.sort((a, b) => a.path.localeCompare(b.path))) {
    const data = e.read()
    files.set(e.path, { path: e.path, data, sha: sha256Hex(data) })
  }
  return files
}

function diffFiles(before: Map<string, PackageFile>, after: Map<string, PackageFile>) {
  return {
    added: [...after.keys()].filter((p) => !before.has(p)),
    removed: [...before.keys()].filter((p) => !after.has(p)),
    changed: [...after.keys()].filter(
      (p) => before.has(p) && before.get(p)!.sha !== after.get(p)!.sha,
    ),
  }
}
