import Foundation
import CoreMediaIO

// Process entry point for the camera extension. The system launches this
// binary on demand when an app opens the virtual camera.
CMIOExtensionProvider.startService(provider: PianoKeysProvider.shared.provider)
CFRunLoopRun()
