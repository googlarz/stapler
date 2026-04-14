/**
 * Thin wrapper around the Slack Web API.
 * Uses plain fetch — no SDK dependency needed.
 */

const SLACK_API = "https://slack.com/api";

export interface SlackChannel {
  id: string;
  name: string;
}

export interface SlackMessage {
  ts: string;
  channel: string;
}

export interface SlackReply {
  user: string;
  text: string;
  ts: string;
}

export class SlackClient {
  constructor(private token: string) {}

  private async call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; error?: string } & T;
    if (!data.ok) {
      throw new Error(`Slack ${method} failed: ${data.error ?? "unknown"}`);
    }
    return data;
  }

  /** Create a public channel. Returns channel ID. */
  async createChannel(name: string): Promise<SlackChannel> {
    const data = await this.call<{ channel: SlackChannel }>(
      "conversations.create",
      { name, is_private: false },
    );
    return data.channel;
  }

  /** Set channel topic (shows the Paperclip project link). */
  async setTopic(channelId: string, topic: string): Promise<void> {
    await this.call("conversations.setTopic", { channel: channelId, topic });
  }

  /** Post a message. Returns message ts. */
  async postMessage(
    channelId: string,
    text: string,
    opts?: { threadTs?: string; blocks?: unknown[] },
  ): Promise<SlackMessage> {
    const body: Record<string, unknown> = { channel: channelId, text };
    if (opts?.threadTs) body.thread_ts = opts.threadTs;
    if (opts?.blocks) body.blocks = opts.blocks;
    const data = await this.call<{ ts: string }>("chat.postMessage", body);
    return { ts: data.ts, channel: channelId };
  }

  /** Update an existing message. */
  async updateMessage(
    channelId: string,
    ts: string,
    text: string,
    blocks?: unknown[],
  ): Promise<void> {
    // Slack requires ts as string; JSONB state round-trips can return number
    const body: Record<string, unknown> = { channel: channelId, ts: String(ts), text };
    if (blocks) body.blocks = blocks;
    await this.call("chat.update", body);
  }

  /** Read all replies in a thread. */
  async getReplies(channelId: string, threadTs: string): Promise<SlackReply[]> {
    const data = await this.call<{ messages: SlackReply[] }>(
      "conversations.replies",
      { channel: channelId, ts: threadTs },
    );
    return data.messages;
  }

  /** Invite users to a channel. */
  async inviteUsers(channelId: string, userIds: string[]): Promise<void> {
    try {
      await this.call("conversations.invite", {
        channel: channelId,
        users: userIds.join(","),
      });
    } catch (e) {
      // Ignore "already_in_channel" errors
      if (!(e instanceof Error && e.message.includes("already_in_channel"))) {
        throw e;
      }
    }
  }

  /** Pin a message. Returns true on success, false if scope is missing. */
  async pinMessage(channelId: string, ts: string): Promise<boolean> {
    try {
      await this.call("pins.add", { channel: channelId, timestamp: ts });
      return true;
    } catch (e) {
      if (e instanceof Error) {
        // already pinned → treat as success
        if (e.message.includes("already_pinned")) return true;
        // missing scope → swallow; caller logs
        if (e.message.includes("missing_scope")) return false;
      }
      throw e;
    }
  }

  /** Look up channel by name. Returns null if not found. */
  async findChannel(name: string): Promise<SlackChannel | null> {
    try {
      const data = await this.call<{ channels: SlackChannel[] }>(
        "conversations.list",
        { types: "public_channel", limit: 200 },
      );
      return data.channels.find((c) => c.name === name) ?? null;
    } catch {
      return null;
    }
  }
}
