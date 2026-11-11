import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CashWeatherState } from "@/pipelines/cash-weather/types";
import { fixedRuntime, planned, runSteps } from "@/pipelines/cash-weather/testkit";
import { BandChart } from "./band-chart";
import { NoticeList } from "./cash-weather-console";
import { InvoiceTable } from "./invoice-table";
import { GiveReasoning, UpstreamTable } from "./upstream-table";
import { WeatherStrip } from "./weather-strip";

async function waitingState(): Promise<CashWeatherState> {
  const { rt } = fixedRuntime();
  const state = await planned(rt);
  return (await runSteps(rt, state, ["nudges"])).state;
}

describe("Cash Weather page components", () => {
  it("renders 13 week cells, each with a text label and a date range", async () => {
    const s = await waitingState();
    const html = renderToStaticMarkup(createElement(WeatherStrip, { weeks: s.forecast!.weeks }));
    expect(html.match(/<li /g)).toHaveLength(13);
    for (const word of ["Sunny", "Storm"]) expect(html).toContain(`>${word}<`);
    expect(html).toMatch(/<span>Nov \d+<\/span><span>to Nov \d+<\/span>/);
    expect(html).not.toMatch(/[–—]/);
  });

  it("draws the band chart in plain SVG with a title, a description naming the lowest week, a buffer line and storm marks", async () => {
    const s = await waitingState();
    const html = renderToStaticMarkup(createElement(BandChart, { forecast: s.forecast! }));
    const lowest = [...s.forecast!.weeks].sort((a, b) => a.lowP10Cents - b.lowP10Cents)[0];
    expect(html).toContain("<svg");
    expect(html).toMatch(/<title[^>]*>Projected balance/);
    expect(html).toMatch(new RegExp(`<desc[^>]*>[^<]*lowest week is week ${lowest.week}`));
    expect(html).toContain('data-line="buffer"');
    expect(html).toContain("data-storm-week=");
    expect(html).toContain("Show the numbers by week");
  });

  it("gives every drafted invoice labeled approve, edit and skip controls while waiting", async () => {
    const s = await waitingState();
    const html = renderToStaticMarkup(
      createElement(InvoiceTable, { outlooks: s.forecast!.invoices, drafts: s.drafts, reminders: [], waiting: true, error: null }),
    );
    for (const d of s.drafts) {
      expect(html).toContain(`name="decision-${d.invoiceId}"`);
      expect(html).toContain(`Reminder for invoice ${d.number}`);
    }
    expect(html.match(/type="radio"/g)).toHaveLength(s.drafts.length * 3);
    expect(html).toContain("Tone: final");
    expect(html).toContain("Open invoices that are not overdue yet");
  });

  it("shows npm handles next to receivers, https funding links only, and all six reasoning lines", async () => {
    const s = await waitingState();
    const upstream = {
      ...s.upstream!,
      packages: s.upstream!.packages.map((p) => (p.name === "pino" ? { ...p, funding: "javascript:alert(1)" } : p)),
    };
    const html = renderToStaticMarkup(createElement(UpstreamTable, { upstream, give: s.give }));
    expect(html).toContain("@colinhacks");
    expect(html).toContain("sb-colinhacks@personal.example.com");
    expect(html).toContain('href="https://github.com/sponsors/colinhacks"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain("No payout route");
    const reasoning = renderToStaticMarkup(createElement(GiveReasoning, { give: s.give! }));
    expect(reasoning.match(/<li/g)).toHaveLength(6);
    expect(reasoning).toContain("Safe to give: $150.00");
  });

  it("shows a fallback notice when sample data stood in", () => {
    const html = renderToStaticMarkup(
      createElement(NoticeList, { notices: [{ id: "tx-fallback", level: "warn", text: "PayPal transaction search is not enabled for this app. Showing the sample studio's history instead." }] }),
    );
    expect(html).toContain('data-notice="tx-fallback"');
    expect(html).toContain("Heads up:");
    expect(html).toContain("sample studio");
  });
});
