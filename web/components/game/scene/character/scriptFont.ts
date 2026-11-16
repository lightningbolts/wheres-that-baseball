/**
 * The script face for chest lettering: Lobster (SIL Open Font License 1.1), self-hosted by
 * next/font like the site's other faces, so no jersey depends on a font installed on the
 * viewer's machine. Kept apart from paint.ts so the painter stays importable outside Next;
 * until this loads (or if it never does) the painter uses system scripts.
 */
import { Lobster } from "next/font/google";
import { setScriptFont } from "@/components/game/scene/character/uniforms";

const lobster = Lobster({ weight: "400", subsets: ["latin"], display: "swap", preload: false });

let asked = false;

/** Start loading the script face (once); uniforms repaint with it when it arrives. */
export function loadScriptFont(): void {
  if (asked || typeof document === "undefined" || !document.fonts) return;
  asked = true;
  const family = lobster.style.fontFamily;
  document.fonts
    .load(`48px ${family}`, "Dodgers")
    .then((faces) => {
      if (faces.length) setScriptFont(family);
    })
    .catch(() => {});
}
