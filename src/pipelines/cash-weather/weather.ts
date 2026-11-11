/**
 * Weekly weather from the daily bands. Week k covers days 7k-6..7k (week 13 stops at day 90).
 *   storm   lowest p50 below the buffer, or lowest p10 below zero
 *   cloudy  not storm, lowest p10 below the buffer
 *   sunny   otherwise
 */
import type { WeatherLabel, WeekWeather } from "./types";
import { addDaysIso } from "./dates";

export const WEEKS = 13;

export function labelWeek(lowP10Cents: number, lowP50Cents: number, bufferCents: number): WeatherLabel {
  if (lowP50Cents < bufferCents || lowP10Cents < 0) return "storm";
  if (lowP10Cents < bufferCents) return "cloudy";
  return "sunny";
}

export function labelWeeks(p10: number[], p50: number[], bufferCents: number, asOf: string, horizonDays = 90): WeekWeather[] {
  const weeks: WeekWeather[] = [];
  for (let week = 1; week <= WEEKS; week++) {
    const startDay = 7 * week - 6;
    const endDay = Math.min(7 * week, horizonDays);
    if (startDay > horizonDays) break;
    let lowP10 = Number.POSITIVE_INFINITY;
    let lowP50 = Number.POSITIVE_INFINITY;
    for (let d = startDay; d <= endDay; d++) {
      lowP10 = Math.min(lowP10, p10[d]);
      lowP50 = Math.min(lowP50, p50[d]);
    }
    weeks.push({
      week,
      startDay,
      endDay,
      startDate: addDaysIso(asOf, startDay),
      endDate: addDaysIso(asOf, endDay),
      lowP10Cents: lowP10,
      lowP50Cents: lowP50,
      label: labelWeek(lowP10, lowP50, bufferCents),
    });
  }
  return weeks;
}
