import { z } from "zod";
import type { ImageRelationship } from "./relationship.js";

/**
 * A pairwise relationship between two group members. See PLAN.md §16.1
 * ("represent images as nodes and relationships as weighted edges") and the
 * crop-comparison example in §12.2. `details` is an open bag for
 * relationship-specific structured data (e.g. a crop's `cropBox`) added by
 * the detector that produced the comparison; M3 (exact duplicates) never
 * populates it.
 */
export interface ImageComparison {
  a: string;
  b: string;
  relationship: ImageRelationship;
  confidence: number;
  reasons: string[];
  details?: Record<string, unknown>;
}

export type ImageGroupStatus =
  | "automatic"
  | "manual-review"
  | "approved"
  | "rejected"
  | "ambiguous";

/**
 * `kind` is not in PLAN.md's §5.3 interface verbatim, but the JSON report
 * summary in §19 already distinguishes `exactDuplicateGroups` from
 * `visualGroups` — different detectors (exact hash now, perceptual
 * matching from M4 on) produce groups that must be told apart and
 * recomputed/replaced independently.
 */
export type ImageGroupKind = "exact-duplicate";

export interface ImageGroup {
  id: string;
  kind: ImageGroupKind;
  members: string[];
  comparisons: ImageComparison[];
  recommendedOriginalId?: string;
  confidence: number;
  status: ImageGroupStatus;
  reasons: string[];
  warnings: string[];
}

const imageComparisonSchema = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  relationship: z.string().min(1),
  confidence: z.number().min(0).max(1),
  reasons: z.array(z.string()),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const imageGroupSchema = z
  .object({
    id: z.string().min(1),
    kind: z.literal("exact-duplicate"),
    members: z.array(z.string().min(1)).min(2, "a group must have at least two members"),
    comparisons: z.array(imageComparisonSchema),
    recommendedOriginalId: z.string().min(1).optional(),
    confidence: z.number().min(0).max(1),
    status: z.enum(["automatic", "manual-review", "approved", "rejected", "ambiguous"]),
    reasons: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .strict()
  .superRefine((group, ctx) => {
    if (group.recommendedOriginalId && !group.members.includes(group.recommendedOriginalId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "recommendedOriginalId must be one of the group's members",
        path: ["recommendedOriginalId"],
      });
    }
  });
