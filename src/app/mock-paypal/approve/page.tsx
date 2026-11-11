import type { Metadata } from "next";
import { Suspense } from "react";
import { MoneyTag } from "@/components/money-tag";
import { getRuntime } from "@/server/runtime";
import { approveMockOrder, cancelMockOrder } from "./actions";
import { MOCK_BUYER_EMAIL } from "./mock-buyer";

export const metadata: Metadata = { title: "Sandbox simulator" };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-8">
      <div className="rounded-card border border-line bg-card p-6">
        <span className="inline-flex rounded-pill border border-pp-gold bg-pp-gold-wash px-2.5 py-0.5 text-xs font-semibold text-stamp-amber">Sandbox simulator</span>
        <p className="mb-5 mt-3 text-sm text-ink-soft">Offline stand-in for the payment approval screen. No real money, no real account.</p>
        {children}
      </div>
    </div>
  );
}

async function Approval({ searchParams }: { searchParams: PageProps<"/mock-paypal/approve">["searchParams"] }) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const mock = getRuntime().mockRail;
  if (!mock) {
    return <p className="text-sm text-ink">The simulator only runs in mock mode. This server talks to the real PayPal sandbox.</p>;
  }
  const order = token ? mock.inspectOrder(token) : null;
  if (!order) {
    return (
      <p role="alert" className="text-sm text-stamp-red">
        No simulated order {token ? <span className="font-mono">{token}</span> : null} was found. It may be from before the server restarted.
      </p>
    );
  }
  const open = order.status === "CREATED";
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-ink-soft">{order.intent === "AUTHORIZE" ? "Hold up to" : "Pay"}</p>
        <p className="text-3xl font-extrabold tracking-tight">
          <MoneyTag money={order.amount} />
        </p>
        <p className="mt-2 text-sm text-ink">{order.description}</p>
        {order.payee?.email || order.payee?.merchantId ? (
          <p className="mt-1 text-sm text-ink-soft">
            To <span className="font-mono">{order.payee.email ?? order.payee.merchantId}</span>
          </p>
        ) : null}
        <p className="mt-3 flex flex-wrap gap-x-3 text-xs text-ink-faint">
          <span>
            Order <span className="font-mono">{order.id}</span>
          </span>
          <span>{order.status}</span>
          <span>
            buyer <span className="font-mono">{MOCK_BUYER_EMAIL}</span>
          </span>
        </p>
      </div>
      {open ? (
        <div className="flex flex-wrap gap-3">
          <form action={approveMockOrder}>
            <input type="hidden" name="token" value={order.id} />
            <button type="submit" className="inline-flex h-11 items-center rounded-pill bg-ink px-6 text-sm font-semibold text-on-night transition-colors duration-[120ms] hover:bg-pp-deep active:bg-night-3 disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue">
              Approve
            </button>
          </form>
          <form action={cancelMockOrder}>
            <input type="hidden" name="token" value={order.id} />
            <button type="submit" className="inline-flex h-11 items-center rounded-pill border border-edge bg-card px-5 text-sm font-semibold text-ink transition-colors duration-[120ms] hover:border-ink active:bg-paper-deep disabled:cursor-not-allowed disabled:opacity-55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue">
              Cancel
            </button>
          </form>
        </div>
      ) : (
        <p className="text-sm text-ink-soft">
          This order is already {order.status.toLowerCase()}.{" "}
          <a className="font-semibold text-pp-blue underline decoration-line underline-offset-4 transition-colors duration-[120ms] hover:decoration-pp-blue active:text-pp-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pp-blue" href={order.status === "VOIDED" ? order.cancelUrl : order.returnUrl}>
            Go back
          </a>
        </p>
      )}
    </div>
  );
}

export default function MockApprovePage({ searchParams }: PageProps<"/mock-paypal/approve">) {
  return (
    <Frame>
      <Suspense fallback={<p className="text-sm text-ink-faint">Loading the order…</p>}>
        <Approval searchParams={searchParams} />
      </Suspense>
    </Frame>
  );
}
