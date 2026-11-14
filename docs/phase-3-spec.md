# Phase 3 — Agent engine: decisions and spec

Status: agreed with the owner on 2026-11-14. This document is the source of truth for Phase 3.

## 1. Data rules (non-negotiable)

1. **ClickUp content** (titles, descriptions, comments, dates, names, attachments) is **never persisted** outside ClickUp.
   Agents **read everything live** in the allowed spaces (due dates, statuses, assignees, descriptions, comments) at the moment they work.
2. Allowed outside ClickUp:
   - **settings** (in the vault or our EU database),
   - **IDs as pointers** (e.g. a queue item "agent X waits with tasks 86c…") — deleted when handled,
   - **lessons** in the vault: rules derived from the owner's feedback, written in general form, linking to ClickUp tasks instead of copying their text.
   - The owner's **own meeting notes** (not ClickUp data) may live in the vault.
3. What an agent needs to remember about a task is written **into ClickUp** (e.g. a comment "Follow-up sent to client on 14.11."). ClickUp is the agents' memory for task matters.
4. Content passes **transiently** through the Claude API to think. No logs, run histories, push texts or caches contain content. Push notifications are generic ("Kai has your daily plan").
5. Calendar events are read **live** from the owner's calendar feed (Apps Script web app, `docs/integrations/google-calendar-feed.gs`); never stored.

## 2. Discretion in work environments

- In a company's environment (e.g. ClickUp of SQVM), **"Agent Village" is never mentioned** — not in comments, DMs, task texts, list names.
- Everything is written **as the owner** (owner's ClickUp account): no signatures, no "via …", no "agent".
- Drafts of new tasks go to a private list in the owner's personal space named **"Drafts – pending approval"**; it is the **only** place agents may write without asking. Approve → task moves to the target list; reject → draft is deleted.
- Changes to existing tasks are proposals (IDs + intended change only) that require approval.

## 3. Companies, teams, agents

```
Company (environment + its own access + its own data; e.g. SQVM = ClickUp)
 └─ Team (e.g. Continuous Improvement, Creative Strategy, Experiments)
     ├─ Team lead — intelligent orchestrator that delegates to members
     └─ Members — specialised agents
```

- Strict **isolation between companies**: an agent only ever gets the access keys and permissions of its own company.
- **Teams can be copied** to another company (e.g. Medawi): each agent's knowledge is split into
  - **Craft** (transferable skills and rules) and
  - **Company context** (company-specific facts, processes, people).
  A copied team takes craft + structure, introduces itself in the new company and learns the context fresh.
- Phase 3 builds the engine incl. team/lead support; the first company is **SQVM** with the agents agreed in the build prompt. Further teams come later.

## 4. Vault structure (agent knowledge; repo `brain-agents`, appears as `30-Areas/Agent Village/`)

```
Agent Village.md
Shared/                          ← about the owner (role, tone, priorities, language)
Companies/<Company>/
  <Company>.md                   ← company profile: environment, conventions, discretion rules
  Teams/<Team>/<Team>.md         ← team mission, lead, members
  Agents/<Role>/                 ← folder named by ROLE (rename-safe); display name is a setting
    <Role>.md                    ← profile: frontmatter settings + mission
    Craft.md                     ← transferable playbook (copied with the team)
    Context.md                   ← company-specific playbook
    Feedback/                    ← one note per feedback event (lesson + link, no copied task text)
    Training/                    ← summaries of training sessions
    Examples/                    ← good / bad examples as lessons with links
    Test cases.md                ← learned rules as checks, verified before playbook changes
    Changelog.md                 ← what was learned when and why
  Inbox/                         ← "decide later" feedback awaiting a decision
```

Folders are created only when there is content (vault rule: structure grows from use).

**Learning loop:** feedback (voice/text) → raw note in `Feedback/` → agent proposes a rule change (diff) → owner approves → `Craft.md`/`Context.md` updated + test case added → weekly consolidation proposal (merge duplicates, keep it sharp). Simple agents only get profile + a short playbook.

## 5. Visits, priority, conversations

- Each agent has **trigger rules** (schedule, before a calendar event, on call) and a **priority** (urgent / high / normal / low); a visit can raise it (e.g. meeting in 10 minutes → urgent).
- Queue order: priority, then arrival. Urgent visits show a notice but **never interrupt** an open conversation.
- Plans and briefings are **built live when opened** (always current, nothing stored).
- **Conversations stay open** until the owner closes them; several can be open in parallel (e.g. ask another agent while the meeting brief stays open). Open conversations live only in the browser.
- Refining an output ends with a choice: **Learn from this** (rule + test case) · **Decide later** (vault `Inbox/`) · **Not feedback**.

## 6. Overview and dispatcher

- **Roster** of all agents per company/team with status (working, waiting for you, idle, training, error), next visit, actions (call, train, rename, settings).
- **"I want to …" input** (text or voice, hotkey) → the right agent comes with the task; ambiguous → 2–3 suggestions.
- Agents can be **renamed** in the village or in Obsidian.

## 7. Mission Control (SQVM)

- Agents may DM ClickUp member "Mission Control" from the owner's account — automatically when their playbook says so (performance data, preview links …) or when the owner asks. They read its reply in the DM.
- Connectivity test pending (owner runs it after the calendar feed is set up).

## 8. Technical approach

- **Claude API** (`@anthropic-ai/sdk`, key `ANTHROPIC_API_KEY`), model per agent: simple agents `claude-haiku-5-5`, consulting agents `claude-opus-5-5`; server-side refusal fallbacks on.
- **Stateless conversation turns**: the browser holds the open conversation and sends it with each turn to an owner-only streaming route; nothing is persisted server-side.
- **Write tools never execute directly**: they return a proposal; the owner approves in the UI; an owner-only route executes it (except drafts into the drafts list).
- **Vault access** via GitHub API with `GITHUB_VAULT_TOKEN` (fine-grained, `brain-agents` only).
- **Scheduler**: Vercel Cron (protected by `CRON_SECRET`) checks due visits and creates queue items (IDs only) + generic push notifications.
- **PWA + Web Push**: installable as a desktop app; Mac notifications.
- **Voice**: browser speech recognition, push-to-talk only.
