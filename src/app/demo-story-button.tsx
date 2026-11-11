"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type Result = { status?: "loaded" | "already_loaded"; ok?: boolean; message?: string; error?: string };

const BUTTON = {
  paper:
    "bg-ink text-on-night hover:bg-pp-deep active:bg-night-3 focus-visible:outline-pp-blue",
  night:
    "bg-on-night text-night hover:bg-pp-sky active:bg-pp-sky-wash focus-visible:outline-pp-sky",
} as const;

const NOTE = {
  paper: { ok: "text-stamp-green", warn: "text-stamp-amber", error: "text-stamp-red", idle: "text-ink-soft" },
  night: { ok: "text-pp-sky", warn: "text-pp-gold", error: "text-on-night", idle: "text-on-night-soft" },
} as const;

/** Mock mode only (the home page decides). POSTs /api/demo/seed, which is safe to call twice. */
export function DemoStoryButton({ loaded, tone = "paper" }: { loaded: boolean; tone?: "paper" | "night" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  async function load() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/demo/seed", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as Result;
      if (!res.ok) setNote({ tone: "error", text: body.error ?? body.message ?? `The demo seed answered ${res.status}.` });
      else setNote({ tone: body.ok ? "ok" : "warn", text: body.message ?? "Done." });
      router.refresh();
    } catch (e) {
      setNote({ tone: "error", text: e instanceof Error ? e.message : "The demo seed could not be reached." });
    } finally {
      setBusy(false);
    }
  }

  const notes = NOTE[tone];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
      <button
        type="button"
        onClick={load}
        disabled={busy}
        aria-describedby="demo-story-note"
        className={`inline-flex h-12 items-center whitespace-nowrap rounded-pill px-7 text-base font-semibold transition-colors duration-[120ms] focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-70 ${BUTTON[tone]}`}
      >
        {busy ? "Running seven pipelines…" : "Load the demo story"}
      </button>
      <p id="demo-story-note" aria-live="polite" className="max-w-[44ch] text-sm">
        {note ? (
          <span className={notes[note.tone]}>{note.text}</span>
        ) : (
          <span className={notes.idle}>
            {loaded ? "Already loaded. Clicking again adds nothing." : "Runs all seven pipelines end to end on the mock PayPal rail. Takes a few seconds."}
          </span>
        )}
      </p>
    </div>
  );
}

export default DemoStoryButton;
