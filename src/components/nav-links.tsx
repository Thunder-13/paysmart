"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PIPELINE_NAV } from "./pipeline-nav";

export { PIPELINE_NAV };

const LINK =
  "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-pill px-3.5 text-sm font-semibold transition-colors duration-[120ms] active:bg-night-line";

/** Static links; used as the Suspense fallback while the active route is known. */
export function NavLinksStatic() {
  return (
    <>
      {PIPELINE_NAV.map((l) => (
        <Link key={l.href} href={l.href} className={`${LINK} nav-link text-on-night-soft`}>
          {l.label}
        </Link>
      ))}
    </>
  );
}

export function NavLinks() {
  const pathname = usePathname();
  return (
    <>
      {PIPELINE_NAV.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={`${LINK} nav-link ${active ? "nav-pill-active bg-on-night text-night" : "text-on-night-soft"}`}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
