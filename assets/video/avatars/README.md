# Static character avatars

`../characters.json` publishes one `publishedAvatarPath` for each of the 51 canonical IDs. Each path is `assets/video/avatars/<ID>.png`, relative to the repository root. The application may prefix `/` when serving repository assets. These are transparent 640 × 800 full-character snapshots; use contain fitting and preserve aspect ratio. They do not define voice assignments, dance state, or musical timing.

All files are byte-for-byte copies of existing artwork, with no new generation or transformation. `manifest.json` records hashes, selected source paths, exact Figma pose references, source generation provenance, canvas sizes, bounds, and review status. The source paths are provenance references; consumers only need the PNGs and registry. The manifest includes the source provenance so this handoff does not require importing expansion or dance directories.

Five snapshots—A02, A03, A07, A29 and C06—come from the repainted, reviewed pixel-final families. The other 46 use their existing Mid-fi `Pose=0` library preview. Their status is `gallery-preview`: they retain the earlier gallery review and are available as static UI previews, but have not passed the new repaint gate for finished sprite-sheet/video use. This handoff does not upgrade them to pixel-final.

The static review checked every image against its labelled identity, inspected silhouettes, transparency, crop and readability, and found no blocking defects for preview avatars. All 51 referenced components were read from the live Figma file and have the expected 640 × 800 canvas; see `figma-verification.json`. File hashes and binary alpha were verified independently of the source directories.

Validate this self-contained handoff from the repository root:

```sh
node --import tsx scripts/video-expansion/check-static-avatars.mts
```

`publish-static-avatars.mts` is the authoring recipe. Rerunning it requires the full Video authoring checkout with the recorded source assets; the runtime contract and verification command do not.
