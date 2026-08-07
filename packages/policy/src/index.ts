export type Decision = "APPROVED" | "REQUIRES_APPROVAL" | "BLOCKED";

export interface PolicyInput {
  agentId: string;
  amountMicros: number;
  service: string;
  category: string;
}

export interface SpendPolicy {
  id: string;
  agentId: string;
  maxPerTransactionMicros: number;
  dailyLimitMicros: number;
  monthlyLimitMicros: number;
  autoApproveBelowMicros: number;
  allowedCategories: string[];
}

export interface PolicyContext {
  policy: SpendPolicy;
  dailySpentMicros: number;
  monthlySpentMicros: number;
  remainingBudgetMicros: number;
}

export interface PolicyResult {
  decision: Decision;
  reason: string;
  policyId: string;
  remainingBudgetMicros: number;
}

export function evaluateSpendPolicy(input: PolicyInput, context: PolicyContext): PolicyResult {
  const { policy, dailySpentMicros, monthlySpentMicros, remainingBudgetMicros } = context;
  const blocked = (reason: string): PolicyResult => ({ decision: "BLOCKED", reason, policyId: policy.id, remainingBudgetMicros });
  if (!policy.allowedCategories.includes(input.category)) return blocked(`Category '${input.category}' is not permitted by this policy.`);
  if (input.amountMicros > policy.maxPerTransactionMicros) return blocked("Request exceeds the per-transaction limit.");
  if (dailySpentMicros + input.amountMicros > policy.dailyLimitMicros) return blocked("Request would exceed the daily spending limit.");
  if (monthlySpentMicros + input.amountMicros > policy.monthlyLimitMicros) return blocked("Request would exceed the monthly spending limit.");
  if (input.amountMicros > remainingBudgetMicros) return blocked("Request exceeds the agent's remaining budget.");
  if (input.amountMicros > policy.autoApproveBelowMicros) {
    return { decision: "REQUIRES_APPROVAL", reason: "Amount is above the auto-approval threshold.", policyId: policy.id, remainingBudgetMicros };
  }
  return { decision: "APPROVED", reason: "Within all limits and below the auto-approval threshold.", policyId: policy.id, remainingBudgetMicros };
}
