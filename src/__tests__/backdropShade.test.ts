import { describe, expect, it } from 'vitest';
import {
  pickAccent,
  relativeLuma,
  shadeBackdropPixel,
} from '../components/backdropShade';

const teal = { r: 72, g: 214, b: 196 };

describe('backdrop shade', () => {
  it('keeps a white field tinted by a teal accent instead of neutral gray', () => {
    const shaded = shadeBackdropPixel(248, 248, 248, teal);
    const luma = relativeLuma(shaded.r, shaded.g, shaded.b);
    expect(shaded.g).toBeGreaterThan(shaded.r + 28);
    expect(shaded.b).toBeGreaterThan(shaded.r + 18);
    expect(luma).toBeGreaterThan(110);
    expect(luma).toBeLessThan(175);
  });

  it('does not lift a dark cover into a bright fog', () => {
    const shaded = shadeBackdropPixel(42, 74, 36, { r: 90, g: 120, b: 40 });
    const luma = relativeLuma(shaded.r, shaded.g, shaded.b);
    expect(luma).toBeLessThan(95);
    expect(shaded.g).toBeGreaterThan(shaded.r);
  });

  it('picks the saturated motif rather than the white field', () => {
    const accent = pickAccent([
      { r: 250, g: 250, b: 250 },
      { r: 248, g: 246, b: 247 },
      teal,
    ]);
    expect(accent).toEqual(teal);
  });
});
