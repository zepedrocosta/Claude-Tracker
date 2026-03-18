export interface LimitSection {
  label: string;
  subLabel: string;
  percentage: number;
}

export interface ClaudeUsageData {
  plan: string;
  sessionLimit?: LimitSection;
  weeklyLimit?: LimitSection;
  extraUsage?: LimitSection;
  lastUpdated: string;
  error?: string;
}
