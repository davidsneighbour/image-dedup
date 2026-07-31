import { z } from "zod";

/**
 * One entry in the consolidation operation journal (PLAN.md §23.3).
 * `source`/`destination` are absolute filesystem paths rather than the
 * repo-relative-looking strings in PLAN.md's illustrative example —
 * journal entries must stay filesystem-actionable (rollback runs later,
 * from a possibly different working directory) independent of any
 * particular cwd.
 */
export type ConsolidationOperationStatus =
  | "verified"
  | "skipped-identical"
  | "failed"
  | "rolled-back";

export interface ConsolidationOperation {
  operationId: string;
  runId: string;
  type: "copy";
  source: string;
  destination: string;
  sourceHash: string;
  destinationHash?: string | undefined;
  status: ConsolidationOperationStatus;
  timestamp: string;
  rolledBackAt?: string | undefined;
}

export const consolidationOperationSchema = z
  .object({
    operationId: z.string().min(1),
    runId: z.string().min(1),
    type: z.literal("copy"),
    source: z.string().min(1),
    destination: z.string().min(1),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    destinationHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    status: z.enum(["verified", "skipped-identical", "failed", "rolled-back"]),
    timestamp: z.string().min(1),
    rolledBackAt: z.string().min(1).optional(),
  })
  .strict();
