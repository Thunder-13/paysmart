import { PayPalV6Button } from "./paypal-v6-button";

export interface SignWithPayPalProps {
  approveUrl: string;
  /** Button text. Defaults to "Sign with PayPal". */
  label?: string;
  className?: string;
  /** Opt in to PayPal's in-page v6 button. The link stays as the fallback. */
  sdk?: "v6";
}

function ApproveLink({ approveUrl, label, className }: { approveUrl: string; label: string; className: string }) {
  return (
    <a
      href={approveUrl}
      className={`inline-flex h-11 items-center gap-2 rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep active:bg-night-3 ${className}`}
    >
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3 15c2.5-1 3.5-6 6-6s1.5 5 4 5 2.5-3 4-4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3 18h14" strokeLinecap="round" />
      </svg>
      {label}
    </a>
  );
}

/** Link button that sends the buyer to PayPal (or the sandbox simulator) to sign the slip. With sdk="v6", PayPal's button when it can run. */
export function SignWithPayPal({ approveUrl, label = "Sign with PayPal", className = "", sdk }: SignWithPayPalProps) {
  const link = <ApproveLink approveUrl={approveUrl} label={label} className={className} />;
  if (sdk === "v6") {
    return (
      <PayPalV6Button approveUrl={approveUrl} label={label}>
        {link}
      </PayPalV6Button>
    );
  }
  return link;
}

export default SignWithPayPal;
