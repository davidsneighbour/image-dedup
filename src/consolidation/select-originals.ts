import type { ImageGroup } from "../domain/image-group.js";
import type { ImageRecord } from "../domain/image-record.js";
import type { CanonicalManifestSelectionMethod } from "../domain/manifest.js";

export interface SelectedOriginalRelationship {
  path: string;
  type: string;
  confidence: number;
}

/** One image chosen to be copied into the canonical originals directory, and the provenance to record for it in the manifest. */
export interface SelectedOriginal {
  imageId: string;
  /** Every group whose decision produced this selection. Usually one; a small edge case (the same image winning two independent groups) makes it a list rather than dropping information. */
  groupIds: string[];
  /** Historical source paths this selection was chosen over — never includes its own path. */
  selectedFrom: string[];
  relationships: SelectedOriginalRelationship[];
  selection: {
    method: CanonicalManifestSelectionMethod;
    confidence: number;
    reasons: string[];
  };
}

export interface SelectOriginalsResult {
  selected: SelectedOriginal[];
  /** Group ids left out entirely (`manual-review`/`ambiguous`) — not yet decided, so none of their members are consolidated. */
  unresolvedGroupIds: string[];
}

function mergeUnique(existing: readonly string[], incoming: readonly string[]): string[] {
  return [...new Set([...existing, ...incoming])];
}

/**
 * Decides which images actually get copied into the canonical originals
 * directory, and what provenance to record for each (PLAN.md §22-24).
 * Pure: only reads groups/records, never touches the filesystem or DB.
 *
 * Rules, in order:
 *
 * 1. `manual-review`/`ambiguous` groups are excluded entirely — nothing
 *    about an undecided group is safe to consolidate yet (PLAN.md §35:
 *    never guess). Every member of such a group is left out of this run,
 *    including the "standalone" fallback in step 4 — surfacing them as
 *    `unresolvedGroupIds` is how the caller warns the user to review them
 *    first, rather than silently treating them as independent originals.
 * 2. Every other group with a `recommendedOriginalId` (an `"automatic"`
 *    exact-duplicate group, or an `"approved"` group where the reviewer
 *    confirmed or overrode the recommendation) copies exactly that one
 *    member; every other member becomes `selectedFrom` provenance instead
 *    of a copy of its own.
 * 3. A decided group with no `recommendedOriginalId` (`"approved"` via
 *    "keep multiple", or `"rejected"` as "not related") treats every
 *    member as an independent original — unless step 2 already decided
 *    that exact file is redundant (byte-identical, or a confirmed
 *    derivative, of some other selected image), in which case that
 *    decision wins regardless of order between groups.
 * 4. Any image untouched by every group above (no duplicate or derivative
 *    relationship was ever detected for it) is trivially its own original.
 */
export function selectOriginals(
  groups: readonly ImageGroup[],
  records: readonly ImageRecord[],
): SelectOriginalsResult {
  const recordsById = new Map(records.map((record) => [record.id, record]));

  // Every member of every group, decided or not — excluded from the
  // standalone fallback (step 4) regardless of which pass handles it.
  const memberOfAnyGroup = new Set<string>();
  for (const group of groups) {
    for (const memberId of group.members) memberOfAnyGroup.add(memberId);
  }

  const unresolvedGroupIds = groups
    .filter((group) => group.status === "manual-review" || group.status === "ambiguous")
    .map((group) => group.id);

  const decidedGroups = groups.filter(
    (group) => group.status !== "manual-review" && group.status !== "ambiguous",
  );

  const subsumed = new Set<string>();
  const selectedByImageId = new Map<string, SelectedOriginal>();

  // Pass 1: groups with a single winner.
  for (const group of decidedGroups) {
    const winnerId = group.recommendedOriginalId;
    if (!winnerId) continue;

    for (const memberId of group.members) {
      if (memberId !== winnerId) subsumed.add(memberId);
    }

    const winnerRecord = recordsById.get(winnerId);
    if (!winnerRecord) continue;

    const otherPaths = group.members
      .filter((memberId) => memberId !== winnerId)
      .map((memberId) => recordsById.get(memberId)?.relativePath)
      .filter((path): path is string => Boolean(path));

    const relationships: SelectedOriginalRelationship[] = [];
    for (const comparison of group.comparisons) {
      if (comparison.a !== winnerId && comparison.b !== winnerId) continue;
      const otherId = comparison.a === winnerId ? comparison.b : comparison.a;
      const otherRecord = recordsById.get(otherId);
      if (!otherRecord) continue;
      relationships.push({
        path: otherRecord.relativePath,
        type: comparison.relationship,
        confidence: comparison.confidence,
      });
    }

    const method: CanonicalManifestSelectionMethod =
      group.status === "automatic" ? "automatic" : "manual";
    const existing = selectedByImageId.get(winnerId);

    selectedByImageId.set(winnerId, {
      imageId: winnerId,
      groupIds: mergeUnique(existing?.groupIds ?? [], [group.id]),
      selectedFrom: mergeUnique(existing?.selectedFrom ?? [], otherPaths),
      relationships: [...(existing?.relationships ?? []), ...relationships],
      selection: {
        method,
        confidence: Math.max(existing?.selection.confidence ?? 0, group.confidence),
        reasons: mergeUnique(existing?.selection.reasons ?? [], group.reasons),
      },
    });
  }

  // A member marked subsumed by one group always loses, even if an
  // earlier-processed group in this same pass had provisionally selected
  // it as its own winner (array order across groups isn't meaningful).
  for (const id of subsumed) {
    selectedByImageId.delete(id);
  }

  // Pass 2: decided groups with no single winner (keep-multiple / not-related).
  for (const group of decidedGroups) {
    if (group.recommendedOriginalId) continue;

    const reason =
      group.status === "rejected"
        ? "Reviewer marked these images as not related; each is kept as an independent original."
        : "Reviewer chose to keep multiple originals from this group.";

    for (const memberId of group.members) {
      if (subsumed.has(memberId) || selectedByImageId.has(memberId)) continue;
      const record = recordsById.get(memberId);
      if (!record) continue;

      selectedByImageId.set(memberId, {
        imageId: memberId,
        groupIds: [group.id],
        selectedFrom: [],
        relationships: [],
        selection: {
          method: group.status === "rejected" ? "standalone" : "manual",
          confidence: group.confidence,
          reasons: [...group.reasons, reason],
        },
      });
    }
  }

  // Pass 3: images never touched by any group at all.
  for (const record of records) {
    if (memberOfAnyGroup.has(record.id) || selectedByImageId.has(record.id)) continue;
    selectedByImageId.set(record.id, {
      imageId: record.id,
      groupIds: [],
      selectedFrom: [],
      relationships: [],
      selection: {
        method: "standalone",
        confidence: 1,
        reasons: ["No duplicate or derivative relationship was detected for this image."],
      },
    });
  }

  return {
    selected: [...selectedByImageId.values()].sort((a, b) => a.imageId.localeCompare(b.imageId)),
    unresolvedGroupIds: [...new Set(unresolvedGroupIds)].sort(),
  };
}
