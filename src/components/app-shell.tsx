import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { resolveConfig } from "@/server/config";
import { RouteTransition } from "./motion/route-transition";
import { ScrollSentinel } from "./motion/scroll-sentinel";
import { NavLinks, NavLinksStatic } from "./nav-links";
import { PIPELINE_NAV } from "./pipeline-nav";

/** The mark: a slip torn from a pad, two clause lines, and the seal it is signed with. */
export function SlipMark({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className={className} fill="none">
      <path
        d="M7 4.5h14a1.5 1.5 0 0 1 1.5 1.5v16.5l-2.5-1.6-2.5 1.6-2.5-1.6-2.5 1.6-2.5-1.6-2.5 1.6V6A1.5 1.5 0 0 1 7 4.5Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M9.5 10h9M9.5 13.5h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="18.25" cy="16.75" r="2.25" className="fill-pp-sky" />
    </svg>
  );
}

function ModeChip({ children, live }: { children: ReactNode; live: boolean }) {
  return (
    <span
      className={`inline-flex h-6 items-center whitespace-nowrap rounded-pill border px-2 text-xs sm:h-7 sm:px-3 font-semibold ${
        live ? "border-pp-sky text-pp-sky" : "border-night-line text-on-night-soft"
      }`}
    >
      {children}
    </span>
  );
}

/** Reads env at request time so the chips match the running server, not the build machine. */
async function ModeChips() {
  await connection();
  const config = resolveConfig();
  return (
    <>
      <ModeChip live={config.paypalMode === "sandbox"}>PayPal: {config.paypalMode}</ModeChip>
      <ModeChip live={config.aiMode === "anthropic"}>AI: {config.aiMode === "anthropic" ? "claude" : "mock"}</ModeChip>
    </>
  );
}

export interface AppShellProps {
  children: ReactNode;
}

/** Page frame: night bar with the wordmark, pipeline nav and mode chips. src/app/layout.tsx wraps every page in it. */
export function AppShell({ children }: AppShellProps) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <ScrollSentinel />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[500] focus:rounded-pill focus:bg-pp-blue focus:px-4 focus:py-2 focus:font-semibold focus:text-on-plate"
      >
        Skip to content
      </a>
      <header className="site-header on-night sticky top-0 z-[300] bg-night text-on-night">
        <div className="container-page flex h-14 items-center gap-3 lg:h-16 lg:gap-6">
          <Link
            href="/"
            aria-label="PaySmart, home"
            className="flex min-w-0 shrink items-center gap-2 rounded-md font-display text-base sm:shrink-0 sm:gap-2.5 sm:text-lg font-extrabold tracking-tight text-on-night"
          >
            <SlipMark className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" />
            <span className="whitespace-nowrap">PaySmart</span>
          </Link>
          <nav aria-label="Pipelines" className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
            <Suspense fallback={<NavLinksStatic />}>
              <NavLinks />
            </Suspense>
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2" role="group" aria-label="Modes">
            <Suspense fallback={<ModeChip live={false}>PayPal: …</ModeChip>}>
              <ModeChips />
            </Suspense>
          </div>
        </div>
      </header>
      {/* Phone only: the pipeline row scrolls away with the page; only the top bar above stays sticky. */}
      <div className="on-night bg-night pb-3 text-on-night lg:hidden">
        <div className="container-page flex items-center gap-3">
          <nav aria-label="Pipelines" className="flex min-w-0 flex-1 gap-1 overflow-x-auto [mask-image:linear-gradient(to_right,var(--color-ink)_82%,transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <Suspense fallback={<NavLinksStatic />}>
              <NavLinks />
            </Suspense>
          </nav>
        </div>
      </div>
      <main id="main" className="flex-1">
        <RouteTransition>{children}</RouteTransition>
      </main>
      <footer className="on-night mt-24 rounded-t-plate bg-night text-on-night">
        <div className="container-page pt-14 pb-8 md:pt-20">
          <div className="grid grid-cols-[minmax(0,1fr)] gap-10 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <div className="min-w-0">
              <SlipMark className="h-11 w-11 text-on-night" />
              <p className="mt-5 max-w-[40ch] text-lg text-on-night-soft">Every dollar an AI touches carries a signed Permission Slip.</p>
            </div>
            <ul className="grid grid-cols-2 gap-x-10 gap-y-1 text-sm sm:grid-cols-3" aria-label="Pipelines">
              {PIPELINE_NAV.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="footer-link inline-flex min-h-11 items-center rounded-sm text-on-night-soft underline decoration-transparent underline-offset-4 transition-colors duration-[120ms]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <p
            aria-hidden="true"
            className="mt-12 font-display text-[clamp(3.25rem,12vw,11rem)] font-extrabold leading-[0.85] tracking-display text-on-night [text-wrap:balance]"
          >
            PaySmart
          </p>
          <p className="mt-6 text-sm text-on-night-soft">Built for the PayPal AI Hackathon on Devpost.</p>
        </div>
      </footer>
    </div>
  );
}

export default AppShell;
