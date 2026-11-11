/* Every section reads SQLite in a few milliseconds, so the page renders them inline: the first HTML
 * chunk carries the real ask box and proof board (no flash of an empty board) and the page is complete with scripting off. */
import { PaySmartHero } from "./_home/paysmart-band";
import { Hero } from "./_home/hero";
import { GuardLabSection } from "./_home/guard-lab-section";
import { PipelinesSection } from "./_home/pipelines";
import { IdeasMap } from "./_home/ideas";
import { LedgerSection } from "./_home/ledger";

export default function Home() {
  return (
    <>
      <PaySmartHero />
      <Hero />
      <GuardLabSection />
      <PipelinesSection />
      <IdeasMap />
      <LedgerSection />
    </>
  );
}
