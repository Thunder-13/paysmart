"use client";
import { useState, type FormEvent } from "react";
import { startRun, useRun } from "@/components/run-client";
import { money } from "@/core/money";
import { currentPosition, isoFromNow } from "./image-tools";

const field = "field mt-1.5 block w-full px-4 py-2.5 text-base font-normal text-ink placeholder:text-ink-faint disabled:opacity-55";
const label = "block min-w-0 text-sm font-semibold text-ink";
const HOURS = [2, 6, 24, 48, 72];

/** Post a bounty: plain words in, a rubric and a pool slip out. */
export function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reward, setReward] = useState("40.00");
  const [hours, setHours] = useState(48);
  const [organizer, setOrganizer] = useState("");
  const [site, setSite] = useState<{ lat: number; lng: number } | null>(null);
  const [radius, setRadius] = useState(150);
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { run } = useRun(runId);

  async function pin() {
    setError(null);
    try {
      setSite(await currentPosition());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const started = await startRun("bounty", {
        kind: "bounty",
        title: title.trim(),
        description: description.trim(),
        reward: money(reward),
        deadline: isoFromNow(hours * 3_600_000),
        location: site ? { ...site, radiusM: radius } : null,
        organizer: { name: organizer.trim(), email: null },
      });
      setRunId(started.id);
      setTitle("");
      setDescription("");
      setTimeout(onCreated, 400);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4 rounded-card border border-line bg-card p-5 sm:p-6" aria-labelledby="create-bounty-heading">
      <h2 id="create-bounty-heading" className="font-display text-xl font-extrabold tracking-tight text-ink">
        Post a bounty
      </h2>
      <label className={label}>
        What needs doing
        <input required minLength={3} maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Clear the storm drain on Elm St" className={field} />
      </label>
      <label className={label}>
        Details (the AI drafts the photo rubric from this)
        <textarea
          required
          minLength={10}
          maxLength={1000}
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Leaves are piled on the grate in front of 41 Elm St and the street floods when it rains."
          className={field}
        />
      </label>
      {/* Two columns at most: the form sits in a 22rem sidebar on wide screens, and three columns cut off the deadline. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <label className={label}>
          Reward (USD, 1 to 500)
          <input required inputMode="decimal" value={reward} onChange={(e) => setReward(e.target.value)} className={`${field} tabular-nums`} />
        </label>
        <label className={label}>
          Deadline
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={`${field} h-[2.875rem] pl-3 pr-7`}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                in {h} hours
              </option>
            ))}
          </select>
        </label>
        <label className={`${label} sm:col-span-2`}>
          Your name
          <input required value={organizer} onChange={(e) => setOrganizer(e.target.value)} className={field} autoComplete="name" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {site ? (
          <>
            <span className="text-ink-soft">
              Job site pinned ({site.lat.toFixed(4)}, {site.lng.toFixed(4)}), radius
            </span>
            <label className="sr-only" htmlFor="bounty-radius">
              Radius in meters
            </label>
            <input id="bounty-radius" type="number" min={25} max={2000} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="field w-24 px-3 py-2 text-base tabular-nums" />
            <span className="text-ink-soft">m</span>
            <button type="button" onClick={() => setSite(null)} className="font-semibold text-pp-blue underline decoration-line underline-offset-4 transition-colors duration-[120ms] hover:decoration-pp-blue active:text-pp-deep">
              Remove
            </button>
          </>
        ) : (
          <button type="button" onClick={() => void pin()} className="inline-flex min-h-11 items-center justify-center rounded-pill border border-edge whitespace-nowrap px-5 py-2 text-center text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep">
            Pin the job site to my location (optional)
          </button>
        )}
      </div>
      <button type="submit" disabled={busy} className="inline-flex h-11 w-full items-center justify-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55">
        {busy ? "Posting…" : "Post bounty"}
      </button>
      <div aria-live="polite">
        {run?.status === "failed" ? <p className="text-sm text-stamp-red">{run.error}</p> : null}
        {run?.status === "running" ? <p className="text-sm text-ink-soft">Drafting the rubric and writing the pool slip…</p> : null}
        {error ? <p className="text-sm text-stamp-red">{error}</p> : null}
      </div>
    </form>
  );
}

export default CreateForm;
