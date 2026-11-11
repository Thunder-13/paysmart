"use client";
import { usePathname } from "next/navigation";
import { ViewTransition, type ReactNode } from "react";

/**
 * Wraps the page body so every App Router navigation runs an exit then an enter.
 * Layouts persist across navigations, so the keyed wrapper (not the layout) is what remounts.
 * The CSS for the `route-out` and `route-in` classes lives in styles/motion.css.
 */
export function RouteTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} enter="route-in" exit="route-out" default="none">
      {children}
    </ViewTransition>
  );
}
