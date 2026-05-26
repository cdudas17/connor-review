import { describe, it, expect } from 'vitest';
import { hexToRgb, isDarkColor } from '../../src/lib/labelColor.js';

describe('hexToRgb', () => {
  it('parses a 6-char hex with no leading #', () => {
    expect(hexToRgb('ff0000')).toEqual({ r: 255, g: 0, b: 0 });
  });
  it('parses a 6-char hex with leading #', () => {
    expect(hexToRgb('#00ff00')).toEqual({ r: 0, g: 255, b: 0 });
  });
  it('returns 0 components for invalid input', () => {
    expect(hexToRgb('zzzzzz')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('isDarkColor', () => {
  it('treats GitHub black as dark', () => {
    expect(isDarkColor('000000')).toBe(true);
  });
  it('treats GitHub white as light', () => {
    expect(isDarkColor('ffffff')).toBe(false);
  });
  it('treats a typical "Needs initial human review" gray as light', () => {
    // ededed → YIQ ~237, well above 128
    expect(isDarkColor('ededed')).toBe(false);
  });
  it('treats a deep blue as dark', () => {
    // 0366d6 → YIQ ~99, below 128
    expect(isDarkColor('0366d6')).toBe(true);
  });
  it('treats a red label background as dark', () => {
    // d73a4a → YIQ ~95
    expect(isDarkColor('d73a4a')).toBe(true);
  });
  it('treats a yellow label as light (high green contribution)', () => {
    // fbca04 → YIQ ~204
    expect(isDarkColor('fbca04')).toBe(false);
  });
});
