import type { BudgetsInput } from "@usagekit/views";
import { BudgetCardsPanel } from "@/components/usagekit/budget-card";

export function BudgetsPage({ budgetInput }: { budgetInput: BudgetsInput | null }) {
  if (!budgetInput)
    return (
      <p className="text-sm text-muted-foreground">
        Add a provider connection to see the budgets that apply to it.
      </p>
    );
  return <BudgetCardsPanel {...budgetInput} />;
}
