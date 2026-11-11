/** Logic behind the shop-owned API routes, kept free of Next so it can be tested. */
import type { Runtime, Slip } from "@/core/contracts";

const PHOTO_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Helper slips carved from a shop slip, oldest first. */
export function listChildren(rt: Pick<Runtime, "store">, slipId: string): Slip[] {
  const parent = rt.store.slips.get(slipId);
  if (!parent || parent.pipeline !== "shop") return [];
  return rt.store.slips.list({ parentId: slipId }).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Image bytes for a stored blob; null for missing blobs and anything that isn't an image. */
export function readPhoto(rt: Pick<Runtime, "store">, ref: string): { contentType: string; bytes: Uint8Array } | null {
  if (!ref) return null;
  const blob = rt.store.blobs.get(ref);
  if (!blob || !PHOTO_TYPES.includes(blob.contentType)) return null;
  return { contentType: blob.contentType, bytes: new Uint8Array(Buffer.from(blob.base64, "base64")) };
}
