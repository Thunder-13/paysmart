"use client";
import { useEffect, useRef } from "react";

/** A 1px marker at the top of the page. When it leaves the viewport, <html data-scrolled> is set; CSS does the rest. */
export function ScrollSentinel() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) delete root.dataset.scrolled;
      else root.dataset.scrolled = "";
    });
    io.observe(el);
    return () => {
      io.disconnect();
      delete root.dataset.scrolled;
    };
  }, []);
  return <div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-6" />;
}
