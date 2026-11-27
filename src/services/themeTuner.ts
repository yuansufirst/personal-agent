export interface ThemeTunerSettings {
  hue: number;
  boardL: number;
  tileDelta: number;
  textL: number;
  borderAlpha: number; // White rim crispness (0.06 - 0.45)
  glowAlpha: number; // Outer white halo glow in dark mode (0.0 - 0.35)
  gradStrength: number; // Dark-to-vibrant color gradient opacity % (0 - 55)
  accentSat: number;
  accentLight: number;
  tileRadius: number;
  tileGap: number;
  tilePadding: number;
  tileMinHeight: number;
  customBoardHex?: string;
  customTileHex?: string;
}

export interface ThemePreset {
  id: string;
  label: string;
  settings: ThemeTunerSettings;
}

export const THEME_TUNER_STORAGE_KEY = 'relay_theme_tuner_v3';

export const DEFAULT_THEME_TUNER: ThemeTunerSettings = {
  hue: 224,
  boardL: 7.5,
  tileDelta: 4.5,
  textL: 89,
  borderAlpha: 0.16,
  glowAlpha: 0.24,
  gradStrength: 28,
  accentSat: 80,
  accentLight: 62,
  tileRadius: 22,
  tileGap: 12,
  tilePadding: 15,
  tileMinHeight: 148,
  customBoardHex: undefined,
  customTileHex: undefined,
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'ios-obsidian',
    label: '暗夜底辉',
    settings: { ...DEFAULT_THEME_TUNER },
  },
  {
    id: 'midnight-prism',
    label: '深蓝霓光',
    settings: {
      ...DEFAULT_THEME_TUNER,
      hue: 220,
      boardL: 6.5,
      tileDelta: 5.0,
      borderAlpha: 0.22,
      glowAlpha: 0.3,
      gradStrength: 36,
      accentSat: 86,
      accentLight: 60,
    },
  },
  {
    id: 'soft-graphite',
    label: '柔雾护眼',
    settings: {
      ...DEFAULT_THEME_TUNER,
      hue: 222,
      boardL: 10.5,
      tileDelta: 4.5,
      textL: 85,
      borderAlpha: 0.12,
      glowAlpha: 0.16,
      gradStrength: 20,
      accentSat: 64,
      accentLight: 65,
    },
  },
];

export const BOARD_COLOR_SWATCHES = [
  { label: '曜石', hex: '#0D1017' },
  { label: '深蓝', hex: '#0B1220' },
  { label: '石墨', hex: '#14171D' },
  { label: '墨绿', hex: '#0D1714' },
  { label: '暖炭', hex: '#171412' },
];

export const TILE_COLOR_SWATCHES = [
  { label: '暗玻璃', hex: '#161B26' },
  { label: '深海蓝', hex: '#142034' },
  { label: '墨韵紫', hex: '#1C172B' },
  { label: '暗酒红', hex: '#26151B' },
  { label: '冷炭灰', hex: '#1E232E' },
];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function isValidHex(hex?: string): hex is string {
  return typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex.trim());
}

function adjustHexBrightness(hex: string, delta: number): string {
  const clean = hex.replace('#', '');
  const r = clamp(parseInt(clean.slice(0, 2), 16) + delta, 0, 255);
  const g = clamp(parseInt(clean.slice(2, 4), 16) + delta, 0, 255);
  const b = clamp(parseInt(clean.slice(4, 6), 16) + delta, 0, 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`.toUpperCase();
}

export function hslToHex(h: number, s: number, l: number): string {
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h >= 0 && h < 60) {
    r = c; g = x; b = 0;
  } else if (h >= 60 && h < 120) {
    r = x; g = c; b = 0;
  } else if (h >= 120 && h < 180) {
    r = 0; g = c; b = x;
  } else if (h >= 180 && h < 240) {
    r = 0; g = x; b = c;
  } else if (h >= 240 && h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }

  const toHex = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export interface ComputedPalette {
  boardHex: string;
  sidebarHex: string;
  tileHex: string;
  tileHoverHex: string;
  textHex: string;
  textMutedHex: string;
  textFaintHex: string;
  accentIndigo: string;
  accentMint: string;
  accentSky: string;
  accentAmber: string;
  accentCoral: string;
  accentViolet: string;
  vividBlue: string;
  vividRed: string;
  vividEmerald: string;
  vividAmber: string;
  vividViolet: string;
  vividCyan: string;
  vividTeal: string;
  vividRose: string;
}

export function computeDarkPalette(s: ThemeTunerSettings): ComputedPalette {
  const isWarm = s.hue < 80;
  const baseSat = isWarm ? 12 : 22;
  const tileSat = isWarm ? 12 : 24;
  const textSat = isWarm ? 12 : 16;

  const boardL = clamp(s.boardL, 4, 22);
  const sidebarL = Math.max(3, boardL - 1.2);
  const tileL = clamp(boardL + s.tileDelta, boardL + 1.5, 30);
  const tileHoverL = clamp(tileL + 2.8, tileL + 1, 34);
  const textL = clamp(s.textL, 74, 96);
  const mutedL = clamp(textL - 26, 46, 70);
  const faintL = clamp(textL - 42, 32, 54);

  const sat = clamp(s.accentSat, 40, 96);
  const light = clamp(s.accentLight, 50, 76);

  const boardHex = isValidHex(s.customBoardHex)
    ? s.customBoardHex.toUpperCase()
    : hslToHex(s.hue, baseSat, boardL);

  const sidebarHex = isValidHex(s.customBoardHex)
    ? adjustHexBrightness(boardHex, -5)
    : hslToHex(s.hue, baseSat, sidebarL);

  const tileHex = isValidHex(s.customTileHex)
    ? s.customTileHex.toUpperCase()
    : hslToHex(s.hue, tileSat, tileL);

  const tileHoverHex = isValidHex(s.customTileHex)
    ? adjustHexBrightness(tileHex, 10)
    : hslToHex(s.hue, tileSat, tileHoverL);

  return {
    boardHex,
    sidebarHex,
    tileHex,
    tileHoverHex,
    textHex: hslToHex(isWarm ? 36 : 220, textSat, textL),
    textMutedHex: hslToHex(isWarm ? 32 : 220, 12, mutedL),
    textFaintHex: hslToHex(isWarm ? 30 : 220, 10, faintL),
    accentIndigo: hslToHex(224, sat, light + 6),
    accentMint: hslToHex(156, Math.max(46, sat - 6), light + 2),
    accentSky: hslToHex(199, sat, light + 3),
    accentAmber: hslToHex(36, Math.min(92, sat + 6), light + 2),
    accentCoral: hslToHex(350, Math.min(92, sat + 6), light + 3),
    accentViolet: hslToHex(264, sat, light + 6),
    // Varied saturated bottom gradient end colors
    vividBlue: hslToHex(220, Math.min(96, sat + 12), Math.max(46, light - 6)),
    vividRed: hslToHex(348, Math.min(96, sat + 12), Math.max(48, light - 4)),
    vividEmerald: hslToHex(158, Math.min(92, sat + 6), Math.max(40, light - 12)),
    vividAmber: hslToHex(32, Math.min(96, sat + 10), Math.max(48, light - 6)),
    vividViolet: hslToHex(268, Math.min(94, sat + 10), Math.max(50, light - 4)),
    vividCyan: hslToHex(196, Math.min(96, sat + 10), Math.max(44, light - 8)),
    vividTeal: hslToHex(174, Math.min(92, sat + 6), Math.max(38, light - 14)),
    vividRose: hslToHex(330, Math.min(94, sat + 10), Math.max(48, light - 4)),
  };
}

export function loadThemeTunerSettings(): ThemeTunerSettings {
  try {
    const rawV3 = localStorage.getItem(THEME_TUNER_STORAGE_KEY);
    if (rawV3) {
      const parsed = JSON.parse(rawV3) as Partial<ThemeTunerSettings>;
      return {
        hue: typeof parsed.hue === 'number' ? parsed.hue : DEFAULT_THEME_TUNER.hue,
        boardL: typeof parsed.boardL === 'number' ? parsed.boardL : DEFAULT_THEME_TUNER.boardL,
        tileDelta:
          typeof parsed.tileDelta === 'number' ? parsed.tileDelta : DEFAULT_THEME_TUNER.tileDelta,
        textL: typeof parsed.textL === 'number' ? parsed.textL : DEFAULT_THEME_TUNER.textL,
        borderAlpha:
          typeof parsed.borderAlpha === 'number'
            ? parsed.borderAlpha
            : DEFAULT_THEME_TUNER.borderAlpha,
        glowAlpha:
          typeof parsed.glowAlpha === 'number' ? parsed.glowAlpha : DEFAULT_THEME_TUNER.glowAlpha,
        gradStrength:
          typeof parsed.gradStrength === 'number'
            ? parsed.gradStrength
            : DEFAULT_THEME_TUNER.gradStrength,
        accentSat:
          typeof parsed.accentSat === 'number' ? parsed.accentSat : DEFAULT_THEME_TUNER.accentSat,
        accentLight:
          typeof parsed.accentLight === 'number'
            ? parsed.accentLight
            : DEFAULT_THEME_TUNER.accentLight,
        tileRadius:
          typeof parsed.tileRadius === 'number' ? parsed.tileRadius : DEFAULT_THEME_TUNER.tileRadius,
        tileGap: typeof parsed.tileGap === 'number' ? parsed.tileGap : DEFAULT_THEME_TUNER.tileGap,
        tilePadding:
          typeof parsed.tilePadding === 'number'
            ? parsed.tilePadding
            : DEFAULT_THEME_TUNER.tilePadding,
        tileMinHeight:
          typeof parsed.tileMinHeight === 'number'
            ? parsed.tileMinHeight
            : DEFAULT_THEME_TUNER.tileMinHeight,
        customBoardHex: isValidHex(parsed.customBoardHex) ? parsed.customBoardHex : undefined,
        customTileHex: isValidHex(parsed.customTileHex) ? parsed.customTileHex : undefined,
      };
    }

    // Preserve user-tuned tile dimensions & custom hexes from v2 while adopting new bottom-glow defaults
    const rawV2 = localStorage.getItem('relay_theme_tuner_v2');
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as Partial<ThemeTunerSettings>;
      return {
        ...DEFAULT_THEME_TUNER,
        tileRadius:
          typeof parsed.tileRadius === 'number' ? parsed.tileRadius : DEFAULT_THEME_TUNER.tileRadius,
        tileGap: typeof parsed.tileGap === 'number' ? parsed.tileGap : DEFAULT_THEME_TUNER.tileGap,
        tilePadding:
          typeof parsed.tilePadding === 'number'
            ? parsed.tilePadding
            : DEFAULT_THEME_TUNER.tilePadding,
        tileMinHeight:
          typeof parsed.tileMinHeight === 'number'
            ? parsed.tileMinHeight
            : DEFAULT_THEME_TUNER.tileMinHeight,
        customBoardHex: isValidHex(parsed.customBoardHex) ? parsed.customBoardHex : undefined,
        customTileHex: isValidHex(parsed.customTileHex) ? parsed.customTileHex : undefined,
      };
    }
    return { ...DEFAULT_THEME_TUNER };
  } catch {
    return { ...DEFAULT_THEME_TUNER };
  }
}

export function saveThemeTunerSettings(settings: ThemeTunerSettings): void {
  try {
    localStorage.setItem(THEME_TUNER_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage quota errors
  }
}

export function applyThemeTunerToDocument(settings: ThemeTunerSettings): ComputedPalette {
  const palette = computeDarkPalette(settings);
  const root = document.documentElement;

  const rimAlpha = clamp(settings.borderAlpha, 0.06, 0.45);
  const glowAlpha = clamp(settings.glowAlpha, 0, 0.45);
  const gradPct = clamp(settings.gradStrength, 0, 56);

  root.style.setProperty('--relay-dark-bg', palette.boardHex);
  root.style.setProperty('--relay-dark-sidebar', palette.sidebarHex);
  root.style.setProperty('--relay-dark-tile', palette.tileHex);
  root.style.setProperty('--relay-dark-tile-hover', palette.tileHoverHex);
  // Keep top/side borders crisp & understated so top never looks muddy; concentrate bright rim at bottom
  root.style.setProperty(
    '--relay-dark-tile-border',
    `rgba(255, 255, 255, ${Math.min(0.2, rimAlpha * 0.72).toFixed(3)})`
  );
  root.style.setProperty(
    '--relay-dark-rim-bottom',
    `rgba(255, 255, 255, ${Math.min(0.72, rimAlpha * 2.55).toFixed(3)})`
  );
  root.style.setProperty(
    '--relay-dark-glow',
    `rgba(255, 255, 255, ${glowAlpha.toFixed(3)})`
  );
  root.style.setProperty('--relay-grad-pct', `${gradPct}%`);

  root.style.setProperty('--relay-dark-text', palette.textHex);
  root.style.setProperty('--relay-dark-text-muted', palette.textMutedHex);
  root.style.setProperty('--relay-dark-text-faint', palette.textFaintHex);

  root.style.setProperty('--accent-indigo', palette.accentIndigo);
  root.style.setProperty('--accent-mint', palette.accentMint);
  root.style.setProperty('--accent-sky', palette.accentSky);
  root.style.setProperty('--accent-amber', palette.accentAmber);
  root.style.setProperty('--accent-coral', palette.accentCoral);
  root.style.setProperty('--accent-violet', palette.accentViolet);

  root.style.setProperty('--tint-blue', palette.vividBlue);
  root.style.setProperty('--tint-red', palette.vividRed);
  root.style.setProperty('--tint-emerald', palette.vividEmerald);
  root.style.setProperty('--tint-amber', palette.vividAmber);
  root.style.setProperty('--tint-violet', palette.vividViolet);
  root.style.setProperty('--tint-cyan', palette.vividCyan);
  root.style.setProperty('--tint-teal', palette.vividTeal);
  root.style.setProperty('--tint-rose', palette.vividRose);

  root.style.setProperty('--relay-radius', `${clamp(settings.tileRadius, 10, 32)}px`);
  root.style.setProperty('--relay-gap', `${clamp(settings.tileGap, 6, 24)}px`);
  root.style.setProperty('--relay-tile-pad', `${clamp(settings.tilePadding, 10, 26)}px`);
  root.style.setProperty('--relay-tile-min-h', `${clamp(settings.tileMinHeight, 110, 240)}px`);

  return palette;
}

export function formatThemeExport(settings: ThemeTunerSettings): string {
  const palette = computeDarkPalette(settings);
  return JSON.stringify(
    {
      tuner: settings,
      colors: {
        board: palette.boardHex,
        tile: palette.tileHex,
        text: palette.textHex,
        vividBlue: palette.vividBlue,
        vividRed: palette.vividRed,
        vividEmerald: palette.vividEmerald,
        vividAmber: palette.vividAmber,
      },
      glow: {
        rimAlpha: settings.borderAlpha,
        haloAlpha: settings.glowAlpha,
        gradientPercent: settings.gradStrength,
      },
      size: {
        tileRadius: settings.tileRadius,
        tileGap: settings.tileGap,
        tilePadding: settings.tilePadding,
        tileMinHeight: settings.tileMinHeight,
      },
    },
    null,
    2
  );
}
