import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { ClaudeUsageData, LimitSection, ModelInfo } from "./types";

interface ClaudeCredentials {
  accessToken: string;
  expiresAt: number;
}

export class RateLimitError extends Error {
  constructor() {
    super("Rate limited (429). Refresh blocked for 10 minutes.");
    this.name = "RateLimitError";
  }
}

export class UsageProvider {
  private readCredentials(): ClaudeCredentials | undefined {
    const candidates = [
      path.join(os.homedir(), ".claude", ".credentials.json"),
      path.join(os.homedir(), ".claude", "credentials.json"),
    ];

    for (const credPath of candidates) {
      try {
        const raw = fs.readFileSync(credPath, "utf-8");
        const data = JSON.parse(raw) as Record<string, unknown>;

        const oauth = data["claudeAiOauth"] as
          | Record<string, unknown>
          | undefined;
        const accessToken = oauth?.["accessToken"] as string | undefined;
        const expiresAt = oauth?.["expiresAt"] as number | undefined;

        if (accessToken) {
          return { accessToken, expiresAt: expiresAt ?? 0 };
        }
      } catch {
        // file doesn't exist or isn't valid JSON — try next
      }
    }

    return undefined;
  }

  // ─── API fetching ───────────────────────────────────────────────────────────

  private async fetchApiData(
    creds: ClaudeCredentials,
  ): Promise<Partial<ClaudeUsageData>> {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "vscode-claude-tracker/1.0.0",
      },
    });

    if (res.status === 429) {
      throw new RateLimitError();
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Authentication failed (${res.status}). Claude CLI session may have expired — restart Claude Code.`,
      );
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const usage = (await res.json()) as Record<string, unknown>;
    const parsed = this.parseUsageResponse(usage);

    if (!parsed.sessionLimit && !parsed.weeklyLimit) {
      const snapshot = JSON.stringify(usage, null, 2).substring(0, 500);
      console.log("[Claude Tracker] Raw API response:", snapshot);
      parsed.error = `Could not parse usage data. Response keys: ${Object.keys(usage).join(", ")}`;
    }

    return parsed;
  }

  // ─── Response parsing ──────────────────────────────────────────────────────

  /** Try to read a percentage from a limit bucket object */
  private extractPercent(obj: Record<string, unknown>): number | undefined {
    for (const key of [
      "utilization",
      "used_percent",
      "used_percentage",
      "percent_used",
      "usage_percent",
      "percentUsed",
      "used",
    ]) {
      const v = obj[key];
      if (typeof v === "number") {
        return v >= 0 && v <= 1 && !Number.isInteger(v)
          ? Math.round(v * 100)
          : Math.round(v);
      }
    }
    return undefined;
  }

  /** Format a reset timestamp (ISO string or seconds) into readable text */
  private formatReset(v: unknown): string {
    if (typeof v === "string") {
      const d = new Date(v);
      if (!isNaN(d.getTime())) {
        const diff = d.getTime() - Date.now();
        if (diff > 0) {
          const hrs = Math.floor(diff / 3_600_000);
          const mins = Math.round((diff % 3_600_000) / 60_000);
          if (hrs >= 24) {
            const days = Math.floor(hrs / 24);
            const remHrs = hrs % 24;
            return remHrs > 0
              ? `Resets in ${days} d ${remHrs} h`
              : `Resets in ${days} d`;
          }
          return hrs > 0
            ? `Resets in ${hrs} h ${mins} min`
            : `Resets in ${mins} min`;
        }
        return `Resets ${d.toLocaleDateString("en", { weekday: "short" })}, ${d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}`;
      }
    }
    if (typeof v === "number" && v > 0) {
      const hrs = Math.floor(v / 3600);
      const mins = Math.round((v % 3600) / 60);
      if (hrs >= 24) {
        const days = Math.floor(hrs / 24);
        const remHrs = hrs % 24;
        return remHrs > 0
          ? `Resets in ${days} d ${remHrs} h`
          : `Resets in ${days} d`;
      }
      return hrs > 0
        ? `Resets in ${hrs} h ${mins} min`
        : `Resets in ${mins} min`;
    }
    return typeof v === "string" ? v : "";
  }

  /** Try to read reset time from a limit bucket object */
  private extractReset(obj: Record<string, unknown>): string {
    for (const key of [
      "reset_at",
      "resets_at",
      "reset_in_seconds",
      "resetAt",
      "resetsAt",
    ]) {
      if (obj[key] !== undefined) {
        return this.formatReset(obj[key]);
      }
    }
    return "";
  }

  /** Parse a single limit bucket into a LimitSection */
  private parseBucket(obj: unknown, label: string): LimitSection | undefined {
    if (!obj || typeof obj !== "object") {
      return undefined;
    }
    const bucket = obj as Record<string, unknown>;
    const pct = this.extractPercent(bucket);
    if (pct !== undefined) {
      return { label, subLabel: this.extractReset(bucket), percentage: pct };
    }
    console.log(
      `[Claude Tracker] "${label}" bucket keys:`,
      Object.keys(bucket),
      "values:",
      JSON.stringify(bucket).substring(0, 300),
    );
    return undefined;
  }

  private parseUsageResponse(
    data: Record<string, unknown>,
  ): Partial<ClaudeUsageData> {
    const result: Partial<ClaudeUsageData> = {};

    result.sessionLimit =
      this.parseBucket(data["five_hour"], "Current session") ??
      this.parseBucket(data["session"], "Current session");

    result.weeklyLimit =
      this.parseBucket(data["seven_day"], "Weekly limit") ??
      this.parseBucket(data["weekly"], "Weekly limit");

    const extra = data["extra_usage"] as Record<string, unknown> | undefined;
    if (
      extra &&
      typeof extra === "object" &&
      (extra["enabled"] || extra["is_enabled"])
    ) {
      const pct = this.extractPercent(extra) ?? 0;
      result.extraUsage = {
        label: "Extra usage",
        subLabel: "",
        percentage: pct,
      };
    }

    return result;
  }

  // ─── Claude Code settings ──────────────────────────────────────────────────

  private readModelInfo(): ModelInfo {
    const defaults: ModelInfo = {
      effortLevel: "standard",
    };

    // Read effort level from settings files
    const settingsPaths = [
      path.join(os.homedir(), ".claude", "settings.json"),
      path.join(os.homedir(), ".claude", "settings.local.json"),
    ];

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (workspaceRoot) {
      settingsPaths.push(
        path.join(workspaceRoot, ".claude", "settings.json"),
        path.join(workspaceRoot, ".claude", "settings.local.json"),
      );
    }

    for (const settingsPath of settingsPaths) {
      try {
        const raw = fs.readFileSync(settingsPath, "utf-8");
        const data = JSON.parse(raw) as Record<string, unknown>;

        if (typeof data["effortLevel"] === "string") {
          defaults.effortLevel = data["effortLevel"];
        }
      } catch {
        // file doesn't exist or isn't valid JSON — skip
      }
    }

    return defaults;
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  public async getUsageData(): Promise<ClaudeUsageData> {
    const config = vscode.workspace.getConfiguration("claudeTracker");
    const plan = config.get<string>("plan", "Claude Pro");
    const now = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    const creds = this.readCredentials();
    const modelInfo = this.readModelInfo();

    if (!creds) {
      return {
        plan,
        modelInfo,
        lastUpdated: now,
        error:
          "Claude CLI credentials not found. Make sure Claude Code is installed and you have logged in.",
      };
    }

    if (creds.expiresAt > 0 && Date.now() > creds.expiresAt) {
      return {
        plan,
        modelInfo,
        lastUpdated: now,
        error:
          'Claude CLI session has expired. Run "claude" in a terminal to refresh it.',
      };
    }

    try {
      const apiData = await this.fetchApiData(creds);
      return { plan, modelInfo, ...apiData, lastUpdated: now };
    } catch (err) {
      return {
        plan,
        modelInfo,
        error: err instanceof Error ? err.message : String(err),
        lastUpdated: now,
      };
    }
  }
}
