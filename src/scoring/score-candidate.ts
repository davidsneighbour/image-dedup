import { computeDetailScore } from "../analysis/upscale-detection.js";
import type { ImageOriginConfig } from "../config/schema.js";
import type { ImageGroup } from "../domain/image-group.js";
import type { ImageRecord } from "../domain/image-record.js";
import { scorePathPreference } from "../matching/path-preferences.js";

export interface MemberSignals {
  recordId: string;
  detailScore: number;
  pixelCount: number;
  bitDepth: number;
  hasAlpha: boolean;
  iccPresent: boolean;
  metadataCount: number;
  pathPreferenceScore: number;
  isCrop: boolean;
  cropRetainedArea?: number;
  isProbableUpscale: boolean;
}

const DETAIL_ANALYSIS_MAX_DIMENSION = 512;

function findCropDetails(
  record: ImageRecord,
  group: ImageGroup,
): { retainedArea: number } | undefined {
  for (const comparison of group.comparisons) {
    if (comparison.relationship !== "crop") {
      continue;
    }
    const details = comparison.details as
      | { croppedImageId?: string; retainedArea?: number }
      | undefined;
    if (details?.croppedImageId === record.id && typeof details.retainedArea === "number") {
      return { retainedArea: details.retainedArea };
    }
  }
  return undefined;
}

/** Gathers the raw, per-record signals scoring needs. Involves I/O (a fresh detail-score decode per record). */
export async function gatherMemberSignals(
  record: ImageRecord,
  group: ImageGroup,
  pathPreferences: ImageOriginConfig["pathPreferences"],
): Promise<MemberSignals> {
  const analysisWidth = Math.min(record.image.width, DETAIL_ANALYSIS_MAX_DIMENSION);
  const analysisHeight = Math.min(record.image.height, DETAIL_ANALYSIS_MAX_DIMENSION);
  const detailScore = await computeDetailScore(record.realPath, analysisWidth, analysisHeight);

  const crop = findCropDetails(record, group);
  const metadataCount = [
    record.metadata.exifPresent,
    record.metadata.iptcPresent,
    record.metadata.xmpPresent,
  ].filter(Boolean).length;

  return {
    recordId: record.id,
    detailScore,
    pixelCount: record.image.width * record.image.height,
    bitDepth: record.image.bitDepth ?? 8,
    hasAlpha: record.image.hasAlpha,
    iccPresent: record.metadata.iccPresent,
    metadataCount,
    pathPreferenceScore: scorePathPreference(record.relativePath, pathPreferences),
    isCrop: crop !== undefined,
    ...(crop ? { cropRetainedArea: crop.retainedArea } : {}),
    isProbableUpscale: record.quality.probableUpscale === true,
  };
}

export interface GroupScoringContext {
  maxDetailScore: number;
  maxPixelCount: number;
  maxBitDepth: number;
  /** Whether any *other* member of the group has real (non-degenerate) alpha. */
  anyOtherGenuineAlpha: (recordId: string) => boolean;
  /** Whether a non-cropped, complete candidate exists in the group. */
  anyCompleteCandidateExists: boolean;
  /** Whether a candidate not flagged `probableUpscale` exists in the group. */
  anyNonUpscaleCandidateExists: boolean;
  maxMetadataCount: number;
}

export function buildScoringContext(allSignals: readonly MemberSignals[]): GroupScoringContext {
  const maxDetailScore = Math.max(0, ...allSignals.map((s) => s.detailScore));
  const maxPixelCount = Math.max(1, ...allSignals.map((s) => s.pixelCount));
  const maxBitDepth = Math.max(8, ...allSignals.map((s) => s.bitDepth));
  const maxMetadataCount = Math.max(0, ...allSignals.map((s) => s.metadataCount));
  const anyCompleteCandidateExists = allSignals.some((s) => !s.isCrop);
  const anyNonUpscaleCandidateExists = allSignals.some((s) => !s.isProbableUpscale);

  return {
    maxDetailScore,
    maxPixelCount,
    maxBitDepth,
    maxMetadataCount,
    anyCompleteCandidateExists,
    anyNonUpscaleCandidateExists,
    anyOtherGenuineAlpha: (recordId) =>
      allSignals.some((s) => s.recordId !== recordId && s.hasAlpha),
  };
}

export interface ScoreComponents {
  nativeDetail: number;
  effectiveResolution: number;
  completeness: number;
  bitDepth: number;
  alphaPreservation: number;
  iccProfile: number;
  usefulMetadata: number;
  preferredSourcePath: number;
}

export interface ScorePenalties {
  probableUpscale: number;
  confirmedCrop: number;
  missingAlphaAvailableElsewhere: number;
  metadataStrippedRelativeToGroup: number;
}

export interface CandidateScore {
  recordId: string;
  total: number;
  components: ScoreComponents;
  penalties: ScorePenalties;
  reasons: string[];
  warnings: string[];
  disqualified: boolean;
  disqualifiedReasons: string[];
}

/**
 * Scores one group member (PLAN.md §17.2). Pure function over precomputed
 * signals — no I/O, so it's cheap to call for every member and easy to
 * test directly with synthetic signals.
 */
export function scoreCandidate(
  signals: MemberSignals,
  context: GroupScoringContext,
  weights: ImageOriginConfig["scoring"]["weights"],
  penalties: ImageOriginConfig["scoring"]["penalties"],
): CandidateScore {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const disqualifiedReasons: string[] = [];

  // Native detail: relative to the sharpest member of the group.
  const nativeDetail =
    context.maxDetailScore > 0
      ? weights.nativeDetail * (signals.detailScore / context.maxDetailScore)
      : weights.nativeDetail;
  if (nativeDetail >= weights.nativeDetail * 0.99) {
    reasons.push("contains the highest measurable genuine detail in this group");
  }

  // Effective resolution (§17.3): raw pixel count, discounted by how much
  // of the frame a crop actually retains — a cropped image's "effective"
  // content is smaller than its pixel count alone suggests.
  const resolutionFraction = signals.pixelCount / context.maxPixelCount;
  const retainedFactor = signals.isCrop ? (signals.cropRetainedArea ?? 1) : 1;
  const effectiveResolution = weights.effectiveResolution * resolutionFraction * retainedFactor;

  // Completeness / uncropped.
  let completeness: number;
  if (signals.isCrop) {
    completeness = weights.completeness * (signals.cropRetainedArea ?? 0);
    warnings.push(
      `retains only ${((signals.cropRetainedArea ?? 0) * 100).toFixed(0)}% of the full frame (detected crop)`,
    );
  } else {
    completeness = weights.completeness;
    reasons.push("preserves the full, uncropped composition");
  }

  // Bit depth.
  const bitDepth = weights.bitDepth * (signals.bitDepth / context.maxBitDepth);

  // Alpha preservation.
  const alphaPreservation = signals.hasAlpha ? weights.alphaPreservation : 0;

  // ICC profile.
  const iccProfile = signals.iccPresent ? weights.iccProfile : 0;
  if (signals.iccPresent) {
    reasons.push("contains an embedded ICC profile");
  }

  // Useful metadata.
  const usefulMetadata =
    context.maxMetadataCount > 0
      ? weights.usefulMetadata * (signals.metadataCount / context.maxMetadataCount)
      : 0;

  // Preferred source path: no configured preferences -> neutral half marks; otherwise scaled by sign.
  let preferredSourcePath: number;
  if (signals.pathPreferenceScore > 0) {
    preferredSourcePath = weights.preferredSourcePath;
    reasons.push("path matches a configured preferred-source pattern");
  } else if (signals.pathPreferenceScore < 0) {
    preferredSourcePath = 0;
    warnings.push("path matches a configured deprioritised-source pattern");
  } else {
    preferredSourcePath = weights.preferredSourcePath / 2;
  }

  const components: ScoreComponents = {
    nativeDetail,
    effectiveResolution,
    completeness,
    bitDepth,
    alphaPreservation,
    iccProfile,
    usefulMetadata,
    preferredSourcePath,
  };

  // Penalties.
  const appliedPenalties: ScorePenalties = {
    probableUpscale: 0,
    confirmedCrop: 0,
    missingAlphaAvailableElsewhere: 0,
    metadataStrippedRelativeToGroup: 0,
  };

  if (signals.isProbableUpscale) {
    appliedPenalties.probableUpscale = penalties.probableUpscale;
    warnings.push("probable upscale: shows no measurable extra detail over a smaller candidate");
    if (context.anyNonUpscaleCandidateExists) {
      disqualifiedReasons.push(
        "probable upscale, and a genuine (non-upscaled) candidate exists in this group",
      );
    }
  }

  if (signals.isCrop) {
    appliedPenalties.confirmedCrop = penalties.confirmedCrop;
    if (context.anyCompleteCandidateExists) {
      disqualifiedReasons.push(
        "confirmed crop, and a complete (uncropped) candidate exists in this group",
      );
    }
  }

  if (!signals.hasAlpha && context.anyOtherGenuineAlpha(signals.recordId)) {
    appliedPenalties.missingAlphaAvailableElsewhere = penalties.missingAlphaAvailableElsewhere;
    warnings.push("lacks transparency that another candidate in this group has");
    disqualifiedReasons.push("missing meaningful transparency available elsewhere in this group");
  }

  if (signals.metadataCount === 0 && context.maxMetadataCount > 0) {
    appliedPenalties.metadataStrippedRelativeToGroup = penalties.metadataStrippedRelativeToGroup;
    warnings.push("has no EXIF/IPTC/XMP metadata, unlike another candidate in this group");
  }

  const componentTotal = Object.values(components).reduce((sum, value) => sum + value, 0);
  const penaltyTotal = Object.values(appliedPenalties).reduce((sum, value) => sum + value, 0);
  const total = Math.max(0, Math.min(100, componentTotal - penaltyTotal));

  return {
    recordId: signals.recordId,
    total,
    components,
    penalties: appliedPenalties,
    reasons,
    warnings,
    disqualified: disqualifiedReasons.length > 0,
    disqualifiedReasons,
  };
}
