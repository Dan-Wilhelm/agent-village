# Agent Village

A cozy, voxel-style 3D world in first-person view that works as your personal control center for work.
AI agents (powered by Claude) live in the village. They:

- walk up to your office;
- tell you what they need in speech bubbles;
- show you tasks and lists;
- learn from your training and feedback;
- do approved work in your tools, starting with ClickUp.

> **Status: Phase 2 of 6 done** — owner-locked login, the first-person village with demo agents, and the ClickUp connection (settings, encrypted token, sync + webhooks, task overview in ClickUp HQ). Real agents come in Phases 3–4. See [`docs/architecture.md`](docs/architecture.md) for the full design and roadmap.

## Highlights (planned)

- **First-person village.** Your office, ClickUp HQ and other buildings. All art is generated in code from blocks.
- **Agents as characters.** Each agent has a role and a schedule or is called on demand. Its walking and status show what it is really doing.
- **One input, the right agent.** Type, say or drop what you want. The Dispatcher picks the matching agent, and that agent comes running.
- **Training and feedback.** Agents introduce themselves, ask what they need, and turn your feedback into versioned, editable playbooks.
- **You stay in control.** Every write action needs your approval unless you allow it explicitly, and everything goes into an audit log.
- **Single-owner and secure.**
  - Login is required, with a passkey or 2FA.
  - Sign-ups are disabled.
  - API tokens are encrypted server-side.

## Tech stack

Next.js 16 · TypeScript · React Three Fiber · Claude API (`@anthropic-ai/sdk`) · Vercel Workflow · Neon Postgres + Drizzle · Better Auth (Google + passkeys) · Web Push

## Self-hosting

Each person who runs Agent Village brings their own accounts and keys: Vercel, Neon, a Google OAuth client, an Anthropic API key and a ClickUp personal token.
A step-by-step setup guide will be added in Phase 6. Until then:

- Set `OWNER_EMAIL` to your Google account's address — nobody else can sign in or sign up.
- Create a Google OAuth client with the redirect URI `<your URL>/api/auth/callback/google`.
- After the first Google sign-in, add a passkey in Settings. Optionally pin `OWNER_USER_ID` (a second lock).

```bash
cp .env.example .env.local   # fill in your own values — never commit this file
npm install
npm run dev
```

## Security

Never commit secrets. `.env*` files are ignored except `.env.example`, which contains placeholders only.
If you find a security issue, please open a private security advisory on GitHub instead of a public issue.

## License

MIT, see [LICENSE](LICENSE).
