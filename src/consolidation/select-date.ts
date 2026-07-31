import type { ImageRecord } from "../domain/image-record.js";

export type DateSource = "metadata-capture-date" | "filesystem-modified-weak" | "unknown-date";

export interface SelectedDate {
  date?: Date;
  source: DateSource;
}

/**
 * Date-selection order for date-based canonical paths (PLAN.md §22.3).
 * The current data model only carries one "trusted" date
 * (`metadata.captureDate`, from EXIF `DateTimeOriginal`/`DateTime` — see
 * `src/inventory/exif.ts`), which covers both the plan's "trusted capture
 * date" and "trusted embedded metadata date" tiers; there is no separate
 * sensor-vs-metadata distinction to make. "Configured source date" (a
 * per-input override) has no corresponding config field yet and is
 * skipped rather than invented. Filesystem modification time is used only
 * as an explicitly weak fallback — callers must surface `source ===
 * "filesystem-modified-weak"` as a warning rather than treating it as a
 * trustworthy capture date (PLAN.md: "do not silently treat filesystem
 * modification time as capture date").
 */
export function selectDate(record: ImageRecord): SelectedDate {
  if (record.metadata.captureDate) {
    const capture = new Date(record.metadata.captureDate);
    if (!Number.isNaN(capture.getTime())) {
      return { date: capture, source: "metadata-capture-date" };
    }
  }

  const modified = new Date(record.file.modifiedAt);
  if (!Number.isNaN(modified.getTime())) {
    return { date: modified, source: "filesystem-modified-weak" };
  }

  return { source: "unknown-date" };
}
