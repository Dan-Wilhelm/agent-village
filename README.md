# Agent Village

A cozy, voxel-style 3D world in first-person view that works as your personal control center for work.
AI agents (powered by Claude) live in the village. They:

- walk up to your office on their own schedule or right before meetings — with a notification;
- tell you what they need and show you your real tasks, read live from ClickUp;
- propose comments, task changes and new tasks that you approve with one click;
- learn from your training and feedback, in playbooks you can read and edit (Markdown, e.g. in Obsidian).

> **Status:** all six build phases are done — village, live ClickUp HQ, agents with playbooks, scheduled visits + push notifications + desktop app (PWA), an in-app agent wizard with teams and team leads, an activity log, and a security review. See [`docs/architecture.md`](docs/architecture.md) for the design.

## Highlights

- **First-person village.** Your office, ClickUp HQ, library, workshop. All art is generated in code from blocks.
- **Agents as characters.** Each has a job, a look, a home and a schedule. Their walking and status show what they are really doing.
- **One input, the right agent.** Type or say what you want ("I want to …"); the dispatcher sends the matching agent.
- **Agent wizard.** Describe a new agent in a sentence; Claude drafts its role, playbook, permissions and schedule — you adjust and create it.
- **Teams.** Team leads hand work to their members. Copy a whole team to another company: the craft travels, the company context is learned fresh.
- **You stay in control.** Write actions are proposals you approve, unless you explicitly allow an action type "without asking" — and even then never after the agent read content written by others. Everything lands in the activity log.
- **Your data stays where it is.** Work data is read live and never copied; the agents' knowledge lives in your own private git repo.

## Self-hosting

Each person who runs Agent Village brings their own accounts and keys (Vercel, Neon, Google OAuth, Anthropic, ClickUp, a private GitHub repo).
Follow **[docs/self-hosting.md](docs/self-hosting.md)** — step by step, about an hour.

```bash
cp .env.example .env.local   # fill in your own values — never commit this file
npm install
npm run db:migrate
npm run dev
```

## Tech stack

Next.js 16 (App Router, Cache Components) · TypeScript · React Three Fiber + Rapier · Claude API (`@anthropic-ai/sdk`) · Neon Postgres + Drizzle · Better Auth (Google + passkeys) · Web Push · Vercel (cron, firewall)

## Security

- Single owner: only `OWNER_EMAIL` can sign in (Google or passkey); sign-ups are impossible.
- Tokens are encrypted (AES-256-GCM); no secret ever reaches the browser, logs or the repo.
- Strict same-origin Content-Security-Policy, CSRF origin checks, rate limits, prompt-injection guards and strict isolation between companies.

Details: [docs/architecture.md § 7](docs/architecture.md#7-security-reviewed-in-phase-6-2026-11-19). Found a vulnerability? See [SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE).
