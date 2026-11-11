import { ViewTransition } from "react";
import type { PipelineId } from "@/core/contracts";
import { PLATE_SKINS } from "./plate-skins";

export interface PipelineHeaderProps {
  pipeline: PipelineId;
  title: string;
  tagline: string;
  /** PayPal and AI capabilities this pipeline uses, shown as badges. */
  primitives: string[];
}

/** The pipeline's title card: the same plate colour as its home plate, the title large, a ruled caption naming every API it uses. */
export function PipelineHeader({ pipeline, title, tagline, primitives }: PipelineHeaderProps) {
  const look = PLATE_SKINS[pipeline];
  return (
    <ViewTransition name={`plate-${pipeline}`}>
      <header
        className={`mb-10 grid grid-cols-[minmax(0,1fr)] gap-8 rounded-plate px-6 py-10 sm:px-10 sm:py-12 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start lg:gap-12 lg:px-14 lg:py-16 ${look.skin}`}
      >
        <div className="min-w-0">
          <h1 className="max-w-[16ch] font-display text-5xl font-extrabold leading-[0.98] tracking-[-0.035em] sm:text-6xl lg:text-7xl">{title}</h1>
          {tagline ? <p className={`mt-5 max-w-[52ch] text-lg leading-snug lg:text-xl ${look.soft}`}>{tagline}</p> : null}
        </div>
        {primitives.length > 0 ? (
          <div className="min-w-0 lg:pt-3">
            <p className="text-sm font-semibold">PayPal and AI it uses</p>
            <ul className="mt-3 flex flex-wrap gap-2" aria-label="Capabilities used">
              {primitives.map((p) => (
                <li key={p} className={`rounded-pill px-3 py-1 text-sm font-semibold ${look.chip}`}>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </header>
    </ViewTransition>
  );
}

export default PipelineHeader;
