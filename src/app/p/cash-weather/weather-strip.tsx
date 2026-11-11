import { formatMoney, fromCents } from "@/core/money";
import type { WeatherLabel, WeekWeather } from "@/pipelines/cash-weather/types";
import { shortDay } from "@/pipelines/cash-weather/dates";

const LOOK: Record<WeatherLabel, { word: string; cell: string }> = {
  sunny: { word: "Sunny", cell: "bg-pp-sky-wash text-night" },
  cloudy: { word: "Cloudy", cell: "bg-paper-deep text-night" },
  storm: { word: "Storm", cell: "bg-pp-gold text-night" },
};

export function WeatherGlyph({ label, className = "h-7 w-7" }: { label: WeatherLabel; className?: string }) {
  if (label === "sunny") {
    return (
      <svg aria-hidden="true" viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="16" cy="16" r="5.5" />
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <line key={a} x1="16" y1="4" x2="16" y2="7.5" transform={`rotate(${a} 16 16)`} />
        ))}
      </svg>
    );
  }
  const cloud = "M9 22h14a5 5 0 0 0 0-10 7 7 0 0 0-13.4 1.6A4.3 4.3 0 0 0 9 22z";
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
      <path d={cloud} />
      {label === "storm" ? <path d="M17 23l-3 4.5h4l-2.5 3.5" /> : null}
    </svg>
  );
}

export function WeatherStrip({ weeks }: { weeks: WeekWeather[] }) {
  return (
    <ol aria-label="13-week cash weather" className="grid grid-cols-4 gap-1 sm:grid-cols-7 lg:grid-cols-13">
      {weeks.map((w) => {
        const look = LOOK[w.label];
        return (
          <li
            key={w.week}
            data-label={w.label}
            className={`flex min-w-0 flex-col items-center gap-1 rounded-md px-0.5 py-3 text-center ${look.cell}`}
            title={`Week ${w.week}, ${shortDay(w.startDate)} to ${shortDay(w.endDate)}: ${look.word}. Low case ${formatMoney(fromCents(w.lowP10Cents))}, middle case ${formatMoney(fromCents(w.lowP50Cents))}.`}
          >
            <span className="text-xs font-semibold">Wk {w.week}</span>
            <WeatherGlyph label={w.label} className="h-9 w-9" />
            <span className="text-sm font-extrabold">{look.word}</span>
            <span className="flex flex-col whitespace-nowrap text-[length:0.75rem] leading-tight tracking-tight">
              <span>{shortDay(w.startDate)}</span>
              <span>to {shortDay(w.endDate)}</span>
            </span>
            <span className="mt-1 flex flex-col text-xs leading-tight">
              <span>low</span>
              <span className="whitespace-nowrap font-semibold tabular-nums tracking-tight">{formatMoney(fromCents(w.lowP10Cents))}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default WeatherStrip;
