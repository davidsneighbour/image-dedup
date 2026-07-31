import type { ImageGroup } from "../domain/image-group.js";
import type { ReviewDecision } from "../domain/review-decision.js";

function reviewReason(decision: ReviewDecision): string {
  const base = `Reviewed by human: ${decision.action}`;
  return decision.note ? `${base} — ${decision.note}` : base;
}

/**
 * Applies one already-validated review decision to the group it targets,
 * producing the group's next persisted state (PLAN.md §5.4/§21). Pure —
 * the caller writes the result back to the workspace database. `group`
 * must already be known-valid for `decision` (see `validateDecisions`):
 * action validity, group existence, and `selectedImageId` membership are
 * assumed here, not re-checked.
 *
 * `score` is cleared on every action except `approve-recommendation`: it
 * describes the *machine's* candidate's quality, which is no longer
 * accurate once a human has picked a different original, decided to keep
 * multiple, or rejected the grouping outright (see the relaxed
 * `imageGroupSchema` constraint in `domain/image-group.ts` — score is only
 * required while `status` is still `"automatic"`).
 */
export function applyDecisionToGroup(group: ImageGroup, decision: ReviewDecision): ImageGroup {
  const reasons = [...group.reasons, reviewReason(decision)];
  const { recommendedOriginalId: _recommendedOriginalId, score: _score, ...rest } = group;

  switch (decision.action) {
    case "approve-recommendation":
      return { ...group, status: "approved", reasons };

    case "select-different": {
      if (!decision.selectedImageId) {
        throw new Error(
          `"select-different" decision for group "${group.id}" is missing selectedImageId`,
        );
      }
      return {
        ...rest,
        status: "approved",
        recommendedOriginalId: decision.selectedImageId,
        reasons,
      };
    }

    case "keep-multiple":
      return { ...rest, status: "approved", reasons };

    case "not-related":
      return { ...rest, status: "rejected", reasons };

    case "defer":
      return { ...group, reasons };

    default: {
      const _exhaustiveCheck: never = decision.action;
      throw new Error(`Unknown review decision action: ${String(_exhaustiveCheck)}`);
    }
  }
}
