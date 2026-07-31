import type { ImageComparison, ImageGroup, ImageGroupStatus } from "../domain/image-group.js";
import type { ImageRecord } from "../domain/image-record.js";
import { type PathPreference, scorePathPreference } from "./path-preferences.js";

export interface ExactDuplicateResult {
  groups: ImageGroup[];
  /** Clusters of member ids that are hard links of the same inode, not merely identical content. */
  hardLinkClusters: string[][];
  wastedBytes: number;
  wastedBytesByGroup: Record<string, number>;
}

function groupId(sha256: string): string {
  return `grp_${sha256.slice(0, 24)}`;
}

function findHardLinkClusters(members: readonly ImageRecord[]): ImageRecord[][] {
  const byInode = new Map<string, ImageRecord[]>();
  for (const member of members) {
    const key = `${member.file.device}:${member.file.inode}`;
    const bucket = byInode.get(key);
    if (bucket) {
      bucket.push(member);
    } else {
      byInode.set(key, [member]);
    }
  }
  return [...byInode.values()].filter((cluster) => cluster.length > 1);
}

/**
 * Groups files with identical SHA-256 hashes. See PLAN.md §9.
 *
 * Group ids are derived from the content hash itself (not from discovery
 * order or a counter), so the same set of duplicate files always produces
 * the same group id across runs — required for "exact groups must be
 * deterministic".
 *
 * Because group members are byte-identical, there is no quality signal to
 * rank them by (that only applies to non-identical derivatives, from M4
 * on). The only thing that can justify picking one path as "the" original
 * is an explicit, configured path preference; otherwise the group is left
 * for manual review rather than guessing (PLAN.md §9, §35).
 */
export function computeExactDuplicateGroups(
  records: readonly ImageRecord[],
  pathPreferences: readonly PathPreference[],
): ExactDuplicateResult {
  const bySha256 = new Map<string, ImageRecord[]>();
  for (const record of records) {
    const bucket = bySha256.get(record.file.sha256);
    if (bucket) {
      bucket.push(record);
    } else {
      bySha256.set(record.file.sha256, [record]);
    }
  }

  const groups: ImageGroup[] = [];
  const hardLinkClusters: string[][] = [];
  let wastedBytes = 0;
  const wastedBytesByGroup: Record<string, number> = {};

  const sortedShas = [...bySha256.keys()].sort((a, b) => a.localeCompare(b));

  for (const sha256 of sortedShas) {
    const members = bySha256.get(sha256) ?? [];
    if (members.length < 2) {
      continue;
    }

    const sortedMembers = [...members].sort(
      (a, b) => a.relativePath.localeCompare(b.relativePath) || a.id.localeCompare(b.id),
    );
    const [representative] = sortedMembers;
    if (!representative) {
      continue;
    }

    const id = groupId(sha256);

    const comparisons: ImageComparison[] = sortedMembers.slice(1).map((member) => ({
      a: representative.id,
      b: member.id,
      relationship: "exact-duplicate",
      confidence: 1,
      reasons: ["identical SHA-256"],
    }));

    const scored = sortedMembers.map((member) => ({
      member,
      score: scorePathPreference(member.relativePath, pathPreferences),
    }));
    const maxScore = Math.max(...scored.map((entry) => entry.score));
    const topScored = scored.filter((entry) => entry.score === maxScore);
    const [topEntry] = topScored;

    const hasPreferenceSignal = pathPreferences.length > 0 && maxScore !== 0;
    const isUnambiguous = topScored.length === 1 && topEntry !== undefined;

    const reasons: string[] = [
      `${sortedMembers.length} files share identical content (SHA-256 ${sha256.slice(0, 12)}…)`,
    ];
    const warnings: string[] = [];

    let recommendedOriginalId: string | undefined;
    let status: ImageGroupStatus;
    let confidence: number;

    if (hasPreferenceSignal && isUnambiguous && topEntry) {
      recommendedOriginalId = topEntry.member.id;
      status = "automatic";
      confidence = 1;
      reasons.push(`path preference favours "${topEntry.member.relativePath}"`);
    } else {
      status = "manual-review";
      confidence = hasPreferenceSignal ? 0.5 : 0;
      warnings.push(
        hasPreferenceSignal
          ? "multiple paths tie for the highest configured path preference"
          : "no path preference configured; which copy to treat as the original is unresolved",
      );
    }

    for (const cluster of findHardLinkClusters(sortedMembers)) {
      hardLinkClusters.push(cluster.map((member) => member.id).sort((a, b) => a.localeCompare(b)));
      warnings.push(
        `${cluster.length} members are hard links of the same inode: ${cluster
          .map((member) => member.relativePath)
          .join(", ")}`,
      );
    }

    const groupWaste = (sortedMembers.length - 1) * representative.file.sizeBytes;
    wastedBytes += groupWaste;
    wastedBytesByGroup[id] = groupWaste;

    groups.push({
      id,
      kind: "exact-duplicate",
      members: sortedMembers.map((member) => member.id),
      comparisons,
      ...(recommendedOriginalId ? { recommendedOriginalId } : {}),
      confidence,
      status,
      reasons,
      warnings,
    });
  }

  return { groups, hardLinkClusters, wastedBytes, wastedBytesByGroup };
}
