import { createHash } from "node:crypto";
import { canonicalJson, GENESIS, normalizeJson } from "./canonical-json";

export { canonicalJson, GENESIS, normalizeJson };

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function ledgerHash(
  prevHash: string,
  event: { seq: number; slipId: string; type: string; actor: string; at: string; data: unknown },
): string {
  return sha256Hex(
    prevHash +
      canonicalJson({
        seq: event.seq,
        slipId: event.slipId,
        type: event.type,
        actor: event.actor,
        at: event.at,
        data: event.data,
      }),
  );
}
