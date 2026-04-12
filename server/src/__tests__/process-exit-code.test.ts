import { describe, expect, it } from "vitest";
import { normalizeProcessExitCodeForStorage } from "../lib/process-exit-code.js";

describe("normalizeProcessExitCodeForStorage", () => {
  it("preserves nullish values", () => {
    expect(normalizeProcessExitCodeForStorage(null)).toBe(null);
    expect(normalizeProcessExitCodeForStorage(undefined)).toBe(null);
  });

  it("leaves normal signed exit codes unchanged", () => {
    expect(normalizeProcessExitCodeForStorage(0)).toBe(0);
    expect(normalizeProcessExitCodeForStorage(53)).toBe(53);
    expect(normalizeProcessExitCodeForStorage(-1)).toBe(-1);
  });

  it("converts unsigned 32-bit Windows exit codes to signed 32-bit values", () => {
    expect(normalizeProcessExitCodeForStorage(3_221_225_794)).toBe(-1_073_741_502);
    expect(normalizeProcessExitCodeForStorage(0xffffffff)).toBe(-1);
  });
});
