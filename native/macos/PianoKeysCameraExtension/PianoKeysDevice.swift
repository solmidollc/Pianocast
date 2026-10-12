import Foundation
import CoreMediaIO
import CoreVideo

/// Virtual camera device. Holds a single BGRA 1920x1080 60fps stream.
final class PianoKeysDevice: NSObject, CMIOExtensionDeviceSource {
    let device: CMIOExtensionDevice
    let streamSource: PianoKeysStream

    init(localizedName: String) {
        // Stable UUID; identifies the device across reboots so consumer apps
        // remember it as the same device.
        let deviceID = UUID(uuidString: "F8B8B0A8-1A4B-49D6-A23E-9F5BE7E4F7DE")!
        device = CMIOExtensionDevice(
            localizedName: localizedName,
            deviceID: deviceID,
            legacyDeviceID: nil,
            source: nil
        )
        streamSource = PianoKeysStream(parentDevice: device)
        super.init()
        device.source = self
        do {
            try device.addStream(streamSource.stream)
        } catch {
            NSLog("[PianoKeys] addStream failed: \(error.localizedDescription)")
        }
    }

    var availableProperties: Set<CMIOExtensionProperty> {
        [.deviceTransportType, .deviceModel]
    }

    func deviceProperties(
        forProperties properties: Set<CMIOExtensionProperty>
    ) throws -> CMIOExtensionDeviceProperties {
        let p = CMIOExtensionDeviceProperties(dictionary: [:])
        if properties.contains(.deviceTransportType) {
            p.transportType = NSNumber(value: kIOAudioDeviceTransportTypeVirtual)
        }
        if properties.contains(.deviceModel) {
            p.model = "Piano Keys 1.0"
        }
        return p
    }

    func setDeviceProperties(_ deviceProperties: CMIOExtensionDeviceProperties) throws {}
}
