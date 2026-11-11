import { describe, expect, it } from "vitest";
import { listChildren, readPhoto } from "./api";
import { SAMPLE_PHOTO_BASE64 } from "./sample-photo";
import { runToCart, shopRuntime, state } from "./test-utils";

describe("shop API helpers", () => {
  it("lists the helper slip under its parent", async () => {
    const rt = shopRuntime();
    const run = await runToCart(rt, { hireHelper: true });
    const kids = listChildren(rt, run.slipId!);
    expect(kids.map((k) => k.id)).toEqual([state(run).helper!.childSlipId]);
    expect(listChildren(rt, "slip_missing")).toEqual([]);
  });

  it("serves images and refuses other blobs", () => {
    const rt = shopRuntime();
    const png = rt.store.blobs.put({ contentType: "image/png", base64: SAMPLE_PHOTO_BASE64 });
    const text = rt.store.blobs.put({ contentType: "text/plain", base64: "aGk=" });
    expect(readPhoto(rt, png)?.contentType).toBe("image/png");
    expect(readPhoto(rt, png)?.bytes[0]).toBe(0x89);
    expect(readPhoto(rt, text)).toBeNull();
    expect(readPhoto(rt, "")).toBeNull();
  });
});
