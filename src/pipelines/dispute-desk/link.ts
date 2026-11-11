/**
 * Link a dispute to the slip behind it.
 *   1. store.slips.findByRailId(transactionId)                      -> method "capture"
 *   2. second-look handoff keyed by capture id (or matched on orderId) -> method "handoff"
 *   3. nothing                                                        -> method "none"
 */
import { z } from "zod";
import type { Store } from "@/core/contracts";
import type { DisputeLink, HandoffContext } from "./types";

const HandoffRecordSchema = z.object({
  captureId: z.string().nullish(),
  orderId: z.string().nullish(),
  slipId: z.string().nullish(),
  trackingNumber: z.string().nullish(),
  carrier: z.string().nullish(),
  riskScore: z.number().nullish(),
  tactics: z.array(z.unknown()).nullish(),
  status: z.string().nullish(),
});

function tacticLabel(t: unknown): string | null {
  if (typeof t === "string") return t;
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    for (const k of ["label", "name", "id", "tactic"]) if (typeof o[k] === "string") return o[k] as string;
  }
  return null;
}

/** The second-look handoff for a capture id (record id = captureId), else one whose orderId matches. */
export function findHandoff(store: Store, transactionId: string): { handoff: HandoffContext | null; warning: string | null } {
  const col = store.collection<unknown>("second-look", "handoffs");
  let raw: unknown = col.get(transactionId);
  if (!raw) {
    raw =
      col.list().find((r) => {
        if (!r || typeof r !== "object") return false;
        const o = r as Record<string, unknown>;
        return o.orderId === transactionId || o.captureId === transactionId;
      }) ?? null;
  }
  if (!raw) return { handoff: null, warning: null };
  const parsed = HandoffRecordSchema.safeParse(raw);
  if (!parsed.success) {
    return { handoff: null, warning: `A second-look handoff for ${transactionId} couldn't be read, so it was ignored.` };
  }
  const h = parsed.data;
  return {
    handoff: {
      captureId: h.captureId ?? transactionId,
      orderId: h.orderId ?? null,
      slipId: h.slipId ?? null,
      trackingNumber: h.trackingNumber ?? null,
      carrier: h.carrier ?? null,
      riskScore: h.riskScore ?? null,
      tactics: (h.tactics ?? []).map(tacticLabel).filter((t): t is string => t !== null),
      status: h.status ?? null,
    },
    warning: null,
  };
}

export function linkDispute(
  store: Store,
  transactionId: string | null,
): { link: DisputeLink; handoff: HandoffContext | null; warnings: string[] } {
  if (!transactionId) return { link: { method: "none", slipId: null }, handoff: null, warnings: [] };
  const warnings: string[] = [];
  const { handoff, warning } = findHandoff(store, transactionId);
  if (warning) warnings.push(warning);

  const slip = store.slips.findByRailId(transactionId);
  if (slip) return { link: { method: "capture", slipId: slip.id }, handoff, warnings };

  if (handoff?.slipId) {
    if (store.slips.get(handoff.slipId)) {
      return { link: { method: "handoff", slipId: handoff.slipId }, handoff, warnings };
    }
    warnings.push(`The second-look handoff names slip ${handoff.slipId}, which doesn't exist.`);
  }
  return { link: { method: "none", slipId: null }, handoff, warnings };
}
