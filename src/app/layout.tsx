import type { Metadata, Viewport } from "next";
import { Albert_Sans, Azeret_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { resolveConfig } from "@/server/config";
import "./globals.css";

/* One family for display and text, the way PayPal pairs Pro with Pro Text; a mono for ids and hashes. */
const albert = Albert_Sans({ subsets: ["latin"], display: "swap", variable: "--font-albert" });
const azeret = Azeret_Mono({ subsets: ["latin"], display: "swap", variable: "--font-azeret" });

/** The direction contract, emitted as an HTML comment so the built page carries it. */
const DIRECTION_CONTRACT = `THESIS: every dollar an AI moves is a strip on a clearance board; the guard racks it into Within, Your call or Outside against a slip PayPal holds the money for. Refuses the fintech default of a gradient hero over feature cards.
OWN-WORLD: PayPal60's own system pushed further: night navy field, PayPal blue signal, sky for cleared, gold for your call, red only for refusal; flat overlapping plates with 2.5rem corners, black-navy pills, Albert Sans heavy and tight, Azeret Mono for hashes.
STORY: a judge sees a real slip, watches the guard refuse a hijacked $419.96 cart and clear a $42.18 one, loads the demo, opens a run.
FIRST VIEWPORT: night plate; headline and one line on columns 1-5 with the primary pill; the clearance board on 6-12, the slip pinned over its edge, strips racked by verdict.
FORM: clearance board, grounded 3/7, seed f8d86edb.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance`;

const TITLE = "PaySmart";
const DESCRIPTION = "PaySmart turns a plain-words ask into carts a guard has checked, and PayPal pays only the cart you pick. Every dollar an AI touches carries a signed Permission Slip.";

export const metadata: Metadata = {
  metadataBase: new URL(resolveConfig().baseUrl),
  title: { default: TITLE, template: "%s | PaySmart" },
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: TITLE, type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export const viewport: Viewport = {
  themeColor: "#001435",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${albert.variable} ${azeret.variable}`}>
      <body className="antialiased">
        <div hidden dangerouslySetInnerHTML={{ __html: `<!--\n${DIRECTION_CONTRACT}\n-->` }} />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
