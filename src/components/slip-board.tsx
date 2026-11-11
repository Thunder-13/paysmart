"use client";

/**
 * The clearance board for one slip, live from its ledger: the signature piece carried onto every run screen.
 * Renders nothing until the guard has made a call on the slip, so a screen never shows an empty board.
 */
import type { ReactNode } from "react";
import { boardStrips } from "./board-strips";
import { ClearanceBoard } from "./clearance-board";
import { useSlipEvents } from "./run-client";

export interface SlipBoardProps {
  slipId: string | null;
  /** Most strips to rack, oldest first. */
  limit?: number;
  caption?: ReactNode;
  className?: string;
}

export function SlipBoard({ slipId, limit = 6, caption = "The guard’s calls on this slip, live from its ledger.", className = "" }: SlipBoardProps) {
  const { events } = useSlipEvents(slipId);
  const strips = boardStrips(events, limit);
  if (!slipId || strips.length === 0) return null;
  return (
    <div className={className}>
      <ClearanceBoard variant="band" strips={strips} caption={caption} />
    </div>
  );
}

export default SlipBoard;
