import { z } from "zod";

/**
 * A human reviewer's decision about one group. See PLAN.md §5.4. Produced
 * by the M8 HTML report's "export decisions" action; consumed by M9's
 * `review import` (not yet implemented — this type/schema exists now so
 * the export shape doesn't need to change when that lands).
 */
export interface ReviewDecision {
  groupId: string;
  selectedImageId?: string;
  action: "approve-recommendation" | "select-different" | "keep-multiple" | "not-related" | "defer";
  selectedAt: string;
  note?: string;
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
