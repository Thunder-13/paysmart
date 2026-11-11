import type { ReactNode } from "react";

/** Sits in the page container like the pipeline screens. */
export default function Layout({ children }: { children: ReactNode }) {
  return <div className="container-page pb-8 pt-8">{children}</div>;
}
