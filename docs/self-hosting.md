# Self-hosting Agent Village

This guide sets up your own, private Agent Village: one owner (you), your own accounts and keys, nothing shared with anyone. Plan about an hour.

> Everything below uses **your** accounts. Never paste keys into chats or commit them; put them into Vercel's environment variables (mark them *Sensitive*) and into a local `.env.local` that git ignores.

## 0. What you need

| Account | Used for | Notes |
|---|---|---|
| GitHub | this code + a **private** repo for the agents' knowledge ("vault") | |
| Vercel (**Pro**) | hosting, cron, firewall | The visit scheduler runs every minute — Hobby only allows daily cron jobs. |
| Neon Postgres | login data, encrypted ClickUp token, visits, activity log | via the Vercel Marketplace; pick an EU region if you want data in the EU |
| Google Cloud | "Sign in with Google" (OAuth client) | free |
| Anthropic | Claude API key for the agents | set a monthly spend limit in the Console |
| ClickUp | the work environment the agents read | a **personal API token** of your own account |
| Google Calendar *(optional)* | meeting-triggered visits | via a tiny Apps Script web app |
| Obsidian *(optional)* | reading/editing the vault comfortably | the vault is plain Markdown in git |

## 1. Code and Vercel project

1. Fork or clone this repository.
2. In Vercel: **Add New → Project**, import your fork. Framework: Next.js (detected).
3. Optional: keep functions close to your database — `vercel.json` pins them to `fra1` (Frankfurt). Change `regions` if your database lives elsewhere.
4. Add your own domain under **Settings → Domains** (recommended, e.g. `village.example.com`).

## 2. Database (Neon)

1. Vercel → **Storage → Marketplace → Neon** → create a database and connect it to the project (this sets `DATABASE_URL` and `DATABASE_URL_UNPOOLED`).
2. Locally: `vercel link`, then `vercel env pull .env.local`.
3. Create the tables: `npm install && npm run db:migrate`.

## 3. Environment variables

Set these in Vercel (**Settings → Environment Variables**, Production; mark secrets *Sensitive*). See `.env.example` for the full list with comments.

| Variable | How to get it |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (a different one per environment) |
| `BETTER_AUTH_URL` | your public URL, e.g. `https://village.example.com` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | step 4 |
| `OWNER_EMAIL` | your Google account's email — **the only person who can ever sign in** |
| `OWNER_USER_ID` *(optional)* | second lock, see step 5 |
| `ENCRYPTION_KEY` | `openssl rand -base64 32` — encrypts the stored ClickUp token; keep it safe (losing it means reconnecting ClickUp) |
| `ANTHROPIC_API_KEY` | Anthropic Console → API keys |
| `VAULT_REPO` / `GITHUB_VAULT_TOKEN` | step 6 |
| `CALENDAR_FEED_URL` / `CALENDAR_FEED_SECRET` *(optional)* | step 8 |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | your site URL or a `mailto:` address (required for notifications) |

Never set `DEV_LOGIN_SECRET` in Vercel — it only exists for local automated tests.

## 4. Google sign-in

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**, type *Web application*.
2. Authorized redirect URI: `<BETTER_AUTH_URL>/api/auth/callback/google` (add `http://localhost:3000/api/auth/callback/google` for local development).
3. Copy client ID and secret into the env vars. Turn on 2-step verification for this Google account — it is the main key to your village.

## 5. First sign-in and passkey

1. Redeploy (Vercel → Deployments → Redeploy) so the env vars apply, then open your URL and sign in with Google.
2. **Settings → Passkeys → Add a passkey** (Touch ID / Windows Hello). From now on you can sign in without Google.
3. Optional second lock: copy your user id from the database table `auth_user` into `OWNER_USER_ID` and redeploy.

## 6. The agents' vault (private GitHub repo)

The agents keep their settings and playbooks as Markdown in a **separate private repo** — never in this code repo.

1. Create a **private** repo, e.g. `you/agent-vault`, and copy the contents of [`vault-template/`](../vault-template) into it. Rename `Acme` (folder, file and the `name`/`id`/`company` fields) to your company.
2. GitHub → Settings → Developer settings → **Fine-grained tokens** → *Only select repositories*: your vault repo → Permissions: **Contents: Read and write** (nothing else).
3. Set `VAULT_REPO=you/agent-vault` and `GITHUB_VAULT_TOKEN=<token>` (optional `VAULT_BRANCH`, default `main`).
4. Optional — edit it in Obsidian: clone the vault repo into your Obsidian vault folder and let [`scripts/vault-sync.sh`](../scripts/vault-sync.sh) keep it in sync every 5 minutes (macOS: see [`scripts/com.agentvillage.vault-sync.plist.template`](../scripts/com.agentvillage.vault-sync.plist.template)).

## 7. ClickUp

1. ClickUp → avatar → **Settings → Apps → API Token** → generate your personal token.
2. In the village: **Settings → ClickUp** → paste the token → choose the workspace → tick the spaces the agents may read. The token is encrypted before it is stored.
3. Create a **private list** named exactly like `drafts_list` in your company note (default `Drafts – pending approval`) in one of the allowed spaces — ideally your personal space. It is the only place agents write without asking.
4. Bind the company to the workspace: in your company note set `clickup_team_id` to the number after `app.clickup.com/` in your ClickUp URL. **Without it the company's agents get no ClickUp access** (strict isolation between companies).

## 8. Calendar feed (optional)

ClickUp's API has no calendar, so meeting-triggered visits read Google Calendar through a tiny Apps Script web app that only you can call:

1. [script.google.com](https://script.google.com) → New project → paste [`docs/integrations/google-calendar-feed.gs`](integrations/google-calendar-feed.gs) → set the `SECRET` at the top to a long random value.
2. **Deploy → New deployment → Web app**, execute as *Me*, access *Anyone* (the secret protects it). Copy the URL.
3. Set `CALENDAR_FEED_URL` and `CALENDAR_FEED_SECRET`. Test: opening the URL without `?key=` must answer `forbidden`.

## 9. Visits, notifications, desktop app

- **Visits:** `vercel.json` runs `/api/cron/visits` every minute (needs `CRON_SECRET`). Agents with a schedule or a "before calendar events" trigger then come to your office on their own.
- **Notifications:** Settings → *Notifications & desktop app* → Turn on → Send test. On macOS also allow notifications for your browser in System Settings.
- **Desktop app:** install the page as an app (Chrome: install icon in the address bar; Safari: File → Add to Dock).

## 10. Firewall (recommended)

Vercel mitigates DDoS automatically. Additionally enable **Firewall → Bot Management → Bot Protection** in *Log* mode, check the traffic for a few days, then switch it to *Challenge*.

## 11. Your first agents

Agents → **+ New agent** → describe what it should do (or speak it) → "✨ Fill in for me" → adjust → Create. On its first visit the agent introduces itself and asks its open questions; your answers become rules in the vault.

## Security checklist

- [ ] 2-step verification on GitHub, Vercel, Google, ClickUp and the Anthropic Console
- [ ] Monthly spend limit in the Anthropic Console
- [ ] All secrets in Vercel are marked *Sensitive*; `.env.local` is never committed
- [ ] `OWNER_EMAIL` is set (and optionally `OWNER_USER_ID`)
- [ ] The vault repo is **private** and its token can only access that repo
- [ ] Bot Protection enabled; GitHub secret scanning + Dependabot enabled on your fork
- [ ] Agents are allowed to act "without asking" only for things you truly trust them with

## Local development

```bash
cp .env.example .env.local   # or: vercel env pull .env.local
npm install
npm run db:migrate
npm run dev                  # http://localhost:3000
npm test                     # unit tests
npm run lint && npx tsc --noEmit
```

For automated browser tests you can set `DEV_LOGIN_SECRET` in `.env.local` only; `/api/dev/login` then signs in the owner when called with the header `x-dev-login: <secret>` (development builds only).

## Costs (rough, one person)

Vercel Pro and the Neon/Google/ClickUp/GitHub parts are fixed or free at this scale. The variable part is the Claude API: simple agents run on Claude Haiku, consulting agents on Claude Opus; a normal working day with a few briefings and conversations typically costs a few dollars. The app's own rate limits and your Anthropic spend limit cap the worst case.
