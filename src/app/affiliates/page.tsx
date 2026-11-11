import type { Metadata } from "next";
import { AffiliatesAdmin } from "./affiliates-admin";

export const metadata: Metadata = {
  title: "Affiliate accounts",
  robots: { index: false, follow: false },
};

export default function AffiliatesPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="font-display text-3xl font-extrabold tracking-tight text-ink">Affiliate accounts</h1>
      <p className="mt-3 max-w-2xl text-base text-ink-soft">
        Retailer links the shop shows carry the IDs saved here. Enter the admin secret to load, add, change or switch off an account.
      </p>
      <AffiliatesAdmin />
    </div>
  );
}
