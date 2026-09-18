# Lightning bolt identity

Replace the pixel robot with a simple, solid lightning bolt as requested after
reviewing v1.8.5. Use one clean vector silhouette without pixelation, fading,
glow, or extra detail. Keep the existing amber desktop color, dark rounded tile,
and theme-colored app-bar mask.

The shared `build/mark.svg` continues to drive both surfaces. Remove forced
pixel-edge rendering from the desktop generator so diagonal edges stay smooth.
Regenerate all desktop icon assets and inspect the app-bar and small OS sizes.
Queue the change without a version bump or release.
