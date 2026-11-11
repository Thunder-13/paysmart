import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const alt = "PaySmart: say what you need. PayPal pays only for the cart you pick.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/*
 * Literal colours are allowed in this file only. It renders through Satori outside the
 * CSS token system, which cannot read oklch or custom properties. Each hex is the sRGB
 * conversion of the globals.css token named beside it.
 */
const NIGHT = "#001435"; // --color-night oklch(19.9% 0.071 257.3)
const ON_NIGHT = "#f3f7fc"; // --color-on-night
const ON_NIGHT_SOFT = "#a5b9d4"; // --color-on-night-soft
const PAPER = "#ffffff"; // card face
const INK = "#07162c"; // --color-ink family
const LINE = "#d9e0ea"; // --color-line
const STAMP_RED = "#bb0916"; // --color-stamp-red oklch(50% 0.2 27)
const PP_BLUE = "#0066f5"; // --color-pp-blue

const CLAUSES = [
  { id: "c1", text: "Spend at most $60.00" },
  { id: "c2", text: "One gift" },
  { id: "c3", text: "A toy or gift" },
];

export default async function Image() {
  const albert = await readFile(join(process.cwd(), "src/app/_og/AlbertSans-ExtraBold.ttf"));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: NIGHT, color: ON_NIGHT, fontFamily: "Albert Sans", padding: 64 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 500 }}>
          <div style={{ display: "flex", alignItems: "center", fontSize: 28, color: ON_NIGHT_SOFT }}>
            <div style={{ display: "flex", width: 16, height: 16, background: PP_BLUE, marginRight: 14 }} />
            PaySmart
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 78, lineHeight: 1.02, letterSpacing: -3, textAlign: "left" }}>Say what you need.</div>
            <div style={{ display: "flex", flexDirection: "column", fontSize: 32, lineHeight: 1.2, marginTop: 24, color: ON_NIGHT_SOFT }}>
              <div style={{ display: "flex" }}>PayPal pays only for</div>
              <div style={{ display: "flex" }}>the cart you pick.</div>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, position: "relative", alignItems: "center", justifyContent: "center", marginLeft: 20 }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              width: 560,
              background: PAPER,
              color: INK,
              borderRadius: 28,
              padding: "36px 36px 40px",
            }}
          >
            <div style={{ display: "flex", fontSize: 24, color: PP_BLUE, marginBottom: 22 }}>Permission Slip</div>
            {CLAUSES.map((c, i) => (
              <div
                key={c.id}
                style={{ display: "flex", alignItems: "center", padding: "20px 0", borderTop: i === 0 ? `2px solid ${INK}` : `2px solid ${LINE}` }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: 22,
                    background: NIGHT,
                    color: ON_NIGHT,
                    padding: "4px 14px",
                    borderRadius: 999,
                    marginRight: 20,
                  }}
                >
                  {c.id}
                </div>
                <div style={{ display: "flex", fontSize: 32, whiteSpace: "nowrap" }}>{c.text}</div>
              </div>
            ))}
            <div style={{ display: "flex", height: 120 }} />
          </div>
          <div
            style={{
              position: "absolute",
              right: -14,
              bottom: 56,
              display: "flex",
              transform: "rotate(-3deg)",
              background: PAPER,
              padding: 8,
            }}
          >
            <div style={{ display: "flex", border: `4px solid ${STAMP_RED}`, padding: 4 }}>
              <div style={{ display: "flex", border: `4px solid ${STAMP_RED}`, padding: "10px 24px", fontSize: 48, color: STAMP_RED, letterSpacing: 2 }}>
                OUTSIDE SLIP
              </div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [{ name: "Albert Sans", data: albert, style: "normal", weight: 800 }] },
  );
}
