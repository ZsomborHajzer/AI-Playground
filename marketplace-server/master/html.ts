// Server-rendered pages. Everything that came from a user goes through h().

export function h(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const STYLE = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1b1b1f;--muted:#6b6b76;--line:#e3e3e8;--card:#f7f7f9;--accent:#5b3cc4;--ok:#1a7f45;--warn:#a66300;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#121216;--fg:#ececf1;--muted:#9a9aa6;--line:#2a2a33;--card:#1b1b22;--accent:#a08bff;--ok:#4cc38a;--warn:#f0a541;--bad:#ff6b5e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
header{display:flex;gap:16px;align-items:center;padding:12px 24px;border-bottom:1px solid var(--line)}
header strong{margin-right:12px}header a{color:var(--muted);text-decoration:none}header a:hover{color:var(--fg)}
main{max-width:1100px;margin:0 auto;padding:24px}h1{font-size:20px;margin:0 0 16px}h2{font-size:16px;margin:24px 0 8px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--muted);font-weight:500}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;display:flex;flex-direction:column;gap:10px;max-width:640px}
label{display:flex;flex-direction:column;gap:4px}input,textarea,select{font:inherit;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
button{font:inherit;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button.danger{color:var(--bad)}button:disabled{opacity:.5;cursor:not-allowed}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:auto;max-height:420px;white-space:pre-wrap}
.token{font-size:15px;user-select:all}.muted{color:var(--muted)}.error{color:var(--bad)}.ok{color:var(--ok)}.warn{color:var(--warn)}
.badge{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid var(--line)}
.badge.in-review{color:var(--warn)}.badge.published{color:var(--ok)}.badge.rejected,.badge.changes-requested{color:var(--bad)}
details{border:1px solid var(--line);border-radius:8px;padding:8px 12px;margin:6px 0}summary{cursor:pointer}
.flash{padding:10px 14px;border:1px solid var(--accent);border-radius:8px;margin-bottom:16px}`

export function page(title: string, body: string, nav = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${h(title)} · AI Playground Marketplace</title><style>${STYLE}</style></head>
<body><header><strong>AI Playground Marketplace</strong>${nav}</header><main><h1>${h(title)}</h1>${body}</main></body></html>`
}

export const adminNav = (username: string, csrf: string) => `
  <a href="/admin/queue">Review queue</a><a href="/admin/plugins">Published</a>
  <a href="/admin/publishers">Publishers</a><a href="/admin/mirrors">Mirrors</a>
  <span style="flex:1"></span><span class="muted">${h(username)}</span>
  <form method="post" action="/admin/logout" style="margin:0"><input type="hidden" name="csrf" value="${h(csrf)}"><button>Sign out</button></form>`
