# Pixel robot identity

Replace the title-bar diamond and desktop wizard hat with the same robot head.
Keep the warm amber brand color, a simple pixel silhouette, and one fully legible
eye. Fade the other half of the face in discrete opacity steps, with separated
pixels along the edge. Avoid blur so the mark stays legible at small sizes.

Use one 16-unit SVG mark as the source. The title bar uses a theme-colored CSS
mask; desktop icons place the amber mark on a charcoal rounded tile. Generate
Windows multi-size ICO and Linux/macOS PNG sources with the existing Electron
dependency. The release workflow continues to build the macOS ICNS from its
1024px source.

Review the mark at title-bar and OS icon sizes and verify the packaged assets.
The user requested publication after completion: include the queued sidebar and
update-banner polish in patch release v1.8.5.
