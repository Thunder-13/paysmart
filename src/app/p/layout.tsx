import type { ReactNode } from "react";

/** Pipeline screens sit in the page container; the home page owns its full-bleed field. */
export default function PipelineLayout({ children }: { children: ReactNode }) {
  return <div className="container-page pb-8 pt-8">{children}</div>;
}
