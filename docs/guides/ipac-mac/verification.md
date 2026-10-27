# Guide verification

Artifact: `output/pdf/ipac-mac-keyboard.pdf`, six US Letter pages.

SHA-256: `ade71e04e4a5b70ebe740ff7f851c3fbaccc71cf0f11b8003c15e0da25637c5a`.

The commands in [README.md](README.md) regenerated the document with ReportLab 4.4.10. A second build to a different path compared byte-for-byte equal. PyMuPDF 1.26.5 and pypdf 6.9.1 agreed on six pages. Automated QA found no out-of-page text, replacement glyphs, or non-HTTPS external annotations. The PDF has 20 external links across its pages. This checks link annotation structure, not future availability of external sites.

## Visual review

Every page was rendered at 108 dpi and opened for visual inspection. Later edits changed the combination-test wording on page 3 and made the ground-chain connection explicit on page 1. Both changed pages were rendered and inspected again.

| Page | Inspected result |
| --- | --- |
| 1 | First circuit diagram, contact labels, source links, and pre-USB check fit without overlap. |
| 2 | Mac steps, pass condition, and troubleshooting table remain on one page. |
| 3 | All six worksheet rows fit with room for handwritten input identities. No split table. |
| 4 | Spinner fields and fabrication table fit. No mechanical dimensions or pin positions are invented. |
| 5 | Separate power-path diagram, LED prerequisites, and accessory references remain legible. |
| 6 | Manual command lines fit the code blocks. Installation fields and next-step notes clear the footer. |

The isolated QA folder also contains extracted text and a JSON receipt. Run the documented command to recreate them. Preview PNGs and temporary environments are not repository deliverables.

## Source and scope checks

A separate source reviewer checked the harness-specific instructions, switch-contact distinctions, accessory approval, mode-change risk, and direct SpinTrak path. The guide incorporates those corrections. [sources.md](sources.md) records the primary pages and their limits.

The final independent GPT-6 Astra review returned PASS after two repairs: the explicit board-GND connection and the tested Python interpreter recipe. That reviewer rebuilt the PDF byte for byte and inspected all six pages. No blocking, major, minor, code-comment, or decision-trail findings remained.

No app source changed, so app builds and audio test suites were not rerun for this documentation milestone. No physical I-PAC was enumerated, opened, read, written, or configured. No firmware or key mapping was changed. USB adapter data compatibility, actual switch reports, pedal conductors, spinner axis/sign, LED insert compatibility, and fabrication fit remain unverified until the operator tests them.
