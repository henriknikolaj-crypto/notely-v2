import type { PlanCode } from "@/lib/plan/limits";

export type HistoryWindow = {
  flashcardsSidebarItems: number;
  flashcardsHistoryItems: number;
  mcVisibleItems: number;
};

export function getHistoryWindowForPlan(plan: PlanCode): HistoryWindow {
  switch (plan) {
    case "freemium":
      return {
        flashcardsSidebarItems: 3,
        flashcardsHistoryItems: 3,
        mcVisibleItems: 20,
      };
    case "basis":
    case "pro":
    default:
      return {
        flashcardsSidebarItems: 3,
        flashcardsHistoryItems: 20,
        mcVisibleItems: 20,
      };
  }
}
