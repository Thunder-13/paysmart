import type { Money } from "@/core/contracts";
import { formatMoney } from "@/core/money";

export type MoneyTone = "neutral" | "green" | "red" | "amber" | "muted";

const TONES: Record<MoneyTone, string> = {
  neutral: "text-ink",
  green: "text-stamp-green",
  red: "text-stamp-red",
  amber: "text-stamp-amber",
  muted: "text-ink-faint",
};

export interface MoneyTagProps {
  money: Money;
  /** Optional caption shown above the amount, e.g. "Held". */
  label?: string;
  tone?: MoneyTone;
  className?: string;
}

/** An amount in PayPal wire format, shown as "$42.18", in tabular figures. */
export function MoneyTag({ money, label, tone = "neutral", className = "" }: MoneyTagProps) {
  const amount = (
    <data value={`${money.value} ${money.currency}`} className={`font-semibold tabular-nums tracking-tight ${TONES[tone]}`}>
      {formatMoney(money)}
    </data>
  );
  if (!label) return <span className={className}>{amount}</span>;
  return (
    <span className={`inline-flex flex-col leading-tight ${className}`}>
      <span className="text-xs text-ink-soft">{label}</span>
      {amount}
    </span>
  );
}

export default MoneyTag;
