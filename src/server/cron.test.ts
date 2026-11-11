import { describe, expect, it } from "vitest";
import { HOUR, makeKit } from "@/pipelines/bounty/testkit";
import { bountyTickResponse, cronAuthorized } from "./cron";

function post(auth?: string): Request {
  return new Request("http://localhost:3000/api/p/bounty/tick", { method: "POST", headers: auth ? { Authorization: auth } : {} });
}

describe("bounty tick over HTTP", () => {
  it("is off without CRON_SECRET and refuses a wrong token", async () => {
    const kit = makeKit();
    expect((await bountyTickResponse(post("Bearer x"), () => kit.rt, {})).status).toBe(404);
    expect((await bountyTickResponse(post(), () => kit.rt, { CRON_SECRET: "s3cret" })).status).toBe(401);
    expect((await bountyTickResponse(post("Bearer nope"), () => kit.rt, { CRON_SECRET: "s3cret" })).status).toBe(401);
    expect(cronAuthorized(post("bearer s3cret"), "s3cret")).toBe(true);
  });

  it("closes a bounty past its deadline and voids its pledges", async () => {
    const kit = makeKit();
    const { bounty } = await kit.createBounty();
    await kit.pledge(bounty.id, "Ann Lee", "25.00");
    kit.clock.advance(49 * HOUR);
    const res = await bountyTickResponse(post("Bearer s3cret"), () => kit.rt, { CRON_SECRET: "s3cret" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { resumed: number; closed: string[] };
    expect(body.closed).toEqual([bounty.runId]);
    expect(kit.bounty(bounty.id).status).toBe("expired");
    expect(kit.rt.mockRail.calls().some((c) => c.method === "voidAuthorization")).toBe(true);
  });
});
