import { Router, type Request } from "express";
import type { Db } from "@stapler/db";
import { patchInstanceExperimentalSettingsSchema, patchInstanceGeneralSettingsSchema } from "@stapler/shared";
import { forbidden, badRequest } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { instanceSettingsService, logActivity } from "../services/index.js";
import { getActorInfo } from "./authz.js";

const OLLAMA_ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);
const OLLAMA_ALLOWED_PATHS = new Set(["/api/tags", "/api/chat"]);
// Only allow localhost/loopback by default. Docker-network deployments may
// override via STAPLER_OLLAMA_ALLOWED_HOSTS (comma-separated hostnames).
const OLLAMA_ALLOWED_HOSTS: Set<string> = (() => {
  const base = new Set(["localhost", "127.0.0.1", "::1"]);
  const extra = process.env.STAPLER_OLLAMA_ALLOWED_HOSTS ?? "";
  for (const h of extra.split(",").map((s) => s.trim()).filter(Boolean)) {
    base.add(h.toLowerCase());
  }
  return base;
})();

function validateOllamaUrl(rawUrl: string, allowedPath: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw badRequest("Invalid Ollama base URL");
  }
  if (!OLLAMA_ALLOWED_PROTOCOLS.has(parsed.protocol)) {
    throw badRequest("Ollama base URL must use http or https");
  }
  const host = parsed.hostname.toLowerCase();
  if (!OLLAMA_ALLOWED_HOSTS.has(host)) {
    throw badRequest(
      `Hostname '${host}' is not allowed. Add it to STAPLER_OLLAMA_ALLOWED_HOSTS to permit it.`,
    );
  }
  if (!OLLAMA_ALLOWED_PATHS.has(allowedPath)) {
    throw badRequest(`Path '${allowedPath}' is not permitted via the proxy`);
  }
  return parsed;
}

function assertCanManageInstanceSettings(req: Request) {
  if (req.actor.type !== "board") {
    throw forbidden("Board access required");
  }
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) {
    return;
  }
  throw forbidden("Instance admin access required");
}

export function instanceSettingsRoutes(db: Db) {
  const router = Router();
  const svc = instanceSettingsService(db);

  router.get("/instance/settings/general", async (req, res) => {
    // General settings (e.g. keyboardShortcuts) are readable by any
    // authenticated board user.  Only PATCH requires instance-admin.
    if (req.actor.type !== "board") {
      throw forbidden("Board access required");
    }
    res.json(await svc.getGeneral());
  });

  router.patch(
    "/instance/settings/general",
    validate(patchInstanceGeneralSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const updated = await svc.updateGeneral(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.general_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              general: updated.general,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.general);
    },
  );

  router.get("/instance/settings/experimental", async (req, res) => {
    // Experimental settings are readable by any authenticated board user.
    // Only PATCH requires instance-admin.
    if (req.actor.type !== "board") {
      throw forbidden("Board access required");
    }
    res.json(await svc.getExperimental());
  });

  router.patch(
    "/instance/settings/experimental",
    validate(patchInstanceExperimentalSettingsSchema),
    async (req, res) => {
      assertCanManageInstanceSettings(req);
      const updated = await svc.updateExperimental(req.body);
      const actor = getActorInfo(req);
      const companyIds = await svc.listCompanyIds();
      await Promise.all(
        companyIds.map((companyId) =>
          logActivity(db, {
            companyId,
            actorType: actor.actorType,
            actorId: actor.actorId,
            agentId: actor.agentId,
            runId: actor.runId,
            action: "instance.settings.experimental_updated",
            entityType: "instance_settings",
            entityId: updated.id,
            details: {
              experimental: updated.experimental,
              changedKeys: Object.keys(req.body).sort(),
            },
          }),
        ),
      );
      res.json(updated.experimental);
    },
  );

  // ── Ollama benchmark proxy ────────────────────────────────────────────────
  // Proxies /api/tags and /api/chat to a user-supplied Ollama base URL.
  // Running this server-side lets us enforce a hostname allowlist so an
  // authenticated user cannot use the benchmark page to probe internal network
  // services from the Stapler server's network position.
  router.post("/instance/settings/ollama-proxy", async (req, res) => {
    assertCanManageInstanceSettings(req);
    const body = req.body as Record<string, unknown>;
    const rawBase = typeof body.baseUrl === "string" ? body.baseUrl.replace(/\/$/, "") : "";
    const action = body.action;

    if (action !== "tags" && action !== "chat") {
      res.status(400).json({ error: "action must be 'tags' or 'chat'" });
      return;
    }

    const apiPath = action === "tags" ? "/api/tags" : "/api/chat";
    const parsed = validateOllamaUrl(rawBase, apiPath);
    const targetUrl = `${parsed.protocol}//${parsed.host}${apiPath}`;

    const isChat = action === "chat";
    const upstream = await fetch(targetUrl, {
      method: isChat ? "POST" : "GET",
      headers: isChat ? { "Content-Type": "application/json" } : undefined,
      body: isChat && body.payload !== undefined ? JSON.stringify(body.payload) : undefined,
      signal: AbortSignal.timeout(isChat ? 120_000 : 5_000),
    });

    const upstreamBody = await upstream.json();
    res.status(upstream.status).json(upstreamBody);
  });

  return router;
}
