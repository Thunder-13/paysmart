"use client";
/** Mic button for the ask box. Hidden where the browser has no speech recognition. Audio stays in the browser. */
import { useState } from "react";
import { listenOnce, useSpeechSupport } from "../shop/voice-controls";

export function DictateButtonHidden({ onText }: { onText: (text: string) => void }) {
  const support = useSpeechSupport();
  const [state, setState] = useState<{ listening: boolean; note: string | null }>({ listening: false, note: null });
  if (!support.recognition) return null;
  async function go() {
    setState({ listening: true, note: "Listening…" });
    try {
      const text = (await listenOnce()).trim();
      if (text) onText(text);
      setState({ listening: false, note: text ? `Heard: "${text}"` : "Didn't catch that. Try again or type." });
    } catch (e) {
      setState({ listening: false, note: e instanceof Error ? e.message : String(e) });
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-2">
      <button
        type="button"
        onClick={() => void go()}
        disabled={state.listening}
        aria-pressed={state.listening}
        className="inline-flex h-11 items-center gap-2 rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55 aria-[pressed=true]:border-pp-blue aria-[pressed=true]:bg-pp-sky-wash"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
          <rect x="7" y="2.5" width="6" height="10" rx="3" />
          <path d="M4 9.5a6 6 0 0 0 12 0M10 15.5v2.5" strokeLinecap="round" />
        </svg>
        {state.listening ? "Listening" : "Say your ask"}
      </button>
      <span role="status" aria-live="polite" className="text-xs text-ink-soft">
        {state.note}
      </span>
    </span>
  );
}
