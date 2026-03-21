export interface LimitSection {
  label: string;
  subLabel: string;
  percentage: number;
}

export interface ModelInfo {
  effortLevel: string;
}

export interface ClaudeUsageData {
  plan: string;
  sessionLimit?: LimitSection;
  weeklyLimit?: LimitSection;
  extraUsage?: LimitSection;
  modelInfo?: ModelInfo;
  lastUpdated: string;
  error?: string;
}
