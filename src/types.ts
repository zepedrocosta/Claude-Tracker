export interface LimitSection {
  label: string;
  subLabel: string;
  percentage: number;
}

/** One product's share of the weekly usage (`seven_day_breakdown.rows[]`). */
export interface BreakdownRow {
  key: string; // stable id, e.g. "claude_code" — the dashboard colours by this
  label: string;
  percentage: number;
}

export interface UsageBreakdown {
  since?: string; // ISO timestamp the 7-day window started
  rows: BreakdownRow[];
}

export interface ModelInfo {
  effortLevel: string;
}

export interface ServiceStatus {
  indicator: string; // "none" | "minor" | "major" | "critical" | "maintenance"
  description: string;
}

export interface ClaudeUsageData {
  plan: string;
  sessionLimit?: LimitSection;
  weeklyLimit?: LimitSection;
  extraUsage?: LimitSection;
  weeklyBreakdown?: UsageBreakdown;
  modelInfo?: ModelInfo;
  serviceStatus?: ServiceStatus;
  lastUpdated: string;
  error?: string;
}
