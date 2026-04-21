import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "@stapler/shared",
    environment: "node",
  },
});
