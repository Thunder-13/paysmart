"use client";
import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatMoney, fromCents } from "@/core/money";
import type { ForecastResult } from "@/pipelines/cash-weather/types";
import { addDaysIso, shortDay } from "@/pipelines/cash-weather/dates";

const W = 720;
const H = 260;
const M = { top: 18, right: 112, bottom: 30, left: 70 };

const usd = (cents: number) => formatMoney(fromCents(Math.round(cents), "USD"));

function niceStep(range: number): number {
  const rough = range / 4;
  const pow = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  const n = rough / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

/** Pushes right-edge labels apart so no two sit closer than `gap` pixels. */
function spreadLabels(items: { key: string; y: number }[], gap: number): Record<string, number> {
  const sorted = [...items].sort((a, b) => a.y - b.y);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - sorted[i - 1].y < gap) sorted[i] = { ...sorted[i], y: sorted[i - 1].y + gap };
  }
  return Object.fromEntries(sorted.map((l) => [l.key, l.y]));
}

/** p10..p90 band, p50 line, buffer and zero lines, storm weeks tinted. Plain SVG, no chart library. */
export function BandChart({ forecast: f }: { forecast: ForecastResult }) {
  const id = useId();
  const [day, setDay] = useState<number | null>(null);
  const days = f.p50.length - 1;
  const lo = Math.min(0, f.bufferCents, ...f.p10);
  const hi = Math.max(f.bufferCents, ...f.p90);
  const step = niceStep(hi - lo);
  const yMin = Math.floor(lo / step) * step;
  const yMax = Math.ceil(hi / step) * step;
  const x = (d: number) => M.left + (d / days) * (W - M.left - M.right);
  const y = (c: number) => M.top + (1 - (c - yMin) / (yMax - yMin)) * (H - M.top - M.bottom);
  const ticks: number[] = [];
  for (let v = yMin; v <= yMax; v += step) ticks.push(v);

  const band =
    f.p90.map((v, d) => `${d === 0 ? "M" : "L"}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(" ") +
    " " +
    [...f.p10.keys()].reverse().map((d) => `L${x(d).toFixed(1)},${y(f.p10[d]).toFixed(1)}`).join(" ") +
    " Z";
  const mid = f.p50.map((v, d) => `${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lowest = [...f.weeks].sort((a, b) => a.lowP10Cents - b.lowP10Cents)[0];
  const labels = spreadLabels(
    [
      { key: "p50", y: y(f.p50[days]) + 4 },
      { key: "band", y: y(f.p90[days]) + 4 },
      { key: "buffer", y: y(f.bufferCents) + 4 },
      ...(yMin < 0 ? [{ key: "zero", y: y(0) + 4 }] : []),
    ],
    13,
  );
  const storms = f.weeks.filter((w) => w.label === "storm");

  function pick(e: PointerEvent<SVGRectElement>) {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!box) return;
    const px = ((e.clientX - box.left) / box.width) * W;
    setDay(Math.max(0, Math.min(days, Math.round(((px - M.left) / (W - M.left - M.right)) * days))));
  }
  function keys(e: KeyboardEvent<SVGSVGElement>) {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setDay((d) => Math.max(0, Math.min(days, (d ?? 0) + (e.key === "ArrowRight" ? 1 : -1))));
    } else if (e.key === "Escape") setDay(null);
  }

  return (
    <figure className="rounded-card border border-line bg-card p-4 sm:p-6">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-labelledby={`${id}-t ${id}-d`}
          tabIndex={0}
          onKeyDown={keys}
          className="h-auto w-full touch-none rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue"
        >
          <title id={`${id}-t`}>{`Projected balance, next ${days} days`}</title>
          <desc id={`${id}-d`}>
            {`Middle case runs from ${usd(f.p50[0])} today to ${usd(f.p50[days])} on day ${days}. The lowest week is week ${lowest.week} (${shortDay(lowest.startDate)} to ${shortDay(lowest.endDate)}), where the low case reaches ${usd(lowest.lowP10Cents)}. ${storms.length} storm week${storms.length === 1 ? "" : "s"}.`}
          </desc>
          {storms.map((w) => (
            <g key={w.week} data-storm-week={w.week}>
              <rect x={x(w.startDay - 1)} y={M.top} width={x(w.endDay) - x(w.startDay - 1)} height={H - M.top - M.bottom} className="fill-pp-gold-wash" />
              <text x={(x(w.startDay - 1) + x(w.endDay)) / 2} y={M.top - 5} textAnchor="middle" fontSize="12" fontWeight="600" className="fill-stamp-amber">
                storm
              </text>
            </g>
          ))}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} strokeWidth={1} className="stroke-line" />
              <text x={M.left - 8} y={y(t) + 4} textAnchor="end" fontSize="12" className="fill-ink-soft tabular-nums">
                {usd(t).replace(".00", "")}
              </text>
            </g>
          ))}
          {[0, 14, 28, 42, 56, 70, 84].map((d) => (
            <text key={d} x={x(d)} y={H - 10} textAnchor="middle" fontSize="12" className="fill-ink-soft">
              {d === 0 ? "Today" : shortDay(addDaysIso(f.asOf, d))}
            </text>
          ))}
          <path d={band} strokeWidth={1} strokeLinejoin="round" className="fill-pp-sky-wash stroke-pp-sky" />
          <line x1={M.left} x2={W - M.right} y1={y(f.bufferCents)} y2={y(f.bufferCents)} strokeWidth={1.5} strokeDasharray="6 4" data-line="buffer" className="stroke-stamp-amber" />
          <text x={W - M.right + 6} y={labels.buffer} fontSize="12" fontWeight="600" className="fill-stamp-amber">
            Buffer {usd(f.bufferCents).replace(".00", "")}
          </text>
          {yMin < 0 ? (
            <>
              <line x1={M.left} x2={W - M.right} y1={y(0)} y2={y(0)} strokeWidth={1} data-line="zero" className="stroke-ink-soft" />
              <text x={W - M.right + 6} y={labels.zero} fontSize="12" className="fill-ink-soft">
                $0
              </text>
            </>
          ) : null}
          <polyline points={mid} fill="none" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" className="stroke-pp-blue" />
          <text x={W - M.right + 6} y={labels.p50} fontSize="12" fontWeight="600" className="fill-pp-blue">
            Middle (p50)
          </text>
          <text x={W - M.right + 6} y={labels.band} fontSize="12" className="fill-ink-soft">
            High (p90)
          </text>
          {day !== null ? (
            <g pointerEvents="none">
              <line x1={x(day)} x2={x(day)} y1={M.top} y2={H - M.bottom} strokeWidth={1} className="stroke-ink-faint" />
              <circle cx={x(day)} cy={y(f.p50[day])} r={4.5} strokeWidth={2} className="fill-pp-blue stroke-card" />
            </g>
          ) : null}
          <rect
            x={M.left}
            y={M.top}
            width={W - M.left - M.right}
            height={H - M.top - M.bottom}
            className="fill-transparent"
            onPointerMove={pick}
            onPointerDown={pick}
            onPointerLeave={() => setDay(null)}
          />
        </svg>
        {day !== null ? (
          <div
            role="status"
            className="pointer-events-none absolute top-2 rounded-sm bg-paper-deep px-3 py-2 text-xs"
            style={{ left: `${Math.min(70, Math.max(2, (x(day) / W) * 100))}%` }}
          >
            <p className="flex flex-wrap gap-x-3 text-ink-soft">
              {day === 0 ? (
                <span>Today</span>
              ) : (
                <>
                  <span>{shortDay(addDaysIso(f.asOf, day))}</span>
                  <span>day {day}</span>
                </>
              )}
            </p>
            <p className="text-sm font-semibold tabular-nums text-pp-blue">{usd(f.p50[day])}</p>
            <p className="flex flex-wrap gap-x-3 tabular-nums text-ink-soft">
              <span>low {usd(f.p10[day])}</span>
              <span>high {usd(f.p90[day])}</span>
            </p>
          </div>
        ) : null}
      </div>
      <figcaption className="mt-3 text-xs text-ink-soft">
        {f.scenarios} scenarios from seed {f.seed}. The band runs from the low case (p10) to the high case (p90). Hover or use the arrow keys for a day&apos;s numbers.
      </figcaption>
      <details className="mt-4 border-t border-line pt-3 text-sm">
        <summary className="cursor-pointer font-semibold text-pp-blue transition-colors duration-[120ms] hover:text-pp-deep active:text-night">Show the numbers by week</summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left tabular-nums">
            <thead>
              <tr className="border-b border-line text-ink-soft">
                <th className="py-2 pr-3 font-semibold">Week</th>
                <th className="py-2 pr-3 font-semibold">Dates</th>
                <th className="py-2 pr-3 font-semibold">Weather</th>
                <th className="py-2 pr-3 text-right font-semibold">Lowest low case</th>
                <th className="py-2 text-right font-semibold">Lowest middle case</th>
              </tr>
            </thead>
            <tbody>
              {f.weeks.map((w) => (
                <tr key={w.week} className="border-t border-line first:border-t-0">
                  <td className="py-2 pr-3">{w.week}</td>
                  <td className="py-2 pr-3">
                    {shortDay(w.startDate)} to {shortDay(w.endDate)}
                  </td>
                  <td className="py-2 pr-3 capitalize">{w.label}</td>
                  <td className="py-2 pr-3 text-right font-semibold">{usd(w.lowP10Cents)}</td>
                  <td className="py-2 text-right font-semibold">{usd(w.lowP50Cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export default BandChart;
