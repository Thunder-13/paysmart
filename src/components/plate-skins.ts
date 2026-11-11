import type { PipelineId } from "@/core/contracts";

/** One skin per pipeline, shared by the home plate, the pipeline header and the ideas table, so the morph keeps its colour. */
export interface PlateSkin {
  /** Background, text and the focus colour override that keeps the ring at 3:1 on this plate. */
  skin: string;
  /** Secondary text on the plate. */
  soft: string;
  /** The "Open the demo run" pill on the home plate. */
  cue: string;
  /** API chips in the header, at least 4.5:1 text contrast. */
  chip: string;
  /** The ruled caption's top rule in the header. */
  rule: string;
}

export const PLATE_SKINS: Record<PipelineId, PlateSkin> = {
  shop: {
    skin: "bg-pp-blue text-on-plate [--color-focus:var(--color-on-plate)]",
    soft: "text-on-plate",
    cue: "bg-on-plate text-pp-blue-deep group-hover:bg-pp-sky group-hover:text-night",
    chip: "bg-pp-deep text-on-plate",
    rule: "border-plate-rule",
  },
  "second-look": {
    skin: "bg-pp-sky text-night [--color-focus:var(--color-night)]",
    soft: "text-night",
    cue: "bg-night text-on-night group-hover:bg-pp-deep",
    chip: "bg-night text-on-night",
    rule: "border-night",
  },
  bounty: {
    skin: "border border-line bg-card text-ink",
    soft: "text-ink-soft",
    cue: "bg-ink text-on-night group-hover:bg-pp-deep",
    chip: "bg-paper-deep text-ink",
    rule: "border-ink",
  },
  "cash-weather": {
    skin: "bg-pp-gold-wash text-night",
    soft: "text-ink-soft",
    cue: "bg-night text-on-night group-hover:bg-pp-deep",
    chip: "bg-night text-on-night",
    rule: "border-night",
  },
  "toll-road": {
    skin: "bg-pp-deep text-on-plate [--color-focus:var(--color-pp-sky)]",
    soft: "text-on-plate-soft",
    cue: "bg-on-plate text-pp-deep group-hover:bg-pp-sky group-hover:text-night",
    chip: "bg-pp-blue text-on-plate",
    rule: "border-plate-rule",
  },
  "dispute-desk": {
    skin: "bg-night text-on-night [--color-focus:var(--color-pp-sky)]",
    soft: "text-on-night-soft",
    cue: "bg-on-night text-night group-hover:bg-pp-sky",
    chip: "bg-night-3 text-on-night",
    rule: "border-night-line",
  },
  // Night ink on sky wash (about 15:1), soft text ink-soft (about 8:1), focus ring night (about 15:1). Reads as the lighter front door beside the blue Shop plate.
  paysmart: {
    skin: "bg-pp-sky-wash text-night [--color-focus:var(--color-night)]",
    soft: "text-ink-soft",
    cue: "bg-night text-on-night group-hover:bg-pp-deep",
    chip: "bg-night text-on-night",
    rule: "border-night",
  },
};
