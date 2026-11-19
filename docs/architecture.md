# Agent Village — Architecture Proposal (Phase 0)

Status: **confirmed by the owner on 2026-11-12.** Decisions are listed in section 11.
Date: 2026-11-12

In this document "I/me" is the owner, the one person who uses an Agent Village instance.

---

## 1. Decisions at a glance

| Area | Proposal | Why |
|---|---|---|
| App type | Web app, installable as a PWA (Safari "Add to Dock" on macOS) | Runs in the cloud, works on any device, push notifications, easy to self-host |
| Language / framework | TypeScript, Next.js 16 (App Router) | One codebase for the 3D world, the API and the agent engine |
| 3D world | React Three Fiber + drei, Rapier physics for walking/collisions | Mature, React-native way to build a first-person 3D world |
| Agent engine | Anthropic TypeScript SDK (`@anthropic-ai/sdk`), our own agent loop | Agents are database rows created in the app; full control over approvals |
| Durable runs, waiting, schedules | Vercel Workflow (`workflow` package) | Agent runs survive restarts, can pause hours for an approval, can sleep until the next scheduled time |
| Database | Neon Postgres (via Vercel Marketplace) + Drizzle ORM | Serverless Postgres, free tier, standard SQL for self-hosters |
| Login | Better Auth (open source, in our own database): Google OAuth or passkeys only, owner email only | No third-party login provider; full control; plus an owner check in our own code |
| Secrets | AES-256-GCM encryption in Postgres, master key only in a Vercel sensitive env var | Tokens never reach the browser, logs or git |
| Push notifications | Web Push (VAPID) to the installed PWA on the Mac | No extra service needed |
| Voice input | Browser Web Speech API (German and English), push-to-talk | Free, no extra account; only active while I use the mic button |
| Hosting | Vercel | Already set up for you |

**Rejected alternatives**

- **eve (Vercel's agent framework).**
  - It defines agents as files at build time, so agents created in the app would need workarounds.
  - Schedules you can change at runtime are experimental.
  - It is still a release candidate (1.0.0-rc.10).
  - Worth revisiting after 1.0.
- **Anthropic Managed Agents.**
  - It hosts a sandbox container per session, which our agents don't need.
  - It would tie every self-hoster to that platform.
- **Desktop app (Electron/Tauri).**
  - Agents could not run while the laptop is closed.
  - It is harder for others to install.

---

## 2. System overview

```
 Browser / PWA (Mac)                          Vercel (one Next.js project)
┌──────────────────────────┐   HTTPS + auth   ┌───────────────────────────────────────────┐
│ 3D Village (R3F)         │ ───────────────► │ API routes (owner-only sessions)         │
│  • first-person office   │ ◄─── SSE ─────── │  • world state / agent events stream      │
│  • walking agents        │                  │  • approve / reject / feedback / train    │
│  • speech bubbles        │                  │  • agent wizard, settings, tokens         │
│ 2D overlay panels        │                  ├───────────────────────────────────────────┤
│  • task content, lists   │                  │ Agent engine (Vercel Workflow)            │
│  • approvals, training   │                  │  • agent run = durable workflow           │
│ Voice input (Web Speech) │                  │  • each model call / tool call = a step   │
│ Service worker (push)    │ ◄── Web Push ─── │  • approval = hook (pauses for hours)     │
└──────────────────────────┘                  │  • scheduler = sleep until next due time  │
                                              ├───────────────────────────────────────────┤
                                              │ Integrations (adapter pattern)            │
                                              │  • ClickUp adapter + local cache          │
                                              │  • live reads, no stored task data        │
                                              └──────────┬───────────────────┬────────────┘
                                                         │                   │
                                              ┌──────────▼───────┐  ┌────────▼─────────┐
                                              │ Neon Postgres    │  │ Claude API       │
                                              │ agents, memory,  │  │ (your Anthropic  │
                                              │ runs, approvals, │  │  API key)        │
                                              │ cache, audit log │  └──────────────────┘
                                              └──────────────────┘          ▲
                                                         ▲                  │
                                                  ClickUp API (personal token, server-side only)
```

---

## 3. The world (front end)

- **Layout**
  - A small village with my office as the center.
  - **ClickUp HQ** is the central building. Inside is a task overview: spaces, lists, statuses, overdue and due today.
  - Further buildings for later functions: Workshop (task creation), Library (meeting docs), Training Ground.
- **Style**
  - Cozy and cute, voxel-style.
  - All geometry and characters are generated in code from blocks, merged into one mesh per material with hidden faces removed and soft corner shading baked in (`src/world/voxels/mesher.ts`), so the art is original and the bundle stays small.
  - Characters are blocky, low-poly and have individual colors and accessories set in the wizard.
- **First person**
  - Pointer-lock controls (WASD + mouse), with collision through Rapier.
  - A "sit at desk" mode releases the mouse, so working in panels is comfortable.
- **Agents**
  - Agents walk between buildings along a waypoint graph. Their walking shows real work: going to ClickUp HQ while reading, coming to my office when they need me.
  - State is shown as an icon above the head: idle, working, waiting for me, in training, error.
- **Talking**
  - When an agent arrives, a speech bubble appears (drei `Html`).
  - Clicking or pressing E opens a **2D overlay panel**. It shows the full message, task previews, lists, buttons (approve / change / reject), feedback input and the microphone button.
  - Real content lives in the 2D panel, because long text is hard to read inside 3D.
- **Queue**
  - Several agents can wait at once. They stand in line in front of my office.
  - A small HUD list shows who is waiting and why. It also works with the 3D view turned off, as a quick "inbox" mode.
- **Live updates**
  - The browser subscribes to an SSE stream of agent events (moved, speaking, waiting, done) from the server.

---

## 4. Agent engine

### 4.1 Agent definition (stored in the database, created by the wizard)

| Field | Meaning |
|---|---|
| name, look | Display name and character appearance |
| kind | `simple` (template/rule based) or `intelligent` (consultant/sparring partner) |
| role & base instructions | What the agent is for |
| language | `de`, `en` or `both` |
| model, effort | Default: simple → `claude-haiku-5-5`, intelligent → `claude-opus-5-5`; changeable per agent |
| workspace, allowed tools | Which accounts and which actions it may use (least privilege) |
| auto-approved action types | Write actions I allowed it to run without asking |
| description for routing | One or two sentences on what requests this agent handles; used by the Dispatcher (4.5) |
| trigger | `schedule` (days + times, in the owner's time zone), `on_call` (I summon it or the Dispatcher routes to it), or later `event` (ClickUp webhook) |
| settings | Structured answers gathered in the introduction (lists to watch, statuses, criteria, times…) |
| playbook | Learned instructions from training and feedback, versioned, viewable and editable |

### 4.2 One agent run

1. A trigger fires: a schedule, me calling the agent, or later a webhook.
2. A **Workflow run** starts.
3. The prompt is built from three parts:
   - a stable system prompt (role, instructions, current playbook version), so it can be cached;
   - the tools it is allowed to use;
   - the task.
4. The loop runs **at workflow level**:
   - each Claude call is one durable step;
   - each tool call is one durable step.
5. **Read tools** run directly. They read from the local ClickUp cache and fall back to the live API.
6. **Write tools** (create task, update task, post comment) are *not* executed right away, unless that action type is auto-approved for this agent:
   - the engine saves a **pending action**;
   - the agent walks to me and I get a push notification;
   - the run pauses on a Workflow hook, for minutes or days;
   - on approve, the action runs. On reject or change request, my answer goes back to the agent.
7. Every step goes into the **activity log**: input, output, tool calls, approvals, cost.

**Simple agents that need no AI**

- Some simple agents need no reasoning at all. An example is the Internal Review Reminder: "list items in status X, come to me at 09:00/13:00/17:00".
- These run as plain rules with **no Claude call**. A cheap Haiku call is used only if the text should be phrased nicely.
- This keeps cost close to zero.

**Claude API details**

- Adaptive thinking.
- Effort per agent: low for simple agents, medium or high for consultants.
- Streaming for long outputs.
- Prompt caching on the stable system prompt.
- Server-side refusal **fallbacks enabled** for Opus 5.5 (`fallbacks: "default"`). This means a declined request is retried on a fallback model instead of failing. You can switch it off.
- Content read from ClickUp is passed to Claude wrapped as *data*, with instructions never to follow commands found inside it (prompt-injection protection).

### 4.3 Introduction, training and feedback (agent memory)

- **Introduction**
  - A new agent walks to me, introduces itself, and asks the questions it needs.
  - Each agent type has an *intake checklist* (e.g. "Which times of day?", "Which list and which status means 'at client for review'?").
  - Answers are saved as structured **settings**, which I can change later in the agent's profile.
- **Training mode**
  - I can put any agent into training at any time. The character goes to the Training Ground and the panel becomes a chat (voice or text).
  - I explain, show examples or paste templates.
  - At the end the agent summarizes **what it learned as a proposed playbook change**, shown as a diff.
  - I confirm it, and a new playbook version is saved.
- **Feedback loop**
  - Every output (briefing, task draft, list) has a feedback button (voice or text).
  - The agent turns my feedback into a proposed playbook change and asks me to confirm it.
  - Good outputs can be saved as **examples**, which the agent uses as reference next time.
- **Transparency**
  - The agent profile shows the settings, the current playbook, its history (roll back to any version) and saved examples.
  - Everything is editable.

### 4.4 Scheduling and visits (built in Phase 3d)

- Triggers live in each agent's vault profile: `schedule` (days + Berlin wall-clock times), `before_event` (minutes before calendar events matching e.g. "client meetings"), `on_call`.
- **Vercel Cron** calls `/api/cron/visits` every minute (`vercel.json`, Bearer `CRON_SECRET`, constant-time check). The pure logic in `src/agents/schedule.ts` (unit-tested, incl. summer/winter time) finds triggers that became due in the last 10 minutes, so missed runs are tolerated.
- `before_event` reads the Apps Script calendar feed live. "Client meeting" = at least one attendee outside the most common (internal) attendee domain. Such visits are `urgent` and expire 15 minutes after the meeting starts; schedule visits expire after 3 hours.
- Each due trigger becomes one row in `visits` (dedupe key `trigger_key`), holding **only** agent id, generic reason (the agent's role), priority and times — never ClickUp content. Delivered/expired rows are deleted after a day.
- New visits send a **generic Web Push** ("Kai is on the way · Daily Briefing") to the owner's subscribed devices.
- The village polls `/api/visits` every 30 s while visible; due visits send the agent walking to the office. Opening the visit marks it delivered and the agent builds its content live (the trigger line is shown as a note, not stored as the owner's words).
- Still open: a global "office hours / I'm away" switch that pauses non-urgent visits.

### 4.5a Phase 4: the MVP agents (built 2026-11-16)

Each agent has a **starting playbook** in the vault (`Craft.md` = transferable, `Context.md` = ACME specifics, `Test cases.md`, `Changelog.md`). Assumptions are marked *to confirm*; in the introduction the agent asks them as short yes/no questions and turns answers into rules (`propose_playbook_rule` with `replaces` removes the confirmed line on approval). The company note holds the shared ClickUp conventions (pipelines, statuses, key custom fields) — structure only, never task content.

| Agent | Job | Main sources |
|---|---|---|
| Kai — Daily Briefing | Daily Kaizen L1 briefing: today, since yesterday, problems with owner + next step, decisions | tasks changed since last working day, due/overdue, calendar |
| Otto — Client Follow-up | What lies with which client since when; follow-up due after the limit | `external review` + newest comment per task, grouped by Client Code and Format |
| Rita — Internal Review | 3×/day: images/videos waiting for Dan's review | `internal review` in Production pipeline, Drive link, editor |
| Mila — Meeting Prep | One-page brief 10 min before client meetings; saves Dan's notes afterwards | calendar, client tasks (Client Code), meeting notes in the vault, ClickUp docs |
| Tess — Static Ad Briefs | Figma links + briefing → brief task from the image template | task templates, custom fields |
| Vito — Video Tasks | Folder link + brief → video task from the video template | task templates, custom fields |
| Lena — Landing Pages | Sparring partner; builds the LP brief template with Dan | LP lists and fields |

New agent abilities: `search_tasks` filters by custom field (readable values), tags, `updated_after`, closed tasks and can add each task's newest comment; `list_task_templates`; `draft_task` from a template with fields + target status, revisable (one approval card per draft); `find_docs` / `read_doc` (ClickUp docs in allowed spaces only); `find_meeting_notes` / `propose_save_meeting_notes` (Dan's own notes in `Companies/<C>/Meeting notes/`); `resolve_inbox_item` ("decide later" items are brought up on the next visit).

Approving a draft **moves** it from the drafts list into the target list (v3 move: keeps template checklists/subtasks), sets the status and custom fields and verifies that the fields were stored; if the move fails it falls back to a copy and says so.

### 4.5b Phase 5: agent wizard, teams, isolation (built 2026-11-17)

- **Wizard** (Agents → "+ New agent", or "Settings" on an agent): Describe → Job → Character → Abilities → Visits → Check. "✨ Fill in for me" turns a short (spoken) description into a full proposal via Claude (structured output: role, mission, starting playbook, intro questions, least-privilege permissions, schedule). Everything is editable; saving writes the profile, `Craft.md`, `Context.md` (with *to confirm* questions) and `Changelog.md` to the vault. Edit mode changes settings and mission (role, company and team stay — folders are named by role).
- **Comes on its own or only when called** is an explicit question; on its own = schedule and/or before calendar events.
- **"Without asking"** (`auto_approve` per agent; comment, task change, draft, Mission Control DM): such proposals are executed immediately, still fully re-validated (permission, allowed spaces, discretion, company binding) and logged; the card shows "Done without asking". Default: nothing. Copied agents never keep it.
- **Activity log** panel (Agents → Activity): every agent action and settings change, without content.
- **Teams & leads:** new teams in the wizard; an agent of kind *lead* becomes the team's lead and gets `ask_team_member` — it hands concrete requests to members (depth 1), whose proposals appear in the lead's conversation.
- **Copy team** to another (new) company: team note + each agent's profile and **craft**; context, introduction and auto-approve start fresh.
- **Strict company isolation:** a company note's `clickup_team_id` binds it to one ClickUp workspace. Agents of a company without (or with another) binding get no ClickUp access — enforced when loading tools and again when executing approvals.
- **Archive:** moves an agent's folder to `Companies/<C>/Archive/<Role> (<date>)/` (out of the village, kept in the vault and its git history).

### 4.5c Colleague questions and prepared visits (2026-11-19)

- **Colleague questions:** every agent can `ask_colleague` another agent of the *same company* (max 4 per answer, no chains). The colleague answers in a **read-only** turn (no proposals, no writes) only from what it really knows — approved rules, saved meeting notes, open "decide later" notes, live reads within its own permissions — and names the source and age. The asking agent uses facts from ClickUp or saved notes directly (with source); assumptions, old information or anything leading to an action are confirmed with Dan first. A colleague's answer counts as untrusted content (no "without asking" afterwards). Agents only know what was saved — conversations themselves are never stored.
- **Prepared visits:** when a trigger visit reaches the open village, the browser starts the agent's turn immediately (invisible conversation) while the agent walks over; the waiting card shows "preparing…" → "ready ✓" and opening it shows the finished answer without a new request. Nothing is stored server-side; if the village is closed, preparation starts when it is opened.
- **"New since my last visit":** the first turn of a conversation tells scheduled agents when their previous scheduled visit was (computed from the schedule, Berlin time), so they can filter with `updated_after`.

### 4.5 The Dispatcher: one input, the right agent comes running

A central feature: I don't need to know which agent to call.

- **The input**
  - The office desk has an **input box**, also on a hotkey anywhere in the world.
  - I type or speak what I want. I can also paste text (e.g. meeting notes), drop a file (.txt, .md, .pdf, .docx) or paste links (Figma, Google Drive, Frame.io).
- **Routing**
  - The **Dispatcher** reads the input together with the routing descriptions of all agents.
  - It picks the best agent, using one cheap Haiku call with structured output.
- **Hand-off**
  - The chosen agent **comes running to my office** with the input already in hand.
  - It confirms what it understood and asks for anything missing.
- **Unclear cases**
  - If the input is ambiguous, the Dispatcher suggests the 2–3 best agents and I pick one.
  - If no agent fits, it offers to create a new agent with the wizard.
- **Learning:** corrections ("no, this was for the video agent") are saved as routing examples, so routing improves over time.

---

## 5. ClickUp integration

What the ClickUp API research showed (sources in the research notes; checked 2026-11-12):

- **Available**
  - Hierarchy: workspaces → spaces → folders → lists.
  - Tasks with filters for status, assignee, list, space, due/created/updated dates, tags and custom fields.
  - Comments.
  - Create and update tasks, set custom fields.
  - **Create a task from a task template**.
  - Attachments.
  - Docs (v3): read all pages as markdown, create docs and pages.
  - Webhooks for task, list, folder and space events, signed with HMAC-SHA256.
- **Auth**
  - A personal token (`pk_…`) gives the same access you have.
  - It is stored encrypted and only used server-side.
- **Rate limit**
  - 100 requests/minute on Free, Unlimited and Business (more on Business Plus and Enterprise).
  - The app reads live and stays under 90 requests/minute (see 6.1: no local copy).
  - The app connects **exactly one ClickUp account: the owner's own**, via the owner's personal token. No other accounts or users.
- **Not available**
  - **No API for calendar events**, including the Google Calendar events synced into ClickUp.
  - No webhook for Docs.
  - No field in the API that marks a Doc as a meeting note.
  - Recordings/Clips can't be downloaded via the API.

**Consequence for the Meeting Prep agent**

1. **Notes come from me.** Meeting notes come from an external notetaker (e.g. Google Meet). When they are ready, I give them to the Dispatcher by pasting them, dropping a file or saying "notes from the meeting with client X". The Meeting Prep agent comes running and files them under that client.
2. **Before a meeting** I ask for prep. The agent combines the stored notes of earlier meetings with that client with the related ClickUp tasks (found via the task filters).
3. **Recurring meetings:** the agent also uses the documentation of earlier sessions stored in ClickUp Docs, which are readable via the Docs API.
4. **Language:** it answers in German or English, matching the meeting.
5. **Storage:** meeting notes are stored in Postgres and are viewable and deletable in the app. Optionally they can also be saved as a ClickUp Doc, which needs approval.

**Structure is never hard-coded.** The app reads the real hierarchy. In the introduction, the agents ask which spaces, lists and statuses mean what (e.g. "which list holds ad briefs, and which status means 'at the client for review'?").

---

## 6. Data model (Postgres, first version)

The owner is not stored in the database: the owner check uses `OWNER_EMAIL` (verified email) and optionally `OWNER_USER_ID` (the owner's user id) from the environment, which keeps a leaked database from changing who may log in.

| Table | Content |
|---|---|
| `workspaces` | Work environments (one for the MVP, many later) |
| `integration_accounts` | Per workspace: provider (`clickup`), encrypted token, selected spaces |
| `clickup_*` cache | Spaces, folders, lists, statuses, tasks, docs index, with sync timestamps |
| `agents` | Agent definitions (section 4.1) |
| `agent_settings` | Structured intake answers, versioned |
| `agent_playbooks` | Learned instructions, versioned, with author (training / feedback / manual) |
| `agent_examples` | Saved good outputs and templates |
| `runs` | Each agent run: trigger, status, workflow run id, model, token usage, cost |
| `run_messages` | The conversation of a run (append-only) |
| `interactions` | Agent → me queue: kind (briefing, question, approval, reminder), payload, status |
| `pending_actions` | Write actions waiting for approval, with the exact payload to execute |
| `feedback` | My feedback on outputs, and the resulting playbook change |
| `activity_log` | Append-only audit log of everything that happened |
| `push_subscriptions` | Web Push endpoints of my devices |
| `visits` | Trigger visits: agent id, generic reason, priority, due/expiry, status (no content) |

---

### 6.1 ClickUp only: no copy of task data (owner decision, 2026-11-14)

- Task data lives **only in ClickUp**. ClickUp HQ and agents read (and later write) it **live**; nothing is cached or stored.
- Our database (Neon, **Frankfurt / eu-central-1**) keeps only: login (Better Auth), the **encrypted** ClickUp token, which spaces are allowed, and an activity log without task content. Server functions also run in Frankfurt (`vercel.json` → `regions: ["fra1"]`).
- ClickUp HQ: owner-only server actions fetch open tasks of the allowed spaces (parallel pages, ≤ 90 requests/min); list and folder names come from the tasks themselves; task details and comments are fetched on demand. Task content is rendered as plain text, never as HTML.
- The former sync (copy, webhook, 15-minute cron) was removed and its webhook deleted at ClickUp.
- Phase 3d adds `visits` (pointers only, see 4.4) and `push_subscriptions` (device endpoints). The app is installable as a PWA (manifest + a push-only service worker that caches nothing).
- **Agent knowledge** (playbooks, training, feedback, meeting notes) will live in the owner's Obsidian brain vault, in a separate private repo (`brain-agents`, appearing as `30-Areas/Agent Village/`), so it works across future environments, not only ClickUp. The app's token only reaches that repo, never the personal vault.

## 7. Security (reviewed in Phase 6, 2026-11-19)

1. **Login**
   - Better Auth: sign-in only with **Google** (verified email) or a **passkey**; no passwords, no magic links.
   - Three independent locks: Google profile check, no user creation except the owner, no session for anyone but the owner (covers passkeys). Optional `OWNER_USER_ID` pin.
   - Sessions last 7 days (refreshed daily while in use), httpOnly + Secure + SameSite=Lax cookies, login rate limiting in the database.
2. **Defense in depth**
   - Every route handler and server action checks the owner server-side; the proxy is only an optimistic gate.
   - The dev login route only exists with `NODE_ENV=development` and a secret header.
   - API writes must come from the same site (Fetch Metadata / Origin check in the proxy; Next.js checks server actions itself).
3. **Endpoints**
   - Cron: `Bearer CRON_SECRET`, constant-time compare, fails closed.
   - Push subscriptions only for the real browser push services (no requests to arbitrary URLs).
4. **Secrets**
   - ClickUp tokens: AES-256-GCM (random IV, 16-byte tag enforced, row-bound AAD). Master key only in a Vercel *sensitive* env var.
   - No secret is sent to the browser, logged, put into push texts or committed. GitHub secret scanning with push protection is on.
5. **Least privilege & isolation**
   - Each agent only gets the tools of its permissions; write actions are proposals unless an action type is explicitly allowed "without asking".
   - A company's agents only get the ClickUp workspace bound to that company (`clickup_team_id`), enforced for tools and approvals.
   - Search results are re-filtered by allowed space; approvals re-validate permission, space, company binding and the discretion filter.
   - "Reject" only deletes a task that is still in the drafts list.
6. **Prompt injection**
   - All ClickUp, calendar, doc and Mission Control content is treated as data.
   - **"Without asking" is suspended** as soon as a conversation contains content written by others (tasks, comments, calendar, docs, replies) and never applies to delegated requests — such actions become normal approval cards.
   - Agents can't change their own permissions; playbook rules need approval, and a rule can only replace a *to confirm* line (shown on the card).
   - Per-turn system notes are HMAC-signed by the server; the browser cannot add system-level instructions.
   - Team-lead delegation is limited to depth 1 and 6 requests per answer.
7. **Web hardening**
   - Content-Security-Policy: same-origin for scripts, styles, images, fonts and connections; no frames, no plugins, `frame-ancestors 'none'`. Inline scripts stay allowed because Cache Components (partial prerendering) can't use nonces; XSS defence relies on React escaping (no raw HTML is rendered) and validated colours/links.
   - HSTS, nosniff, `X-Frame-Options: DENY`, strict Referrer-Policy, Permissions-Policy (microphone only for this site).
   - App-level rate limits (database, fixed window) on agent turns, approvals, dispatcher, wizard, push test and read-heavy routes.
   - Vercel Firewall with Bot Protection (staged: log first, then challenge); automatic DDoS mitigation.
   - Zod validation on every input; request size limits on the agent route.
8. **Audit:** append-only activity log, visible in the village (Agents → Activity).
9. **Dependencies:** Dependabot alerts + security updates; `npm audit --omit=dev` clean at review time.

---

## 8. Cost estimate (rough, for one user)

| Item | Estimate |
|---|---|
| Claude API | Simple agents on Haiku 5.5 ($0.10 / $0.50 per million tokens) cost almost nothing. A daily briefing on Opus 5.5 costs ≈ $0.10–0.30 a day. **Total probably $10–30/month**, depending on how much you use the consultant agents. |
| Vercel | Pro plan (already in place). Workflow, functions and bandwidth are billed by usage on top; small for one user. |
| Neon Postgres | Free tier is enough to start. |
| Login | Free (Better Auth is open source; Google OAuth is free). |

---

## 9. Repository layout (planned)

```
agent-village/
  app/                 Next.js routes (world, panels, API, auth)
  src/world/           3D scene, voxel builder, characters, controls
  src/ui/              2D overlay panels, HUD, wizard
  src/agents/          engine, tools, prompts, agent types (intake checklists)
  src/workflows/       durable agent runs, scheduler, approvals
  src/integrations/    adapter interface + clickup/
  src/db/              Drizzle schema + migrations
  src/lib/             owner check, auth, encryption, activity log
  docs/                architecture, setup, security notes
  .env.example         every variable, no real values
  README.md            self-hosting guide
```

---

## 10. Phase plan (from the build prompt)

| Phase | Content |
|---|---|
| 0 | This proposal (done) |
| 1 | Project setup, login + owner check, world skeleton: office, ClickUp HQ, walking characters, speech bubbles, overlay panel |
| 2 | ClickUp adapter, encrypted token storage, cache + webhook sync, task overview in ClickUp HQ |
| 3 | Agent engine: Workflow runs, introduction, training mode, feedback loop, approvals, activity log, push, voice input |
| 4 | Dispatcher + MVP agents: Daily Team Briefing, Client Review Tracker, Internal Review Reminder, Landing Page / Static Ad Brief / Video task agents, Meeting Prep ← **done 2026-11-16** (see 4.5a) |
| 5 | Agent creation wizard ← **done 2026-11-17** (see 4.5b) |
| 6 | Security review, README, self-hosting setup ← **done 2026-11-19** |

---

## 11. Decisions (confirmed by the owner, 2026-11-12)

1. **Stack:** confirmed as in section 1.
2. **Vercel:** Pro plan (needed for work use; no cron/Workflow limits of Hobby).
3. **ClickUp:**
   - Only the owner's own account is connected, via a personal token.
   - The plan is unknown, so the app is built for the lowest rate limit (100 requests/min).
4. **Meetings:**
   - Notes come from an external notetaker and are handed in by the owner via the Dispatcher (sections 4.5 and 5).
   - There is no calendar integration.
5. **Data policy:** the owner accepts sending ClickUp content to the Claude API.
6. **Voice:** only the owner's own voice is processed, so browser speech recognition is acceptable.
   - It is only active while the microphone button is held or toggled on. There is no always-on listening.
7. **Repo:** a public GitHub repo is created now.
8. **Name:** "Agent Village".
