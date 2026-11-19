"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";

import { getHqMeta, getHqTaskDetail, type HqMeta, type HqTask, type HqTaskDetail } from "@/app/actions/hq";
import { useUi } from "@/ui/uiStore";

import { dueBucket, formatDue, type DueBucket } from "./buckets";
import { safeColor } from "@/ui/safe-color";

type View = "focus" | "overdue" | "today" | "week" | "all";

type SliceResult = {
  tasks: HqTask[];
  lists: Array<{ id: string; name: string; spaceId: string; folderId: string | null }>;
  folders: Array<{ id: string; name: string }>;
  done: boolean;
};
type LiveTasks = Omit<SliceResult, "done"> & { done: boolean; fetchedAt: string | null };

const SLICE = 3; // pages per request (small slices arrive sooner)
const PARALLEL_SLICES = 6; // requests in flight at once
const MAX_PAGES = 40;
const EMPTY_LIVE: LiveTasks = { tasks: [], lists: [], folders: [], done: true, fetchedAt: null };

function mergeById<T extends { id: string }>(a: T[], b: T[]): T[] {
  const map = new Map(a.map((x) => [x.id, x]));
  for (const x of b) map.set(x.id, x);
  return [...map.values()];
}

function mergeSlice(prev: LiveTasks, slice: SliceResult): LiveTasks {
  return {
    ...prev,
    tasks: mergeById(prev.tasks, slice.tasks).sort(
      (x, y) => (x.dueAt ?? "9999").localeCompare(y.dueAt ?? "9999") || x.name.localeCompare(y.name),
    ),
    lists: mergeById(prev.lists, slice.lists),
    folders: mergeById(prev.folders, slice.folders),
  };
}

const VIEWS: Array<{ id: View; label: string }> = [
  { id: "focus", label: "Focus" },
  { id: "overdue", label: "Overdue" },
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "all", label: "All open" },
];

const PRIORITY: Record<number, { label: string; color: string }> = {
  1: { label: "Urgent", color: "#e8576a" },
  2: { label: "High", color: "#f2a33a" },
  3: { label: "Normal", color: "#6aa3e8" },
  4: { label: "Low", color: "#a9a9a9" },
};

function inView(view: View, bucket: DueBucket) {
  switch (view) {
    case "focus":
      return bucket === "overdue" || bucket === "today";
    case "overdue":
      return bucket === "overdue";
    case "today":
      return bucket === "today";
    case "week":
      return bucket === "today" || bucket === "week";
    default:
      return true;
  }
}

/** The task overview inside ClickUp HQ (a 2D overlay above the world). */
export function ClickUpHqPanel() {
  const open = useUi((s) => s.hqOpen);
  const close = useUi((s) => s.closeHq);
  const [meta, setMeta] = useState<HqMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveTasks>(EMPTY_LIVE);
  const [view, setView] = useState<View>("focus");
  const [spaceFilter, setSpaceFilter] = useState<string | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<HqTask | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const generation = useRef(0);
  const loading = !live.done;

  /** Loads everything live: metadata + task pages in parallel slices (nothing is stored). */
  const load = async () => {
    const gen = ++generation.current;
    const current = () => gen === generation.current;
    setError(null);
    setLive({ ...EMPTY_LIVE, done: false });
    getHqMeta()
      .then((m) => current() && setMeta(m))
      .catch(() => current() && setError("Could not load ClickUp HQ. Please try again."));

    for (let start = 0; start < MAX_PAGES; start += SLICE * PARALLEL_SLICES) {
      const starts = Array.from({ length: PARALLEL_SLICES }, (_, i) => start + i * SLICE).filter((s) => s < MAX_PAGES);
      const results = await Promise.all(
        starts.map((s) =>
          fetch(`/api/hq/tasks?start=${s}&count=${SLICE}`, { cache: "no-store" })
            .then(async (r) => (r.ok ? ((await r.json()) as SliceResult) : r.status === 409 ? { tasks: [], lists: [], folders: [], done: true } : Promise.reject(new Error(String(r.status)))))
            .then((slice) => {
              if (current()) setLive((prev) => mergeSlice(prev, slice));
              return slice;
            }),
        ),
      ).catch(() => null);
      if (!current()) return;
      if (!results) {
        setError("ClickUp didn't answer in time. Please try Refresh.");
        setLive((prev) => ({ ...prev, done: true }));
        return;
      }
      if (results.some((r) => r.done)) break;
    }
    if (current()) setLive((prev) => ({ ...prev, done: true, fetchedAt: new Date().toISOString() }));
  };

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    // Start loading right after this render (not synchronously inside the effect).
    const start = setTimeout(() => void load(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    const loads = generation;
    return () => {
      clearTimeout(start);
      window.removeEventListener("keydown", onKey);
      loads.current++; // abandon a load in flight
    };
  }, [open, close]);

  const connected = useMemo(
    () =>
      meta?.connected
        ? { ...meta, tasks: live.tasks, lists: live.lists, folders: live.folders, fetchedAt: live.fetchedAt, truncated: false }
        : null,
    [meta, live],
  );
  const now = useMemo(() => new Date(), [live.fetchedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const enriched = useMemo(
    () => (connected?.tasks ?? []).map((t) => ({ task: t, bucket: dueBucket(t.dueAt, now) })),
    [connected, now],
  );
  const counts = useMemo(() => {
    const c = { overdue: 0, today: 0, week: 0, total: enriched.length };
    for (const { bucket } of enriched) {
      if (bucket === "overdue") c.overdue++;
      if (bucket === "today") c.today++;
      if (bucket === "today" || bucket === "week") c.week++; // matches the "This week" view
    }
    return c;
  }, [enriched]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter(
      ({ task, bucket }) =>
        inView(view, bucket) &&
        (!spaceFilter || task.spaceId === spaceFilter) &&
        (!mineOnly || task.assignees.some((a) => a.id === connected?.me)) &&
        (!q || task.name.toLowerCase().includes(q) || task.tags.some((t) => t.toLowerCase().includes(q))),
    );
  }, [enriched, view, spaceFilter, mineOnly, query, connected]);

  const groups = useMemo(() => {
    const listName = new Map(connected?.lists.map((l) => [l.id, l]) ?? []);
    const folderName = new Map(connected?.folders.map((f) => [f.id, f.name]) ?? []);
    const spaceName = new Map(connected?.spaces.map((s) => [s.id, s.name]) ?? []);
    const map = new Map<string, { title: string; items: typeof visible }>();
    for (const item of visible) {
      const l = listName.get(item.task.listId);
      const title = [spaceName.get(item.task.spaceId), item.task.folderId ? folderName.get(item.task.folderId) : null, l?.name ?? "List"]
        .filter(Boolean)
        .join(" › ");
      const g = map.get(item.task.listId) ?? { title, items: [] };
      g.items.push(item);
      map.set(item.task.listId, g);
    }
    return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
  }, [visible, connected]);

  if (!open) return null;

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-ink/35 p-3 sm:p-6"
      role="presentation"
      onClick={close}
      // Typing in the panel must not move the player or trigger E-to-talk.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
      onKeyUp={(e) => e.stopPropagation()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="hq-title"
        className="cozy-card flex h-full max-h-[860px] w-full max-w-6xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex flex-wrap items-center gap-3 border-b-2 border-parchment px-5 py-3">
          <h2 id="hq-title" className="text-2xl font-black text-wood-dark">
            ClickUp HQ
          </h2>
          {connected && (
            <span className="text-xs text-ink/60">
              {loading
                ? `loading live from ClickUp… ${live.tasks.length ? `${live.tasks.length} tasks so far` : ""}`
                : `live from ClickUp · ${live.fetchedAt ? new Date(live.fetchedAt).toLocaleTimeString() : ""}`}
            </span>
          )}
          {connected?.ready && (
            <button type="button" onClick={() => void load()} disabled={loading} className="text-xs font-bold text-wood underline disabled:opacity-50">
              Refresh
            </button>
          )}
          <span className="flex-1" />
          <Link href="/settings" className="text-sm font-bold text-wood underline">
            Settings
          </Link>
          <button ref={closeButton} type="button" onClick={close} className="cozy-button bg-parchment px-3 py-1 text-sm">
            Close
          </button>
        </header>

        {!meta && !error && <p className="p-6 text-ink/70">Fetching your tasks live from ClickUp…</p>}
        {error && <p className="p-6 font-bold text-berry">{error}</p>}
        {connected?.error && <p className="px-6 pt-4 font-bold text-berry">{connected.error}</p>}

        {meta && !meta.connected && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-lg font-black">ClickUp isn&apos;t connected yet.</p>
            <p className="max-w-md text-sm text-ink/70">
              Add your personal ClickUp token in Settings and choose the spaces your agents may see.
            </p>
            <Link href="/settings" className="cozy-button bg-leaf px-4 py-2">
              Open settings
            </Link>
          </div>
        )}

        {connected && !connected.ready && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
            <p className="text-lg font-black">Almost there!</p>
            <p className="text-sm text-ink/70">Choose a workspace and the spaces your agents may see in Settings.</p>
            <Link href="/settings" className="cozy-button bg-leaf px-4 py-2">
              Open settings
            </Link>
          </div>
        )}

        {connected?.ready && (
          <div className="flex min-h-0 flex-1">
            <div className="flex min-w-0 flex-1 flex-col">
              {/* summary tiles */}
              <div className="grid grid-cols-2 gap-3 px-5 pt-4 sm:grid-cols-4">
                <Tile label="Overdue" value={counts.overdue} tone="berry" onClick={() => setView("overdue")} />
                <Tile label="Due today" value={counts.today} tone="sun" onClick={() => setView("today")} />
                <Tile label="Due this week" value={counts.week} tone="sky" onClick={() => setView("week")} />
                <Tile label="Open tasks" value={counts.total} tone="leaf" onClick={() => setView("all")} />
              </div>

              {/* filters */}
              <div className="flex flex-wrap items-center gap-2 px-5 py-3">
                <div role="tablist" aria-label="Views" className="flex flex-wrap gap-1">
                  {VIEWS.map((v) => (
                    <button
                      key={v.id}
                      role="tab"
                      aria-selected={view === v.id}
                      type="button"
                      onClick={() => setView(v.id)}
                      className={`rounded-full px-3 py-1 text-sm font-bold ${view === v.id ? "bg-wood text-cream" : "bg-parchment text-ink"}`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                <select
                  aria-label="Space"
                  value={spaceFilter ?? ""}
                  onChange={(e) => setSpaceFilter(e.target.value || null)}
                  className="rounded-full border-2 border-parchment bg-white px-3 py-1 text-sm"
                >
                  <option value="">All spaces</option>
                  {connected.spaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1.5 text-sm font-bold">
                  <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                  Assigned to me
                </label>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search tasks or tags…"
                  aria-label="Search tasks"
                  className="ml-auto min-w-0 flex-1 rounded-full border-2 border-parchment bg-white px-3 py-1 text-sm sm:max-w-xs"
                />
              </div>

              {/* task list */}
              <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
                {groups.length === 0 && (
                  <p className="py-10 text-center text-ink/60">Nothing here — enjoy the calm. 🌿</p>
                )}
                {groups.map((g) => (
                  <div key={g.title} className="mb-4">
                    <h3 className="sticky top-0 bg-cream py-1 text-xs font-black uppercase tracking-wide text-ink/60">
                      {g.title} <span className="text-ink/40">({g.items.length})</span>
                    </h3>
                    <ul className="flex flex-col gap-1">
                      {g.items.map(({ task, bucket }) => (
                        <li key={task.id}>
                          <button
                            type="button"
                            onClick={() => setSelected(task)}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-parchment ${selected?.id === task.id ? "bg-parchment" : ""}`}
                          >
                            <StatusPill status={task.status} color={task.statusColor} />
                            <span className="min-w-0 flex-1 truncate font-semibold">
                              {task.parentId && <span className="text-ink/40">↳ </span>}
                              {task.name}
                            </span>
                            {task.priority && PRIORITY[task.priority] && (
                              <span title={PRIORITY[task.priority].label} aria-label={`${PRIORITY[task.priority].label} priority`} style={{ color: PRIORITY[task.priority].color }}>
                                ⚑
                              </span>
                            )}
                            <span className={`shrink-0 text-xs font-bold ${bucket === "overdue" ? "text-berry" : "text-ink/60"}`}>
                              {formatDue(task.dueAt, now)}
                            </span>
                            <Assignees people={task.assignees} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {connected.truncated && (
                  <p className="text-xs text-ink/50">Showing the first 4,000 open tasks.</p>
                )}
              </div>
            </div>

            {selected && <TaskDetail task={selected} onClose={() => setSelected(null)} />}
          </div>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value, tone, onClick }: { label: string; value: number; tone: "berry" | "sun" | "sky" | "leaf"; onClick: () => void }) {
  const bg = { berry: "bg-berry/15", sun: "bg-[#ffe27a]/40", sky: "bg-sky/50", leaf: "bg-leaf/25" }[tone];
  return (
    <button type="button" onClick={onClick} className={`rounded-2xl ${bg} px-4 py-3 text-left`}>
      <span className="block text-2xl font-black">{value}</span>
      <span className="text-xs font-bold text-ink/70">{label}</span>
    </button>
  );
}

function StatusPill({ status, color }: { status: string; color: string | null }) {
  return (
    <span
      className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-black uppercase text-white"
      style={{ background: safeColor(color, "#999") }}
    >
      {status}
    </span>
  );
}

function Assignees({ people }: { people: HqTask["assignees"] }) {
  if (!people.length) return null;
  return (
    <span className="flex shrink-0 -space-x-1">
      {people.slice(0, 3).map((p) => (
        <span
          key={p.id}
          title={p.username}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border-2 border-cream text-[10px] font-black text-white"
          style={{ background: safeColor(p.color, "#8b5e3c") }}
        >
          {p.initials ?? p.username.slice(0, 2).toUpperCase()}
        </span>
      ))}
    </span>
  );
}

function TaskDetail({ task, onClose }: { task: HqTask; onClose: () => void }) {
  const [detail, setDetail] = useState<HqTaskDetail | null>(null);
  const [loading, startLoading] = useTransition();

  useEffect(() => {
    startLoading(async () => {
      setDetail(null);
      setDetail(await getHqTaskDetail(task.id));
    });
  }, [task.id]);

  return (
    <aside className="flex w-full max-w-md shrink-0 flex-col overflow-y-auto border-l-2 border-parchment p-5" aria-label="Task details">
      <div className="flex items-start gap-2">
        <h3 className="flex-1 text-lg font-black leading-snug">{task.name}</h3>
        <button type="button" onClick={onClose} className="text-sm font-bold text-ink/60" aria-label="Close details">
          ✕
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <StatusPill status={task.status} color={task.statusColor} />
        <span className="font-bold">{formatDue(task.dueAt)}</span>
        {task.tags.map((t) => (
          <span key={t} className="rounded-full bg-parchment px-2 py-0.5 text-xs font-bold">
            #{t}
          </span>
        ))}
      </div>
      {task.assignees.length > 0 && (
        <p className="mt-2 text-sm text-ink/70">Assigned: {task.assignees.map((a) => a.username).join(", ")}</p>
      )}
      {task.url && (
        <a href={task.url} target="_blank" rel="noopener noreferrer" className="mt-3 text-sm font-bold text-wood underline">
          Open in ClickUp ↗
        </a>
      )}

      <h4 className="mt-5 text-xs font-black uppercase tracking-wide text-ink/60">Description</h4>
      {loading && !detail ? (
        <p className="mt-1 text-sm text-ink/60">Loading…</p>
      ) : (
        // Rendered as plain text on purpose: task content is untrusted.
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
          {detail?.description?.trim() || <span className="text-ink/50">No description.</span>}
        </p>
      )}

      <h4 className="mt-5 text-xs font-black uppercase tracking-wide text-ink/60">Latest comments</h4>
      {detail?.commentsError && <p className="mt-1 text-sm text-berry">{detail.commentsError}</p>}
      {detail && !detail.commentsError && detail.comments.length === 0 && <p className="mt-1 text-sm text-ink/50">No comments.</p>}
      <ul className="mt-1 flex flex-col gap-2">
        {detail?.comments.map((c) => (
          <li key={c.id} className="rounded-xl bg-parchment/60 p-2 text-sm">
            <p className="text-xs font-bold text-ink/60">
              {c.author}
              {c.at && ` · ${new Date(c.at).toLocaleString()}`}
            </p>
            <p className="whitespace-pre-wrap break-words">{c.text}</p>
          </li>
        ))}
      </ul>
    </aside>
  );
}
