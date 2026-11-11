"use client";

import { useState, type ReactNode } from "react";

/**
 * Wraps the server-rendered board and its caption row. Bumping the key remounts the board and the caption,
 * so the CSS sequence plays again. The Replay action is visible from frame one. JS writes no styles.
 */
export function HeroReplay({ children, caption }: { children: ReactNode; caption?: ReactNode }) {
  const [run, setRun] = useState(0);
  return (
    <div>
      <div key={run}>{children}</div>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1">
        <p key={run} className="replay-caption min-w-0 py-3 text-sm text-on-night-soft">
          {caption}
        </p>
        <button type="button" onClick={() => setRun((n) => n + 1)} className="replay-action">
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 10a6 6 0 1 0 2-4.5M4 3.5v3h3" />
          </svg>
          Replay
        </button>
      </div>
    </div>
  );
}
