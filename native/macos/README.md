# Piano Keys — macOS Virtual Camera Extension

This directory contains the Swift sources for a macOS Core Media IO camera
extension (CMIOExtension) that publishes the Piano Keys composite as a system
virtual camera, selectable in OBS, Zoom, Meet, FaceTime, etc.

## Architecture

```
Electron app
   └── /tmp/pianokeys-vcam/frames.sock     <- BGRA frame stream, 1920x1080@60
                          │
                          ▼
  PianoKeysCameraExtension.systemextension
   └── CMIOExtensionProvider              <- registers the device
        └── CMIOExtensionDevice           <- "Piano Keys"
             └── CMIOExtensionStream      <- BGRA 1920x1080 60fps
                  └── publishes CMSampleBuffer to whoever opens the camera
```

The extension is its own signed binary that the host app installs via
`OSSystemExtensionRequest`. macOS sandboxes the extension; the host app and
extension communicate by reading the same Unix socket path (granted via the
`com.apple.security.temporary-exception.files.absolute-path.read-write`
entitlement). A future revision can move to an XPC service for tighter
isolation.

## Source layout

| File | Role |
|---|---|
| `PianoKeysCameraExtension/main.swift` | Process entry, runs `CMIOExtensionProvider.startService` |
| `PianoKeysCameraExtension/PianoKeysProvider.swift` | Top-level `CMIOExtensionProviderSource` |
| `PianoKeysCameraExtension/PianoKeysDevice.swift` | The virtual camera device |
| `PianoKeysCameraExtension/PianoKeysStream.swift` | Stream + pixel-buffer pool; drains frames into `CMSampleBuffer`s |
| `PianoKeysCameraExtension/FrameSocketReader.swift` | Connects to `/tmp/pianokeys-vcam/frames.sock`, decodes the PKVC binary protocol |
| `PianoKeysCameraExtension/Info.plist` | Extension metadata + Mach service name |
| `PianoKeysCameraExtension/PianoKeysCameraExtension.entitlements` | Sandbox + camera + socket exception |

## One-time Xcode setup

1. Create a macOS App project `PianoKeysCameraHost` (this is a tiny stub host;
   the real host is the Electron app, which embeds the extension bundle inside
   its app bundle under `Contents/Library/SystemExtensions/`).
2. Add a new target → System Extension → Camera Extension. Name it
   `PianoKeysCameraExtension`. Drop the Swift sources in.
3. Set the bundle identifier to `com.pianokeys.app.camera`. The host bundle id
   must be the parent: `com.pianokeys.app`.
4. In Signing & Capabilities for both targets:
   - Team: your Apple Developer team
   - Signing certificate: Developer ID Application (for distribution outside
     the App Store; required for camera extensions)
   - Add capability: System Extension
   - Add capability: App Sandbox → check Camera, Network (Client) is unneeded
5. The provisioning profile must include the entitlement
   `com.apple.developer.system-extension.install`. Apple grants this on
   request — file a request through Developer Support.
6. Build, archive, notarize. The notarized `PianoKeysCameraHost.app` bundle
   contains the extension at
   `Contents/Library/SystemExtensions/PianoKeysCameraExtension.systemextension`.

## Embedding in the Electron app

In your Electron packaging step (e.g. electron-builder `mac.extraResources`),
copy the built `.systemextension` directory into the Electron `.app` bundle at
`Contents/Library/SystemExtensions/`. The signing identity of the Electron app
must match the extension's team id.

## Activating at runtime

The Electron app's `pk:vcam:install-ext` IPC fires
`OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier:queue:)`
for `com.pianokeys.app.camera`. macOS prompts the user once to approve in
**System Settings → Privacy & Security**. After approval, the extension stays
registered across reboots.

The Electron side uses a small Swift helper (`PianoKeysExtensionInstaller`)
to drive the activation, because `OSSystemExtensionRequest` is not exposed to
Node. The helper is included at `tools/macos-installer-helper/` (build with
`swiftc`).

## Wire protocol

Each frame on the socket is one PKVC packet:

```
offset  size  field
   0     4    magic 'PKVC'
   4     4    version (u32 LE) = 1
   8     4    frame kind (u32 LE) = 1 (video)
  12     4    width  (u32 LE)
  16     4    height (u32 LE)
  20     4    row stride bytes (u32 LE)
  24     8    timestamp ms (u64 LE)        <- producer Date.now()
  32     4    input age ms (u32 LE)        <- ms since last MIDI event
  36     4    payload length (u32 LE) = stride * height
  40     N    BGRA8888 pixels, top-down
```

Frames may arrive in bursts; the extension should drain the socket greedily
and keep only the latest frame for the next `send(...)` to the stream — a
"latest wins" policy keeps live latency low.
