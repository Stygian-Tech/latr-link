# Native L@tr.link mark

`mark.svg` is the shared flat vector tracing of the canonical cursive L and outer loop from the existing L@tr.link brand artwork. The foreground is white on transparency, with no tile, outer frame or baked shadow. Platform icon systems provide their backgrounds, masks, lighting and theme colors.

The SVG uses a 1024-unit viewport, one continuous path, a 56-unit stroke and round caps/joins. Android's `ic_launcher_foreground.xml` copies that path unchanged and applies a 0.09 scale plus 7.92-unit translation in a 108dp viewport. This preserves the mark inside the central 66dp safe area. Its adaptive icon uses the same foreground as the Android 13+ monochrome layer.

Keep the SVG path and Android `pathData` synchronized when the mark changes. Apple Icon Composer uses an outlined copy of this SVG as its foreground source. Run `swift packages/native-brand/export-apple-mark.swift` from the repository root on macOS to regenerate it using Core Graphics. Outlining preserves the open interior when Icon Composer applies dark-mode fill overrides. The checked-in output lets other build hosts compile without running the exporter.
