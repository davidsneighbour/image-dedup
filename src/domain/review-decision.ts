import { z } from "zod";

/**
 * A human reviewer's decision about one group. See PLAN.md §5.4. Produced
 * by the M8 HTML report's "export decisions" action; consumed by M9's
 * `review import` (`src/review/import-decisions.ts`).
 */
export interface ReviewDecision {
  groupId: string;
  /**
   * `| undefined` (not just `?`) so this structurally matches
   * `z.infer<typeof reviewDecisionSchema>` under `exactOptionalPropertyTypes`
   * — zod's `.optional()` output type always includes an explicit
   * `| undefined`, and M9's review import assigns parsed decisions
   * straight into this type.
   */
  selectedImageId?: string | undefined;
  action: "approve-recommendation" | "select-different" | "keep-multiple" | "not-related" | "defer";
  selectedAt: string;
  note?: string | undefined;
}

export const reviewDecisionSchema = z
  .object({
    groupId: z.string().min(1),
    selectedImageId: z.string().min(1).optional(),
    action: z.enum([
      "approve-recommendation",
      "select-different",
      "keep-multiple",
      "not-related",
      "defer",
    ]),
    selectedAt: z.string().min(1),
    note: z.string().optional(),
  })
  .strict()
  .superRefine((decision, ctx) => {
    if (
      (decision.action === "approve-recommendation" || decision.action === "select-different") &&
      !decision.selectedImageId
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `selectedImageId is required when action is "${decision.action}"`,
        path: ["selectedImageId"],
      });
    }
  });

export const reviewDecisionsSchema = z.array(reviewDecisionSchema);
