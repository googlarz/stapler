/**
 * PostgreSQL `integer` columns are signed 32-bit. Windows process exit codes are
 * often reported as unsigned 32-bit values (for example 0xC0000002 => 3221225474).
 * Convert those unsigned values to their signed two's-complement representation
 * before persistence so they fit in existing integer columns without crashing.
 */
export function normalizeProcessExitCodeForStorage(
  exitCode: number | null | undefined,
): number | null {
  if (typeof exitCode !== "number" || !Number.isFinite(exitCode)) return null;
  if (exitCode > 0x7fffffff && exitCode <= 0xffffffff) {
    return exitCode - 0x100000000;
  }
  return exitCode;
}
