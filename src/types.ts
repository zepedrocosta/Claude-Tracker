export interface LimitSection {
  label: string;
  subLabel: string;
  percentage: number;
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
  modelInfo?: ModelInfo;
  serviceStatus?: ServiceStatus;
  lastUpdated: string;
  error?: string;
}
