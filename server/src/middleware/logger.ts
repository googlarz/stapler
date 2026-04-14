import path from "node:path";
import fs from "node:fs";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { readConfigFile } from "../config-file.js";
import { resolveDefaultLogsDir, resolveHomeAwarePath } from "../home-paths.js";
import { sanitizeRecord } from "../redaction.js";

function resolveServerLogDir(): string {
  const envOverride = process.env.STAPLER_LOG_DIR?.trim();
  if (envOverride) return resolveHomeAwarePath(envOverride);

  const fileLogDir = readConfigFile()?.logging.logDir?.trim();
  if (fileLogDir) return resolveHomeAwarePath(fileLogDir);

  return resolveDefaultLogsDir();
}

const logDir = resolveServerLogDir();
fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });

const logFile = path.join(logDir, "server.log");

// Ensure the log file is owner-only (0600) even if Pino/sonic-boom creates it
// with a umask-dependent default (typically 0644). Request bodies on 4xx/5xx
// responses can contain sensitive form fields, so group/other must never read.
try {
  if (!fs.existsSync(logFile)) {
    fs.closeSync(fs.openSync(logFile, "a", 0o600));
  }
  fs.chmodSync(logFile, 0o600);
} catch {
  // Non-fatal: continue even if the chmod fails (e.g., read-only mount).
}

const sharedOpts = {
  translateTime: "SYS:HH:MM:ss",
  ignore: "pid,hostname",
  singleLine: true,
};
const requestIgnoreFields = "pid,hostname,req,res,responseTime";

export const logger = pino({
  level: "debug",
  redact: ["req.headers.authorization", "req.headers.cookie"],
}, pino.transport({
  targets: [
    {
      target: "pino-pretty",
      options: { ...sharedOpts, ignore: requestIgnoreFields, colorize: true, destination: 1 },
      level: "info",
    },
    {
      target: "pino-pretty",
      options: { ...sharedOpts, ignore: requestIgnoreFields, colorize: false, destination: logFile, mkdir: true },
      level: "debug",
    },
  ],
}));

export const httpLogger = pinoHttp({
  logger,
  customLogLevel(_req, res, err) {
    if (err || res.statusCode >= 500) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage(req, res) {
    return `${req.method} ${req.url} ${res.statusCode}`;
  },
  customErrorMessage(req, res, err) {
    const ctx = (res as any).__errorContext;
    const errMsg = ctx?.error?.message || err?.message || (res as any).err?.message || "unknown error";
    return `${req.method} ${req.url} ${res.statusCode} — ${errMsg}`;
  },
  customProps(req, res) {
    if (res.statusCode >= 400) {
      const ctx = (res as any).__errorContext;
      if (ctx) {
        return {
          errorContext: ctx.error,
          reqBody: ctx.reqBody && typeof ctx.reqBody === "object" ? sanitizeRecord(ctx.reqBody) : ctx.reqBody,
          reqParams: ctx.reqParams && typeof ctx.reqParams === "object" ? sanitizeRecord(ctx.reqParams) : ctx.reqParams,
          reqQuery: ctx.reqQuery && typeof ctx.reqQuery === "object" ? sanitizeRecord(ctx.reqQuery) : ctx.reqQuery,
        };
      }
      const props: Record<string, unknown> = {};
      const { body, params, query } = req as any;
      if (body && typeof body === "object" && Object.keys(body).length > 0) {
        props.reqBody = sanitizeRecord(body);
      }
      if (params && typeof params === "object" && Object.keys(params).length > 0) {
        props.reqParams = sanitizeRecord(params);
      }
      if (query && typeof query === "object" && Object.keys(query).length > 0) {
        props.reqQuery = sanitizeRecord(query);
      }
      if ((req as any).route?.path) {
        props.routePath = (req as any).route.path;
      }
      return props;
    }
    return {};
  },
});
