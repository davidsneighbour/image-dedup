# Known limitations

This tool cannot reliably determine:

- historical provenance of an image beyond what filesystem metadata and
  EXIF/IPTC/XMP embed;
- copyright ownership;
- whether an edit (crop, colour grade, watermark) is artistically
  preferable to the original;
- whether a larger image is a genuine higher-resolution source in every
  case (upscaling detection is probabilistic — see PLAN.md §13);
- whether embedded metadata is trustworthy or has been tampered with;
- whether two crops of the same source serve the same editorial purpose.

Explicitly out of scope for this version (see `PLAN.md` §1.2):

- facial or semantic image recognition, object-level matching;
- AI-generated image-quality assessment;
- automatic copyright/licence determination;
- automatic deletion of rejected files;
- destructive EXIF rewriting, automatic retouching, or restoration of
  damaged images;
- automatic choice between meaningfully edited image variants, or
  automatic replacement of visually distinct crops;
- video files, SVG visual comparison, PSD/TIFF/RAW/proprietary formats.

Where the tool is uncertain, it must produce a `manual-review` result
rather than a confident but unsupported recommendation (PLAN.md §35).
