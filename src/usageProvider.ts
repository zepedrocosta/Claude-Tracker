import { execSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import {
  BreakdownRow,
  ClaudeUsageData,
  LimitSection,
  ModelInfo,
  ServiceStatus,
  UsageBreakdown,
} from "./types";

interface ClaudeCredentials {
  accessToken: string;
  expiresAt: number;
}

interface SharedState {
  rateLimitedUntil: number; // epoch ms; 0 = not rate-limited
  lastFetchAt: number; // epoch ms of last successful API fetch
  cachedApiData: Partial<ClaudeUsageData> | null;
  lastServiceStatusIndicator?: string; // last known service status indicator
  // Per-server notes/links owned by mcpProvider (see McpServerMeta). Declared
  // here so usage writes carry it through instead of dropping it.
  mcpServerMeta?: Record<string, { description: string; url: string }>;
}

const CACHE_FILE = path.join(os.homedir(), ".claude", "tracker-cache.json");
const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const STATUS_URL = "https://status.claude.com/api/v2/status.json";
const FETCH_INTERVAL_MS = 5 * 60_000; // 5 minutes
const FORCE_REFRESH_INTERVAL_MS = 60_000; // 1 minute (manual refresh cooldown)
const RATE_LIMIT_BACKOFF_MS = 10 * 60_000; // 10 minutes

export class RateLimitError extends Error {
  constructor() {
    super("Rate limited (429). Refresh blocked for 10 minutes.");
    this.name = "RateLimitError";
  }
}

export class UsageProvider {
  private readonly log: (msg: string) => void;
  private readonly debug: boolean;

  /**
   * @param debug When true (Extension Development Host), every API response
   *   body is written to the log.
   */
  constructor(
    log: (msg: string) => void = () => {
      /* no-op */
    },
    debug = false,
  ) {
    this.log = log;
    this.debug = debug;
  }

  /** Logs a raw API response body, pretty-printed when it is JSON. Debug only. */
  private logResponse(url: string, status: number, body: string): void {
    if (!this.debug) {
      return;
    }
    let pretty = body;
    try {
      pretty = JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // not JSON — log as-is
    }
    this.log(`[debug] GET ${url} → ${status}\n${pretty}`);
  }

  // ─── Shared state (cross-instance cache + rate-limit coordination) ───────────

  private readSharedState(): SharedState {
    try {
      const raw = fs.readFileSync(CACHE_FILE, "utf-8");
      return JSON.parse(raw) as SharedState;
    } catch {
      return { rateLimitedUntil: 0, lastFetchAt: 0, cachedApiData: null };
    }
  }

  private writeSharedState(state: SharedState): void {
    try {
      // Merge over whatever is on disk *now*: callers pass a snapshot read
      // before a network round-trip, and other writers (MCP server notes) may
      // have touched the file since.
      const onDisk = this.readSharedState();
      const payload = {
        _comment:
          "Claude Tracker shared cache. Coordinates API fetches and rate-limit backoff across all open VS Code instances. Do not edit manually.",
        ...onDisk,
        ...state,
        // Owned solely by mcpProvider — always mirror disk, never a snapshot.
        // `undefined` is dropped by JSON.stringify, so an unset key stays unset.
        mcpServerMeta: onDisk.mcpServerMeta,
      };
      fs.writeFileSync(CACHE_FILE, JSON.stringify(payload, null, 2), "utf-8");
    } catch {
      // ignore write errors — cache is best-effort
    }
  }

  // ─── Credentials ─────────────────────────────────────────────────────────────

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

    // macOS Keychain fallback
    if (process.platform === "darwin") {
      try {
        const raw = execSync(
          'security find-generic-password -s "Claude Code-credentials" -w',
          { encoding: "utf-8" },
        ).trim();
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
        // keychain entry not found or not macOS — ignore
      }
    }

    return undefined;
  }

  // ─── API fetching ───────────────────────────────────────────────────────────

  private async fetchServiceStatus(): Promise<ServiceStatus> {
    try {
      const res = await fetch(STATUS_URL);
      const body = await res.text();
      this.logResponse(STATUS_URL, res.status, body);
      if (res.ok) {
        const data = JSON.parse(body) as {
          status?: { indicator: string; description: string };
        };
        if (data.status?.indicator !== undefined) {
          const sharedState = this.readSharedState();
          const indicatorChanged =
            data.status.indicator !== sharedState.lastServiceStatusIndicator;
          this.writeSharedState({
            ...sharedState,
            lastServiceStatusIndicator: data.status.indicator,
          });
          if (
            data.status.indicator !== "none" &&
            indicatorChanged &&
            vscode.workspace
              .getConfiguration("claudeTracker")
              .get<boolean>("showServiceStatus", true)
          ) {
            this.log(
              `Service status: ${data.status.indicator} - Description: ${data.status.description}`,
            );
            void vscode.window.withProgress(
              {
                location: vscode.ProgressLocation.Notification,
                title: `Claude service ${data.status.indicator.toUpperCase()} — ${data.status.description}`,
                cancellable: false,
              },
              () => new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
            );
          }
          return data.status as ServiceStatus;
        }
      }
    } catch {
      // ignore
    }
    return { indicator: "unknown", description: "Status unavailable" };
  }

  private async fetchApiData(
    creds: ClaudeCredentials,
  ): Promise<Partial<ClaudeUsageData>> {
    this.log("Fetching usage data from API...");
    const [res, serviceStatus] = await Promise.all([
      fetch(USAGE_URL, {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": "vscode-claude-tracker/1.0.0",
        },
      }),
      this.fetchServiceStatus(),
    ]);

    const body = await res.text();
    this.logResponse(USAGE_URL, res.status, body);

    if (res.status === 429) {
      throw new RateLimitError();
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Authentication failed (${res.status}). Claude CLI session may have expired — restart Claude Code.`,
      );
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${body}`);
    }

    const usage = JSON.parse(body) as Record<string, unknown>;
    const parsed = this.parseUsageResponse(usage);

    if (serviceStatus) {
      parsed.serviceStatus = serviceStatus;
    }

    if (!parsed.sessionLimit && !parsed.weeklyLimit) {
      const snapshot = JSON.stringify(usage, null, 2).substring(0, 500);
      this.log(`Raw API response: ${snapshot}`);
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
    this.log(
      `"${label}" bucket keys: ${Object.keys(bucket).join(", ")} — values: ${JSON.stringify(bucket).substring(0, 300)}`,
    );
    return undefined;
  }

  /** Parse `seven_day_breakdown` — each product's share of the weekly usage */
  private parseBreakdown(obj: unknown): UsageBreakdown | undefined {
    if (!obj || typeof obj !== "object") {
      return undefined;
    }
    const data = obj as Record<string, unknown>;
    if (!Array.isArray(data["rows"])) {
      return undefined;
    }
    const rows: BreakdownRow[] = [];
    for (const row of data["rows"] as unknown[]) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const { key, display_name: name, percent } = row as Record<
        string,
        unknown
      >;
      if (typeof key !== "string" || typeof percent !== "number") {
        continue;
      }
      rows.push({
        key,
        label: typeof name === "string" ? name : key,
        percentage: Math.round(percent),
      });
    }
    if (rows.length === 0) {
      this.log(
        `"seven_day_breakdown" has no usable rows: ${JSON.stringify(obj).substring(0, 300)}`,
      );
      return undefined;
    }
    const since = data["window_started_at"];
    return { since: typeof since === "string" ? since : undefined, rows };
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

    result.weeklyBreakdown = this.parseBreakdown(data["seven_day_breakdown"]);

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

  public async getUsageData(forceRefresh = false): Promise<ClaudeUsageData> {
    const config = vscode.workspace.getConfiguration("claudeTracker");
    const plan = config.get<string>("plan", "Claude Pro");
    const nowStr = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const nowMs = Date.now();

    const creds = this.readCredentials();
    const modelInfo = this.readModelInfo();

    const resolve = async (
      partial: Omit<ClaudeUsageData, "serviceStatus">,
    ): Promise<ClaudeUsageData> => {
      const serviceStatus =
        (partial as ClaudeUsageData).serviceStatus ??
        (await this.fetchServiceStatus());
      return { ...partial, serviceStatus };
    };

    if (!creds) {
      return resolve({
        plan,
        modelInfo,
        lastUpdated: nowStr,
        error:
          "Claude CLI credentials not found. Make sure Claude Code is installed and you have logged in.",
      });
    }

    if (creds.expiresAt > 0 && nowMs > creds.expiresAt) {
      return resolve({
        plan,
        modelInfo,
        lastUpdated: nowStr,
        error:
          'Claude CLI session has expired. Run "claude" in a terminal to refresh it.',
      });
    }

    const state = this.readSharedState();

    // Rate-limited — block all instances until backoff expires
    if (state.rateLimitedUntil > nowMs) {
      const remaining = Math.ceil((state.rateLimitedUntil - nowMs) / 60_000);
      this.log(`Rate-limited, resuming in ${remaining} min`);
      return resolve({
        plan,
        modelInfo,
        ...(state.cachedApiData ?? {}),
        lastUpdated: nowStr,
        error: `Rate limited (429). Resuming in ${remaining} min.`,
      });
    }

    // Cache is fresh — return cached data (avoids redundant fetches across instances)
    const cacheMaxAge = forceRefresh ? FORCE_REFRESH_INTERVAL_MS : FETCH_INTERVAL_MS;
    if (
      state.lastFetchAt > 0 &&
      nowMs - state.lastFetchAt < cacheMaxAge &&
      state.cachedApiData
    ) {
      this.log(
        `Using shared cache (age ${Math.round((nowMs - state.lastFetchAt) / 1000)}s)`,
      );
      return resolve({
        plan,
        modelInfo,
        ...state.cachedApiData,
        lastUpdated: nowStr,
      });
    }

    // Fetch from API
    try {
      const apiData = await this.fetchApiData(creds);
      const freshState = this.readSharedState();
      this.writeSharedState({
        ...freshState,
        rateLimitedUntil: 0,
        lastFetchAt: nowMs,
        cachedApiData: apiData,
      });
      return resolve({ plan, modelInfo, ...apiData, lastUpdated: nowStr });
    } catch (err) {
      if (err instanceof RateLimitError) {
        this.writeSharedState({
          ...state,
          rateLimitedUntil: nowMs + RATE_LIMIT_BACKOFF_MS,
        });
      }
      return resolve({
        plan,
        modelInfo,
        ...(state.cachedApiData ?? {}),
        lastUpdated: nowStr,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
