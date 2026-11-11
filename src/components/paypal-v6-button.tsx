"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type DetailedHTMLProps, type HTMLAttributes, type ReactNode } from "react";

/* The <paypal-button> custom element comes from PayPal's v6 script. Declare it so TSX accepts it. */
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { type?: "pay" | "checkout" | "buynow" | "subscribe" };
    }
  }
}

/** The slice of PayPal's v6 SDK this component calls. Names follow the v6 reference (see design.md, Sources). */
interface PayPalSession {
  start(options: { presentationMode: "auto" }, order: Promise<{ orderId: string }>): Promise<void>;
}
interface PayPalSessionCallbacks {
  onApprove(data: { orderId?: string; payerId?: string }): void | Promise<void>;
  onCancel(data?: { orderId?: string }): void;
  onError(error?: { code?: string; message?: string }): void;
}
interface PayPalSdkInstance {
  findEligibleMethods(options: { currencyCode: string }): Promise<{ isEligible(method: string): boolean }>;
  createPayPalOneTimePaymentSession(callbacks: PayPalSessionCallbacks): Promise<PayPalSession>;
}
interface PayPalNamespace {
  createInstance(options: { clientId: string; components: string[] }): Promise<PayPalSdkInstance>;
}
type PayPalWindow = Window & { paypal?: PayPalNamespace };

interface SdkConfig {
  available: boolean;
  sdkUrl?: string;
  clientId?: string;
}

/** The order id PayPal puts in the approve link's `token` query parameter, or null. */
export function orderIdFromApproveUrl(approveUrl: string): string | null {
  try {
    const token = new URL(approveUrl, "http://localhost").searchParams.get("token");
    return token && token !== "" ? token : null;
  } catch {
    return null;
  }
}

/** Same-site return path with run=<id> appended. Mirrors withRunParam on the server. */
function withRun(returnPath: string, runId: string | null): string {
  const safe = returnPath.startsWith("/") && !returnPath.startsWith("//") ? returnPath : "/";
  if (!runId) return safe;
  const hashAt = safe.indexOf("#");
  const base = hashAt >= 0 ? safe.slice(0, hashAt) : safe;
  const hash = hashAt >= 0 ? safe.slice(hashAt) : "";
  return `${base}${base.includes("?") ? "&" : "?"}run=${encodeURIComponent(runId)}${hash}`;
}

let scriptPromise: Promise<void> | null = null;

/** Injects the SDK script once per page. A failed load clears the promise so a later mount can retry. */
function loadSdkScript(url: string): Promise<void> {
  const w = window as PayPalWindow;
  if (w.paypal) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    const el = document.createElement("script");
    el.src = url;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      el.remove();
      scriptPromise = null;
      reject(new Error("script failed to load"));
    };
    document.head.append(el);
  });
  return scriptPromise;
}

type Phase = { kind: "loading" } | { kind: "ready"; session: PayPalSession } | { kind: "link" };

export interface PayPalV6ButtonProps {
  approveUrl: string;
  /** Defaults to the `token` query parameter of approveUrl. */
  orderId?: string;
  /** Accessible name for the PayPal button. */
  label?: string;
  /** The approve link, shown while loading and whenever the button can't run. Rendered by the caller. */
  children: ReactNode;
}

const LINK_CLASS =
  "text-sm font-semibold text-pp-blue underline decoration-line underline-offset-4 transition-colors duration-[120ms] hover:decoration-pp-blue active:text-pp-deep";

/**
 * In-page PayPal approval for an order the server already created. Shows the caller's link until the
 * SDK is ready and eligible. Any failure puts the link back and says why in an aria-live region.
 */
export function PayPalV6Button({ approveUrl, orderId, label = "Sign with PayPal", children }: PayPalV6ButtonProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [message, setMessage] = useState("");
  const id = orderId ?? orderIdFromApproveUrl(approveUrl);
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  useEffect(() => {
    if (!id) return; // no order id to start: the loading phase already shows the link
    let cancelled = false;
    const fail = (reason: string) => {
      if (cancelled) return;
      setMessage(reason);
      setPhase({ kind: "link" });
    };
    const approve = async (approvedId: string) => {
      try {
        const res = await fetch("/api/paypal/approve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderId: approvedId }),
        });
        const body = (await res.json().catch(() => ({}))) as { runId?: string; returnPath?: string };
        if (!res.ok && res.status !== 409) throw new Error("approve failed");
        if (cancelled) return;
        const target = withRun(body.returnPath ?? "/", body.runId ?? null);
        if (target === window.location.pathname + window.location.search) routerRef.current.refresh();
        else routerRef.current.push(target);
      } catch {
        fail("We could not record your approval. Use the link to finish signing.");
      }
    };
    (async () => {
      try {
        const res = await fetch("/api/paypal/sdk-config", { cache: "no-store" });
        const cfg = (await res.json()) as SdkConfig;
        if (!res.ok || !cfg.available || !cfg.sdkUrl || !cfg.clientId) return fail("");
        await loadSdkScript(cfg.sdkUrl);
        const paypal = (window as PayPalWindow).paypal;
        if (!paypal) return fail("PayPal's button did not load. Use the link instead.");
        const sdk = await paypal.createInstance({ clientId: cfg.clientId, components: ["paypal-payments"] });
        const eligibility = await sdk.findEligibleMethods({ currencyCode: "USD" });
        if (!eligibility.isEligible("paypal")) return fail("");
        const session = await sdk.createPayPalOneTimePaymentSession({
          onApprove: (data) => approve(data.orderId || id),
          onCancel: () => {
            if (!cancelled) setMessage("You closed PayPal. Your slip isn't signed yet.");
          },
          onError: () => fail("PayPal hit a problem. Use the link instead."),
        });
        if (!cancelled) setPhase({ kind: "ready", session });
      } catch {
        fail("PayPal's button could not start. Use the link instead.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const start = (session: PayPalSession, orderToStart: string) => {
    setMessage("");
    session.start({ presentationMode: "auto" }, Promise.resolve({ orderId: orderToStart })).catch(() => {
      setMessage("PayPal hit a problem. Use the link instead.");
      setPhase({ kind: "link" });
    });
  };

  return (
    <div className="flex flex-col items-start gap-3">
      {phase.kind === "ready" && id ? (
        <>
          <paypal-button type="pay" className="paypal-gold" aria-label={label} onClick={() => start(phase.session, id)} />
          <a href={approveUrl} className={LINK_CLASS}>
            Open PayPal&apos;s page instead
          </a>
        </>
      ) : (
        children
      )}
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-ink-soft">
        {message}
      </p>
    </div>
  );
}

export default PayPalV6Button;
