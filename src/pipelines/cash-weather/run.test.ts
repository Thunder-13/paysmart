import { describe, expect, it } from "vitest";
import type { CashWeatherState } from "./types";
import { DEFAULT_IMPORT_COUNTS, DEFAULT_PACKAGE_JSON } from "./fixtures";
import { fixedRuntime } from "./testkit";

describe("full mock run", () => {
  it("runs end to end offline: reminders approved, slip signed, maintainers paid, chain verified", async () => {
    const { rt } = fixedRuntime();
    let run = await rt.orchestrator.start("cash-weather", { packageJson: DEFAULT_PACKAGE_JSON, importCounts: DEFAULT_IMPORT_COUNTS });
    expect(run.status).toBe("waiting");
    expect(run.step).toBe("send_nudges");
    expect(run.wait?.kind).toBe("user_confirm");

    run = await rt.orchestrator.resume(run.id, { approved: true });
    expect(run.status).toBe("waiting");
    expect(run.step).toBe("pay");

    run = await rt.orchestrator.resume(run.id, { action: "sign" });
    expect(run.status).toBe("done");
    const s = run.state as unknown as CashWeatherState;
    expect(s.outcome).toBe("paid");

    const calls = rt.mockRail.calls();
    expect(calls.filter((c) => c.method === "sendInvoiceReminder")).toHaveLength(s.drafts.length);
    const [payout] = calls.filter((c) => c.method === "createPayout");
    const items = (payout.args[0] as { items: unknown[] }).items;
    expect(items).toHaveLength(s.give!.payouts.length);

    expect(run.slipId).toBe(s.slipId);
    expect(rt.store.ledger.verifyChain(run.slipId!)).toEqual({ ok: true, brokenAtSeq: null });
    const types = rt.store.ledger.list(run.slipId!).map((e) => e.type);
    for (const t of ["slip.created", "cash-weather.forecast", "cash-weather.nudge_drafted", "rail.invoice_reminder", "guard.verdict", "rail.payout_created", "cash-weather.payout_status", "run.done"]) {
      expect(types).toContain(t);
    }
  });

  it("forecasts the same studio whether or not the shared mock account holds other demo data", async () => {
    const a = fixedRuntime();
    const b = fixedRuntime({ seedRail: false });
    const input = { packageJson: DEFAULT_PACKAGE_JSON };
    const ra = await a.rt.orchestrator.start("cash-weather", input);
    const rb = await b.rt.orchestrator.start("cash-weather", input);
    expect((ra.state as unknown as CashWeatherState).forecast).toEqual((rb.state as unknown as CashWeatherState).forecast);
  });
});
