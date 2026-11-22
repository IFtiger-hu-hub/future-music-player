export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function relativeLuma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** Most chromatic swatch, including bright accent colors but not near-white. */
export function pickAccent(pixels: Rgb[]): Rgb {
  let maxSat = -1;
  let best: Rgb = { r: 220, g: 80, b: 100 };
  for (const { r, g, b } of pixels) {
    const luma = relativeLuma(r, g, b);
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    if (sat > maxSat && luma > 24 && luma < 252) {
      maxSat = sat;
      best = { r, g, b };
    }
  }
  return best;
}

/**
 * Mid-tone the blurred cover so white type stays readable, and lend neutral
 * pixels the cover accent so a small motif on white does not blur into gray.
 */
export function shadeBackdropPixel(
  r: number,
  g: number,
  b: number,
  accent: Rgb
): Rgb {
  const luma = relativeLuma(r, g, b);
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  const neutral = sat < 46 ? 1 - sat / 46 : 0;
  const mix = neutral * 0.55;
  const r1 = r + (accent.r - r) * mix;
  const g1 = g + (accent.g - g) * mix;
  const b1 = b + (accent.b - b) * mix;
  const luma1 = relativeLuma(r1, g1, b1);
  const chroma = 1.45;
  const gain = 0.66;
  const bias = 4;
  return {
    r: clampByte((luma1 + (r1 - luma1) * chroma) * gain + bias),
    g: clampByte((luma1 + (g1 - luma1) * chroma) * gain + bias),
    b: clampByte((luma1 + (b1 - luma1) * chroma) * gain + bias),
  };
}

export function glowCss(accent: Rgb): string {
  return `rgba(${accent.r}, ${accent.g}, ${accent.b}, 0.42)`;
}
