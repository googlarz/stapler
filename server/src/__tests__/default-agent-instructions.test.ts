import { describe, it, expect } from "vitest";
import { resolveDefaultAgentInstructionsBundleRole } from "../services/default-agent-instructions.js";

// loadDefaultAgentInstructionsBundle is async and reads bundled files via import.meta.url.
// It is not a pure function (performs I/O), so it is excluded from unit tests.
// resolveDefaultAgentInstructionsBundleRole is pure and fully testable.

describe("resolveDefaultAgentInstructionsBundleRole", () => {
  describe("known roles", () => {
    it('returns "ceo" for input "ceo"', () => {
      expect(resolveDefaultAgentInstructionsBundleRole("ceo")).toBe("ceo");
    });

    it('returns "coo" for input "coo"', () => {
      expect(resolveDefaultAgentInstructionsBundleRole("coo")).toBe("coo");
    });
  });

  describe("default fallback", () => {
    it('returns "default" for an unknown role string', () => {
      expect(resolveDefaultAgentInstructionsBundleRole("engineer")).toBe("default");
    });

    it('returns "default" for an empty string', () => {
      expect(resolveDefaultAgentInstructionsBundleRole("")).toBe("default");
    });

    it('returns "default" for a random string', () => {
      expect(resolveDefaultAgentInstructionsBundleRole("anything-else")).toBe("default");
    });

    it('returns "default" for "CEO" (case-sensitive)', () => {
      expect(resolveDefaultAgentInstructionsBundleRole("CEO")).toBe("default");
    });

    it('returns "default" for "COO" (case-sensitive)', () => {
      expect(resolveDefaultAgentInstructionsBundleRole("COO")).toBe("default");
    });
  });

  describe("edge cases", () => {
    it('returns "default" for whitespace-only string', () => {
      expect(resolveDefaultAgentInstructionsBundleRole("   ")).toBe("default");
    });

    it('returns "default" for "ceo " with trailing space', () => {
      expect(resolveDefaultAgentInstructionsBundleRole("ceo ")).toBe("default");
    });
  });
});
