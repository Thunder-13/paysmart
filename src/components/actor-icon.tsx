import type { Actor } from "@/core/contracts";
import { ACTOR_WORDS } from "./event-text";

const PATHS: Record<Actor, string> = {
  user: "M10 10a3 3 0 100-6 3 3 0 000 6zm-5 6c0-2.8 2.2-4.5 5-4.5s5 1.7 5 4.5",
  agent: "M5 7h10v8H5zM8 7V4m4 3V4M8 11h.01M12 11h.01",
  guard: "M10 3l6 2.5v4.5c0 3.5-2.6 6-6 7-3.4-1-6-3.5-6-7V5.5z",
  rail: "M3 7h14M3 13h14M6 4v12m8-12v12",
  webhook: "M10 4a3 3 0 012.6 4.5L15 12a3 3 0 11-1.7 1M7.4 8.5L5 12a3 3 0 103 3h4",
  system: "M10 7a3 3 0 100 6 3 3 0 000-6zm0-4v2m0 10v2m7-7h-2M5 10H3",
};

const TONE: Record<Actor, string> = {
  user: "bg-paper-deep text-ink",
  agent: "bg-pp-gold-wash text-stamp-amber",
  guard: "bg-pp-sky-wash text-pp-deep",
  rail: "bg-pp-blue text-on-plate",
  webhook: "bg-pp-deep text-on-plate",
  system: "bg-paper-deep text-ink-soft",
};

export function ActorIcon({ actor }: { actor: Actor }) {
  return (
    <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${TONE[actor] ?? TONE.system}`} title={ACTOR_WORDS[actor]}>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d={PATHS[actor] ?? PATHS.system} />
      </svg>
      <span className="sr-only">{ACTOR_WORDS[actor]}</span>
    </span>
  );
}

export default ActorIcon;
