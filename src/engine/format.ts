/**
 * Number formatting for audit-trail strings only.
 *
 * This exists so that the workings read as arithmetic a reviewer can check by
 * hand, rather than as binary floating-point artefacts (0.0070950000000000005).
 * It never touches a computed result — only the human-readable copy of it.
 */

/** Significant digits kept in audit strings. Enough to re-derive by hand. */
const AUDIT_SIGNIFICANT_DIGITS = 12;

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return String(value);
  }
  if (value === 0) {
    return '0';
  }
  return Number(value.toPrecision(AUDIT_SIGNIFICANT_DIGITS)).toString();
}
