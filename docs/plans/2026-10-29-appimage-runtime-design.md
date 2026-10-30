# AppImage runtime dependency fix

Ship v1.11.1 with electron-builder's static AppImage toolset 1.0.3, supported
by the locked builder version. This removes the host libfuse.so.2 dependency
that blocks first launch on fresh Arch Linux and Omarchy installations.

Keep the AppImage target and managed update metadata. A native pacman package
would add installation and launcher integration, but needs its own dependency
and update validation; it is deferred from this runtime fix.

Remove FUSE2 installation from release CI. Before testing the actual AppImage,
remove any preinstalled FUSE2 runtime and confirm the library is absent. Launch
the AppImage's mount mode and require the mounted AppRun entrypoint to exist.
Retain packaged native-module, GUI, persistence, and instance-lock checks.

Validate release metadata, regression tests, release tooling, production build,
and all platform packages in the release rehearsal. Review updater manifests
and checksums before tagging and publishing the patch release.
