import type { PaperclipPluginManifestV1 } from "@stapler/plugin-sdk";

export const PLUGIN_ID = "paperclip.slack-sync";
export const PLUGIN_VERSION = "0.1.0";
export const WEBHOOK_KEY = "slack-events";
export const JOB_KEY = "init-sync";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Slack Sync",
  description:
    "Syncs Paperclip projects to Slack channels and issues to threads. " +
    "Supports bi-directional sync: Slack @mentions write back to Paperclip issue comments.",
  author: "Paperclip",
  categories: ["connector"],
  capabilities: [
    "events.subscribe",
    "projects.read",
    "issues.read",
    "issue.comments.read",
    "issue.comments.create",
    "plugin.state.read",
    "plugin.state.write",
    "http.outbound",
    "secrets.read-ref",
    "webhooks.receive",
    "jobs.schedule",
    "activity.log.write",
  ],
  instanceConfigSchema: {
    type: "object",
    properties: {
      slackBotToken: {
        type: "string",
        title: "Slack Bot Token (secret ref)",
        description: "Secret reference for the Slack Bot OAuth token (xoxb-...)",
      },
      channelPrefix: {
        type: "string",
        title: "Channel Name Prefix",
        description: "Prefix for auto-created Slack channels",
        default: "proj-",
      },
      inviteUserIds: {
        type: "array",
        title: "Auto-invite User IDs",
        description: "Slack user IDs to auto-invite when creating channels",
        items: { type: "string" },
        default: [],
      },
    },
    required: ["slackBotToken"],
  },
  webhooks: [
    {
      endpointKey: WEBHOOK_KEY,
      displayName: "Slack Events",
      description:
        "Receives Slack Events API callbacks (url_verification, app_mention).",
    },
  ],
  jobs: [
    {
      jobKey: JOB_KEY,
      displayName: "Initial Sync",
      description:
        "Scans all existing projects and creates Slack channels for any that are missing. Run manually after first install.",
    },
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
};

export default manifest;
