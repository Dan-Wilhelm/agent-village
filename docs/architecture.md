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
| Login | Clerk, sign-ups disabled, owner allowlist, passkey or 2FA required | Proven auth, no hand-rolled security; plus an owner check in our own code |
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
│ 3D Village (R3F)         │ ───────────────► │ API routes (Clerk-protected)             │
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
                                              │  • ClickUp webhook receiver (HMAC check)  │
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
  - All geometry and characters are generated in code from blocks (instanced meshes), so the art is original and the bundle stays small.
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

### 4.4 Scheduling

- Each scheduled agent has a small scheduler workflow. It computes the next due time, **sleeps until then** (durable `sleep`), starts the agent run, and repeats.
- Changing the schedule in the app cancels and restarts the scheduler.
- A daily Vercel Cron job acts as a watchdog and restarts any scheduler that stopped.
- This avoids depending on the cron limits of the Vercel plan.
- For now agents only act while I'm working: a global "office hours / I'm away" switch pauses all non-urgent visits. Running 24/7 later only means turning that switch off.

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
  - So the app keeps a **local cache** of the spaces I select in the settings.
  - The app connects **exactly one ClickUp account: the owner's own**, via the owner's personal token. No other accounts or users.
  - The cache is updated by **webhooks** plus a periodic catch-up sync. Agents read from the cache.
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

| Table | Content |
|---|---|
| `owner` | The single owner (Clerk user id); used for the server-side owner check |
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

---

## 7. Security

1. **Login**
   - Clerk with **sign-ups disabled** and an **allowlist** containing only your address.
   - **Passkey or 2FA required.**
   - Short sessions.
2. **Defense in depth**
   - Every server route and server action checks *both* that a valid session exists *and* that the user is the owner stored in the database.
   - Middleware alone is not trusted.
3. **No public endpoints except signed ones**
   - The ClickUp webhook is verified by HMAC signature, with replay protection by event id.
   - Workflow and cron endpoints are protected by their own secrets.
4. **Secrets**
   - ClickUp tokens are encrypted with AES-256-GCM before they are stored.
   - The master key lives only in a Vercel *sensitive* environment variable.
   - The Anthropic key is an env var.
   - None of them is ever sent to the browser, logged or committed. `.env*` is in `.gitignore`.
   - A secret scanner runs in CI.
5. **Least privilege**
   - Each agent only gets the tools it is allowed.
   - Write actions need approval unless explicitly allowed.
   - There is no "delete" tool in the MVP.
6. **Prompt injection**
   - All ClickUp content is treated as untrusted data.
   - Agents can't change their own permissions or playbook without your confirmation.
7. **Web hardening**
   - Strict Content-Security-Policy, HSTS and secure cookies.
   - Rate limiting on API routes.
   - Input validation with Zod everywhere.
8. **Audit:** the activity log is append-only.
9. **Review:** a full security review in Phase 6 before calling the MVP finished.

---

## 8. Cost estimate (rough, for one user)

| Item | Estimate |
|---|---|
| Claude API | Simple agents on Haiku 5.5 ($0.10 / $0.50 per million tokens) cost almost nothing. A daily briefing on Opus 5.5 costs ≈ $0.10–0.30 a day. **Total probably $10–30/month**, depending on how much you use the consultant agents. |
| Vercel | Pro plan (already in place). Workflow, functions and bandwidth are billed by usage on top; small for one user. |
| Neon Postgres | Free tier is enough to start. |
| Clerk | Free tier is enough (1 user). |

---

## 9. Repository layout (planned)

```
agent-village/
  app/                 Next.js routes (world, panels, API, webhooks)
  src/world/           3D scene, voxel builder, characters, controls
  src/ui/              2D overlay panels, HUD, wizard
  src/agents/          engine, tools, prompts, agent types (intake checklists)
  src/workflows/       durable agent runs, scheduler, approvals
  src/integrations/    adapter interface + clickup/
  src/db/              Drizzle schema + migrations
  src/security/        owner check, encryption, webhook signatures
  docs/                architecture, setup, security notes
  .env.example         every variable, no real values
  README.md            self-hosting guide
```

---

## 10. Phase plan (from the build prompt)

| Phase | Content |
|---|---|
| 0 | This proposal ← **we are here** |
| 1 | Project setup, login + owner check, world skeleton: office, ClickUp HQ, walking characters, speech bubbles, overlay panel |
| 2 | ClickUp adapter, encrypted token storage, cache + webhook sync, task overview in ClickUp HQ |
| 3 | Agent engine: Workflow runs, introduction, training mode, feedback loop, approvals, activity log, push, voice input |
| 4 | Dispatcher + MVP agents: Daily Team Briefing, Client Review Tracker, Internal Review Reminder, Landing Page / Static Ad Brief / Video task agents, Meeting Prep |
| 5 | Agent creation wizard |
| 6 | Security review, README, self-hosting setup |

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
