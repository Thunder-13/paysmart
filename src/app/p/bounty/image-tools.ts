/**
 * Browser-only photo helpers: downscale to a 1280 px JPEG for upload and compute the dHash from the
 * same bitmap on a 9x8 canvas. No server imports.
 */
import { DHASH_HEIGHT, DHASH_WIDTH, dHashFromGray, grayFromRgba } from "@/pipelines/bounty/dhash";

export interface PreparedImage {
  contentType: "image/jpeg";
  base64: string;
  dHash: string;
}

export async function prepareImage(file: Blob, maxSide = 1280): Promise<PreparedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser can't draw images, so the photo can't be prepared.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);

    const tiny = document.createElement("canvas");
    tiny.width = DHASH_WIDTH;
    tiny.height = DHASH_HEIGHT;
    const tctx = tiny.getContext("2d", { willReadFrequently: true });
    if (!tctx) throw new Error("This browser can't read image pixels.");
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(bitmap, 0, 0, DHASH_WIDTH, DHASH_HEIGHT);
    const dHash = dHashFromGray(grayFromRgba(tctx.getImageData(0, 0, DHASH_WIDTH, DHASH_HEIGHT).data));

    return { contentType: "image/jpeg", base64: dataUrl.slice(dataUrl.indexOf(",") + 1), dHash };
  } finally {
    bitmap.close();
  }
}

/** Capture time of a photo file: lastModified for camera shots, falling back to now. Call from handlers only. */
export function captureTime(file: { lastModified?: number }): string {
  return new Date(file.lastModified || Date.now()).toISOString();
}

/** ISO time offsetMs from now. Call from handlers only. */
export function isoFromNow(offsetMs: number): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

export async function uploadBlob(input: { contentType: string; base64: string }): Promise<string> {
  const res = await fetch("/api/blobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await res.json()) as { ref?: string; error?: string };
  if (!res.ok || !body.ref) throw new Error(body.error ?? `Upload failed (${res.status})`);
  return body.ref;
}

export function currentPosition(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This browser has no location access."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (e) => reject(new Error(e.message || "Location was not shared.")),
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}
