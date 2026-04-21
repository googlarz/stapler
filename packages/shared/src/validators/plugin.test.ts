import { describe, it, expect } from "vitest";
import {
  jsonSchemaSchema,
  pluginJobDeclarationSchema,
  pluginWebhookDeclarationSchema,
  pluginToolDeclarationSchema,
  pluginUiSlotDeclarationSchema,
  pluginLauncherActionDeclarationSchema,
  pluginLauncherRenderDeclarationSchema,
  pluginLauncherDeclarationSchema,
  pluginManifestV1Schema,
  installPluginSchema,
  updatePluginStatusSchema,
  uninstallPluginSchema,
} from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseManifest = {
  id: "my-plugin",
  apiVersion: 1 as const,
  version: "1.0.0",
  displayName: "My Plugin",
  description: "A test plugin",
  author: "Test Author",
  categories: ["connector"] as const,
  capabilities: ["companies.read"] as const,
  entrypoints: { worker: "dist/worker.js" },
};

// ---------------------------------------------------------------------------
// jsonSchemaSchema
// ---------------------------------------------------------------------------

describe("jsonSchemaSchema", () => {
  it("accepts an empty object", () => {
    expect(jsonSchemaSchema.safeParse({}).success).toBe(true);
  });

  it("accepts an object with type field", () => {
    expect(jsonSchemaSchema.safeParse({ type: "object" }).success).toBe(true);
  });

  it("accepts an object with $ref field", () => {
    expect(jsonSchemaSchema.safeParse({ $ref: "#/definitions/Foo" }).success).toBe(true);
  });

  it("accepts an object with oneOf field", () => {
    expect(jsonSchemaSchema.safeParse({ oneOf: [] }).success).toBe(true);
  });

  it("accepts an object with anyOf field", () => {
    expect(jsonSchemaSchema.safeParse({ anyOf: [] }).success).toBe(true);
  });

  it("accepts an object with allOf field", () => {
    expect(jsonSchemaSchema.safeParse({ allOf: [] }).success).toBe(true);
  });

  it("rejects a non-empty object without type/$ref/composition keyword", () => {
    const result = jsonSchemaSchema.safeParse({ properties: { foo: {} } });
    expect(result.success).toBe(false);
  });

  it("rejects object where type is not a string", () => {
    const result = jsonSchemaSchema.safeParse({ type: 42 });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pluginJobDeclarationSchema
// ---------------------------------------------------------------------------

describe("pluginJobDeclarationSchema", () => {
  it("accepts minimal valid job declaration", () => {
    expect(pluginJobDeclarationSchema.safeParse({ jobKey: "sync", displayName: "Sync" }).success).toBe(true);
  });

  it("accepts job with optional description and schedule", () => {
    const result = pluginJobDeclarationSchema.safeParse({
      jobKey: "sync",
      displayName: "Sync",
      description: "Syncs data",
      schedule: "*/15 * * * *",
    });
    expect(result.success).toBe(true);
  });

  it("accepts various valid cron expressions", () => {
    const validCrons = [
      "0 * * * *",
      "0 0 * * *",
      "*/5 * * * *",
      "0 9-17 * * 1-5",
      "0,30 * * * *",
      "0 0 1 * *",
    ];
    for (const schedule of validCrons) {
      expect(pluginJobDeclarationSchema.safeParse({ jobKey: "j", displayName: "J", schedule }).success).toBe(true);
    }
  });

  it("rejects cron with fewer than 5 fields", () => {
    const result = pluginJobDeclarationSchema.safeParse({ jobKey: "j", displayName: "J", schedule: "* * * *" });
    expect(result.success).toBe(false);
  });

  it("rejects cron with more than 5 fields", () => {
    const result = pluginJobDeclarationSchema.safeParse({ jobKey: "j", displayName: "J", schedule: "* * * * * *" });
    expect(result.success).toBe(false);
  });

  it("rejects empty cron string", () => {
    const result = pluginJobDeclarationSchema.safeParse({ jobKey: "j", displayName: "J", schedule: "" });
    expect(result.success).toBe(false);
  });

  it("rejects missing jobKey", () => {
    expect(pluginJobDeclarationSchema.safeParse({ displayName: "Sync" }).success).toBe(false);
  });

  it("rejects missing displayName", () => {
    expect(pluginJobDeclarationSchema.safeParse({ jobKey: "sync" }).success).toBe(false);
  });

  it("rejects empty jobKey", () => {
    expect(pluginJobDeclarationSchema.safeParse({ jobKey: "", displayName: "Sync" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pluginWebhookDeclarationSchema
// ---------------------------------------------------------------------------

describe("pluginWebhookDeclarationSchema", () => {
  it("accepts valid webhook declaration", () => {
    expect(pluginWebhookDeclarationSchema.safeParse({ endpointKey: "gh", displayName: "GitHub" }).success).toBe(true);
  });

  it("rejects missing endpointKey", () => {
    expect(pluginWebhookDeclarationSchema.safeParse({ displayName: "GitHub" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pluginToolDeclarationSchema
// ---------------------------------------------------------------------------

describe("pluginToolDeclarationSchema", () => {
  it("accepts valid tool declaration", () => {
    expect(pluginToolDeclarationSchema.safeParse({
      name: "search",
      displayName: "Search",
      description: "Searches things",
      parametersSchema: { type: "object" },
    }).success).toBe(true);
  });

  it("rejects invalid parametersSchema", () => {
    const result = pluginToolDeclarationSchema.safeParse({
      name: "search",
      displayName: "Search",
      description: "Searches things",
      parametersSchema: { properties: {} },
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pluginUiSlotDeclarationSchema
// ---------------------------------------------------------------------------

describe("pluginUiSlotDeclarationSchema", () => {
  it("accepts a page slot without entityTypes", () => {
    expect(pluginUiSlotDeclarationSchema.safeParse({
      type: "page",
      id: "my-page",
      displayName: "My Page",
      exportName: "MyPage",
    }).success).toBe(true);
  });

  it("accepts a detailTab slot with entityTypes", () => {
    expect(pluginUiSlotDeclarationSchema.safeParse({
      type: "detailTab",
      id: "my-tab",
      displayName: "My Tab",
      exportName: "MyTab",
      entityTypes: ["issue"],
    }).success).toBe(true);
  });

  it("rejects detailTab without entityTypes", () => {
    const result = pluginUiSlotDeclarationSchema.safeParse({
      type: "detailTab",
      id: "my-tab",
      displayName: "My Tab",
      exportName: "MyTab",
    });
    expect(result.success).toBe(false);
  });

  it("rejects contextMenuItem without entityTypes", () => {
    const result = pluginUiSlotDeclarationSchema.safeParse({
      type: "contextMenuItem",
      id: "my-action",
      displayName: "My Action",
      exportName: "MyAction",
    });
    expect(result.success).toBe(false);
  });

  it("rejects projectSidebarItem without 'project' in entityTypes", () => {
    const result = pluginUiSlotDeclarationSchema.safeParse({
      type: "projectSidebarItem",
      id: "my-item",
      displayName: "My Item",
      exportName: "MyItem",
      entityTypes: ["issue"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts projectSidebarItem with 'project' entityType", () => {
    expect(pluginUiSlotDeclarationSchema.safeParse({
      type: "projectSidebarItem",
      id: "my-item",
      displayName: "My Item",
      exportName: "MyItem",
      entityTypes: ["project"],
    }).success).toBe(true);
  });

  it("rejects commentAnnotation without 'comment' in entityTypes", () => {
    const result = pluginUiSlotDeclarationSchema.safeParse({
      type: "commentAnnotation",
      id: "my-annotation",
      displayName: "My Annotation",
      exportName: "MyAnnotation",
      entityTypes: ["issue"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts commentAnnotation with 'comment' entityType", () => {
    expect(pluginUiSlotDeclarationSchema.safeParse({
      type: "commentAnnotation",
      id: "my-annotation",
      displayName: "My Annotation",
      exportName: "MyAnnotation",
      entityTypes: ["comment"],
    }).success).toBe(true);
  });

  it("rejects routePath on non-page slots", () => {
    const result = pluginUiSlotDeclarationSchema.safeParse({
      type: "sidebar",
      id: "my-sidebar",
      displayName: "My Sidebar",
      exportName: "MySidebar",
      routePath: "my-route",
    });
    expect(result.success).toBe(false);
  });

  it("accepts routePath on page slots", () => {
    expect(pluginUiSlotDeclarationSchema.safeParse({
      type: "page",
      id: "my-page",
      displayName: "My Page",
      exportName: "MyPage",
      routePath: "my-page",
    }).success).toBe(true);
  });

  it("rejects reserved routePath on page slots", () => {
    const result = pluginUiSlotDeclarationSchema.safeParse({
      type: "page",
      id: "my-page",
      displayName: "My Page",
      exportName: "MyPage",
      routePath: "settings",
    });
    expect(result.success).toBe(false);
  });

  it("rejects routePath with uppercase letters", () => {
    const result = pluginUiSlotDeclarationSchema.safeParse({
      type: "page",
      id: "my-page",
      displayName: "My Page",
      exportName: "MyPage",
      routePath: "MyPage",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pluginLauncherActionDeclarationSchema
// ---------------------------------------------------------------------------

describe("pluginLauncherActionDeclarationSchema", () => {
  it("accepts a navigate action with relative target", () => {
    expect(pluginLauncherActionDeclarationSchema.safeParse({
      type: "navigate",
      target: "/dashboard",
    }).success).toBe(true);
  });

  it("rejects navigate with absolute URL target", () => {
    const result = pluginLauncherActionDeclarationSchema.safeParse({
      type: "navigate",
      target: "https://example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects navigate with http:// absolute URL", () => {
    const result = pluginLauncherActionDeclarationSchema.safeParse({
      type: "navigate",
      target: "http://example.com",
    });
    expect(result.success).toBe(false);
  });

  it("accepts performAction with a simple key", () => {
    expect(pluginLauncherActionDeclarationSchema.safeParse({
      type: "performAction",
      target: "sync-data",
    }).success).toBe(true);
  });

  it("rejects performAction with a slash in target", () => {
    const result = pluginLauncherActionDeclarationSchema.safeParse({
      type: "performAction",
      target: "some/route",
    });
    expect(result.success).toBe(false);
  });

  it("accepts openModal action", () => {
    expect(pluginLauncherActionDeclarationSchema.safeParse({
      type: "openModal",
      target: "MyModal",
    }).success).toBe(true);
  });

  it("accepts deepLink action", () => {
    expect(pluginLauncherActionDeclarationSchema.safeParse({
      type: "deepLink",
      target: "my-plugin://open",
    }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pluginLauncherRenderDeclarationSchema
// ---------------------------------------------------------------------------

describe("pluginLauncherRenderDeclarationSchema", () => {
  it("accepts valid environment without bounds", () => {
    expect(pluginLauncherRenderDeclarationSchema.safeParse({ environment: "hostOverlay" }).success).toBe(true);
  });

  it("accepts valid environment with supported bounds", () => {
    expect(pluginLauncherRenderDeclarationSchema.safeParse({ environment: "hostOverlay", bounds: "wide" }).success).toBe(true);
  });

  it("rejects bounds not supported for environment", () => {
    // hostInline only supports inline, compact, default — not wide
    const result = pluginLauncherRenderDeclarationSchema.safeParse({ environment: "hostInline", bounds: "wide" });
    expect(result.success).toBe(false);
  });

  it("rejects unsupported bounds for external environment", () => {
    // external has no supported bounds
    const result = pluginLauncherRenderDeclarationSchema.safeParse({ environment: "external", bounds: "compact" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// pluginManifestV1Schema — minimum valid manifest
// ---------------------------------------------------------------------------

describe("pluginManifestV1Schema — valid minimum manifest", () => {
  it("accepts a minimum valid manifest", () => {
    expect(pluginManifestV1Schema.safeParse(baseManifest).success).toBe(true);
  });

  it("accepts manifest with semver pre-release version", () => {
    expect(pluginManifestV1Schema.safeParse({ ...baseManifest, version: "1.0.0-beta.1" }).success).toBe(true);
  });

  it("rejects id starting with uppercase", () => {
    const result = pluginManifestV1Schema.safeParse({ ...baseManifest, id: "MyPlugin" });
    expect(result.success).toBe(false);
  });

  it("rejects id with spaces", () => {
    const result = pluginManifestV1Schema.safeParse({ ...baseManifest, id: "my plugin" });
    expect(result.success).toBe(false);
  });

  it("rejects apiVersion !== 1", () => {
    const result = pluginManifestV1Schema.safeParse({ ...baseManifest, apiVersion: 2 });
    expect(result.success).toBe(false);
  });

  it("rejects non-semver version string", () => {
    const result = pluginManifestV1Schema.safeParse({ ...baseManifest, version: "v1.0" });
    expect(result.success).toBe(false);
  });

  it("rejects version with leading v", () => {
    const result = pluginManifestV1Schema.safeParse({ ...baseManifest, version: "v1.0.0" });
    expect(result.success).toBe(false);
  });

  it("rejects empty categories array", () => {
    const result = pluginManifestV1Schema.safeParse({ ...baseManifest, categories: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const result = pluginManifestV1Schema.safeParse({ ...baseManifest, categories: ["invalid-cat"] });
    expect(result.success).toBe(false);
  });

  it("rejects empty capabilities array", () => {
    const result = pluginManifestV1Schema.safeParse({ ...baseManifest, capabilities: [] });
    expect(result.success).toBe(false);
  });

  it("rejects missing entrypoints.worker", () => {
    const result = pluginManifestV1Schema.safeParse({ ...baseManifest, entrypoints: {} });
    expect(result.success).toBe(false);
  });

  it("accepts valid minimumHostVersion", () => {
    expect(pluginManifestV1Schema.safeParse({ ...baseManifest, minimumHostVersion: "2.0.0" }).success).toBe(true);
  });

  it("rejects minimumHostVersion with leading v", () => {
    const result = pluginManifestV1Schema.safeParse({ ...baseManifest, minimumHostVersion: "v2.0.0" });
    expect(result.success).toBe(false);
  });

  it("rejects when minimumHostVersion and minimumPaperclipVersion differ", () => {
    const result = pluginManifestV1Schema.safeParse({
      ...baseManifest,
      minimumHostVersion: "1.0.0",
      minimumPaperclipVersion: "2.0.0",
    });
    expect(result.success).toBe(false);
  });

  it("accepts when minimumHostVersion and minimumPaperclipVersion match", () => {
    expect(pluginManifestV1Schema.safeParse({
      ...baseManifest,
      minimumHostVersion: "1.0.0",
      minimumPaperclipVersion: "1.0.0",
    }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pluginManifestV1Schema — cross-field capability checks
// ---------------------------------------------------------------------------

describe("pluginManifestV1Schema — capability cross-field checks", () => {
  it("rejects tools declared without agent.tools.register capability", () => {
    const result = pluginManifestV1Schema.safeParse({
      ...baseManifest,
      tools: [{ name: "search", displayName: "Search", description: "desc", parametersSchema: { type: "object" } }],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("agent.tools.register");
  });

  it("accepts tools declared with agent.tools.register capability", () => {
    expect(pluginManifestV1Schema.safeParse({
      ...baseManifest,
      capabilities: ["agent.tools.register"],
      tools: [{ name: "search", displayName: "Search", description: "desc", parametersSchema: { type: "object" } }],
    }).success).toBe(true);
  });

  it("rejects jobs declared without jobs.schedule capability", () => {
    const result = pluginManifestV1Schema.safeParse({
      ...baseManifest,
      jobs: [{ jobKey: "sync", displayName: "Sync" }],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("jobs.schedule");
  });

  it("accepts jobs declared with jobs.schedule capability", () => {
    expect(pluginManifestV1Schema.safeParse({
      ...baseManifest,
      capabilities: ["jobs.schedule"],
      jobs: [{ jobKey: "sync", displayName: "Sync" }],
    }).success).toBe(true);
  });

  it("rejects webhooks declared without webhooks.receive capability", () => {
    const result = pluginManifestV1Schema.safeParse({
      ...baseManifest,
      webhooks: [{ endpointKey: "gh", displayName: "GitHub" }],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("webhooks.receive");
  });

  it("accepts webhooks declared with webhooks.receive capability", () => {
    expect(pluginManifestV1Schema.safeParse({
      ...baseManifest,
      capabilities: ["webhooks.receive"],
      webhooks: [{ endpointKey: "gh", displayName: "GitHub" }],
    }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pluginManifestV1Schema — UI entrypoints cross-field checks
// ---------------------------------------------------------------------------

describe("pluginManifestV1Schema — entrypoints.ui required when ui.slots declared", () => {
  it("rejects ui.slots without entrypoints.ui", () => {
    const result = pluginManifestV1Schema.safeParse({
      ...baseManifest,
      ui: {
        slots: [{ type: "page", id: "my-page", displayName: "My Page", exportName: "MyPage" }],
      },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("entrypoints.ui");
  });

  it("accepts ui.slots with entrypoints.ui", () => {
    expect(pluginManifestV1Schema.safeParse({
      ...baseManifest,
      entrypoints: { worker: "dist/worker.js", ui: "dist/ui.js" },
      ui: {
        slots: [{ type: "page", id: "my-page", displayName: "My Page", exportName: "MyPage" }],
      },
    }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// pluginManifestV1Schema — uniqueness checks
// ---------------------------------------------------------------------------

describe("pluginManifestV1Schema — uniqueness checks", () => {
  it("rejects duplicate job keys", () => {
    const result = pluginManifestV1Schema.safeParse({
      ...baseManifest,
      capabilities: ["jobs.schedule"],
      jobs: [
        { jobKey: "sync", displayName: "Sync 1" },
        { jobKey: "sync", displayName: "Sync 2" },
      ],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("Duplicate job keys");
  });

  it("rejects duplicate tool names", () => {
    const result = pluginManifestV1Schema.safeParse({
      ...baseManifest,
      capabilities: ["agent.tools.register"],
      tools: [
        { name: "search", displayName: "Search 1", description: "desc", parametersSchema: { type: "object" } },
        { name: "search", displayName: "Search 2", description: "desc", parametersSchema: { type: "object" } },
      ],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("Duplicate tool names");
  });

  it("rejects duplicate webhook endpoint keys", () => {
    const result = pluginManifestV1Schema.safeParse({
      ...baseManifest,
      capabilities: ["webhooks.receive"],
      webhooks: [
        { endpointKey: "gh", displayName: "GitHub 1" },
        { endpointKey: "gh", displayName: "GitHub 2" },
      ],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("Duplicate webhook endpoint keys");
  });

  it("rejects duplicate UI slot ids", () => {
    const result = pluginManifestV1Schema.safeParse({
      ...baseManifest,
      entrypoints: { worker: "dist/worker.js", ui: "dist/ui.js" },
      ui: {
        slots: [
          { type: "page", id: "my-page", displayName: "Page 1", exportName: "Page1" },
          { type: "page", id: "my-page", displayName: "Page 2", exportName: "Page2" },
        ],
      },
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).toContain("Duplicate UI slot ids");
  });
});

// ---------------------------------------------------------------------------
// installPluginSchema
// ---------------------------------------------------------------------------

describe("installPluginSchema", () => {
  it("accepts packageName only", () => {
    expect(installPluginSchema.safeParse({ packageName: "@my/plugin" }).success).toBe(true);
  });

  it("accepts packageName with version and path", () => {
    expect(installPluginSchema.safeParse({ packageName: "@my/plugin", version: "1.0.0", packagePath: "/plugins/my" }).success).toBe(true);
  });

  it("rejects empty packageName", () => {
    expect(installPluginSchema.safeParse({ packageName: "" }).success).toBe(false);
  });

  it("rejects missing packageName", () => {
    expect(installPluginSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// updatePluginStatusSchema
// ---------------------------------------------------------------------------

describe("updatePluginStatusSchema", () => {
  it("accepts valid status", () => {
    expect(updatePluginStatusSchema.safeParse({ status: "ready" }).success).toBe(true);
  });

  it("accepts status with lastError null", () => {
    expect(updatePluginStatusSchema.safeParse({ status: "error", lastError: null }).success).toBe(true);
  });

  it("accepts status with lastError string", () => {
    expect(updatePluginStatusSchema.safeParse({ status: "error", lastError: "something broke" }).success).toBe(true);
  });

  it("rejects invalid status", () => {
    expect(updatePluginStatusSchema.safeParse({ status: "broken" }).success).toBe(false);
  });

  it("rejects missing status", () => {
    expect(updatePluginStatusSchema.safeParse({}).success).toBe(false);
  });

  it("accepts all valid statuses", () => {
    const statuses = ["installed", "ready", "disabled", "error", "upgrade_pending", "uninstalled"] as const;
    for (const status of statuses) {
      expect(updatePluginStatusSchema.safeParse({ status }).success).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// uninstallPluginSchema
// ---------------------------------------------------------------------------

describe("uninstallPluginSchema", () => {
  it("accepts empty object with default removeData=false", () => {
    const result = uninstallPluginSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.removeData).toBe(false);
  });

  it("accepts removeData: true", () => {
    const result = uninstallPluginSchema.safeParse({ removeData: true });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.removeData).toBe(true);
  });

  it("accepts removeData: false", () => {
    expect(uninstallPluginSchema.safeParse({ removeData: false }).success).toBe(true);
  });

  it("rejects non-boolean removeData", () => {
    expect(uninstallPluginSchema.safeParse({ removeData: "yes" }).success).toBe(false);
  });
});
