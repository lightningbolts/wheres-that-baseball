type ShareFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 500 | 600 | 700;
  style: "normal";
};

let fontsPromise: Promise<ShareFont[]> | null = null;

async function fetchGoogleFont(family: string, weight: number): Promise<ArrayBuffer> {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${family}:wght@${weight}&display=swap`;
  const css = await (await fetch(cssUrl)).text();
  const match = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/);
  if (!match) {
    throw new Error(`Could not load font ${family} ${weight}`);
  }
  return (await fetch(match[1])).arrayBuffer();
}

export async function loadShareImageFonts(): Promise<ShareFont[]> {
  if (!fontsPromise) {
    fontsPromise = Promise.all([
      fetchGoogleFont("IBM+Plex+Sans", 400).then((data) => ({
        name: "IBM Plex Sans",
        data,
        weight: 400 as const,
        style: "normal" as const,
      })),
      fetchGoogleFont("IBM+Plex+Sans", 600).then((data) => ({
        name: "IBM Plex Sans",
        data,
        weight: 600 as const,
        style: "normal" as const,
      })),
      fetchGoogleFont("IBM+Plex+Sans", 700).then((data) => ({
        name: "IBM Plex Sans",
        data,
        weight: 700 as const,
        style: "normal" as const,
      })),
      fetchGoogleFont("IBM+Plex+Serif", 600).then((data) => ({
        name: "IBM Plex Serif",
        data,
        weight: 600 as const,
        style: "normal" as const,
      })),
      fetchGoogleFont("JetBrains+Mono", 400).then((data) => ({
        name: "JetBrains Mono",
        data,
        weight: 400 as const,
        style: "normal" as const,
      })),
      fetchGoogleFont("JetBrains+Mono", 700).then((data) => ({
        name: "JetBrains Mono",
        data,
        weight: 700 as const,
        style: "normal" as const,
      })),
    ]);
  }
  return fontsPromise;
}

export const SHARE_FONTS = {
  sans: "'IBM Plex Sans', system-ui, sans-serif",
  serif: "'IBM Plex Serif', Georgia, serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;
