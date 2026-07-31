import type { ImageGroup } from "../domain/image-group.js";
import type { ReviewDecision } from "../domain/review-decision.js";

export interface DecisionIssue {
  groupId: string;
  reason: string;
}

export interface DecisionValidationResult {
  valid: ReviewDecision[];
  invalid: DecisionIssue[];
  stale: DecisionIssue[];
}

function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, index) => id === sortedB[index]);
}

/**
 * Structural + staleness validation for a batch of review decisions
 * (PLAN.md §21). Pure — no I/O, so it can be exercised directly with
 * synthetic groups and reused for both validation passes `review import`
 * needs:
 *
 * 1. Normal pass: `referenceGroups` is the audit report snapshot the
 *    reviewer actually saw (`<workspace>/audit.json`); `liveGroups` is the
 *    workspace's current state. A decision that's structurally fine
 *    against the snapshot but whose group's member list no longer matches
 *    the live workspace (e.g. `audit` ran again in between) is reported as
 *    `stale`, not `invalid` — the decision itself was valid when made.
 * 2. Forced-stale re-check: pass the same map (live groups) as both
 *    parameters. Staleness is then trivially satisfied (a group's members
 *    always match themselves), so this validates decisions directly
 *    against current truth — used after `--force-stale-decisions` to make
 *    sure a forced decision still makes sense against the group as it
 *    exists *now* (e.g. its selected image wasn't itself removed).
 */
export function validateDecisions(
  decisions: readonly ReviewDecision[],
  referenceGroups: ReadonlyMap<string, ImageGroup>,
  liveGroups: ReadonlyMap<string, ImageGroup>,
): DecisionValidationResult {
  const valid: ReviewDecision[] = [];
  const invalid: DecisionIssue[] = [];
  const stale: DecisionIssue[] = [];

  const groupIdCounts = new Map<string, number>();
  for (const decision of decisions) {
    groupIdCounts.set(decision.groupId, (groupIdCounts.get(decision.groupId) ?? 0) + 1);
  }

  for (const decision of decisions) {
    const { groupId } = decision;
    const occurrences = groupIdCounts.get(groupId) ?? 0;

    if (occurrences > 1) {
      invalid.push({
        groupId,
        reason: `${occurrences} conflicting decisions were given for this group; only one decision per group is allowed per import`,
      });
      continue;
    }

    const referenceGroup = referenceGroups.get(groupId);
    if (!referenceGroup) {
      invalid.push({ groupId, reason: "group ID does not exist in the audit report" });
      continue;
    }

    if (decision.selectedImageId && !referenceGroup.members.includes(decision.selectedImageId)) {
      invalid.push({
        groupId,
        reason: `selected image "${decision.selectedImageId}" is not a member of this group`,
      });
      continue;
    }

    if (
      decision.action === "approve-recommendation" &&
      decision.selectedImageId !== referenceGroup.recommendedOriginalId
    ) {
      invalid.push({
        groupId,
        reason: '"approve-recommendation" must select the group\'s recommended original',
      });
      continue;
    }

    const liveGroup = liveGroups.get(groupId);
    if (!liveGroup) {
      stale.push({ groupId, reason: "group no longer exists in the current workspace" });
      continue;
    }

    if (!sameMembers(referenceGroup.members, liveGroup.members)) {
      stale.push({
        groupId,
        reason: `group membership has changed since the audit report was generated (was ${referenceGroup.members.length} member(s), now ${liveGroup.members.length})`,
      });
      continue;
    }

    valid.push(decision);
  }

  return { valid, invalid, stale };
}
