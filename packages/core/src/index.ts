/**
 * @carto-a11y/core — the CartoAccessibility-Studio engine.
 *
 * Pure, DOM-free building blocks for auditing web-map styles.
 */

export {
  LUMINANCE_WEIGHTS,
  contrastRatio,
  linearToSrgb,
  relativeLuminance,
  srgbToLinear,
} from './color/wcag.js';

export type { RGB } from './color/parse.js';
export { CSS_NAMED_COLORS, parseColor, rgbToHex } from './color/parse.js';

export type { Lab } from './color/lab.js';
export { D65_WHITE, ciede2000, rgbToLab, srgbToXyz, xyzToLab } from './color/lab.js';

export type { CVDType, Matrix3x3 } from './color/cvd.js';
export { CVD_MATRICES, simulateCVD } from './color/cvd.js';

export type { MapClass } from './style/extract.js';
export { extractClasses } from './style/extract.js';

export type { AuditOptions, AuditPair, AuditResult, VisionMode } from './audit/index.js';
export {
  DEFAULT_THRESHOLD,
  VISION_MODES,
  compositeOver,
  runAudit,
} from './audit/index.js';

export type { ReportData } from './export/report.js';
export { generateHtmlReport, generateJsonReport } from './export/report.js';

export type { PlainSummary, VerdictLevel } from './export/language.js';
export {
  ABOUT_TEXT,
  VISION_MODE_AUDIENCE,
  VISION_MODE_LABELS,
  VISION_MODE_SHORT,
  clashSentence,
  humaniseClassId,
  summariseAudit,
} from './export/language.js';
