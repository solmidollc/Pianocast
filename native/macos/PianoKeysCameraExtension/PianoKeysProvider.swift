import Foundation
import CoreMediaIO

/// Top-level provider — registers the device with the system.
final class PianoKeysProvider: NSObject, CMIOExtensionProviderSource {
    static let shared = PianoKeysProvider()

    private(set) var provider: CMIOExtensionProvider!
    private let device: PianoKeysDevice

    override init() {
        device = PianoKeysDevice(localizedName: "Piano Keys")
        super.init()
        provider = CMIOExtensionProvider(source: self, clientQueue: nil)
        do {
            try provider.addDevice(device.device)
        } catch {
            NSLog("[PianoKeys] addDevice failed: \(error.localizedDescription)")
        }
    }

    func connect(to client: CMIOExtensionClient) throws {}
    func disconnect(from client: CMIOExtensionClient) {}

    var availableProperties: Set<CMIOExtensionProperty> {
        [.providerName, .providerManufacturer]
    }

    func providerProperties(
        forProperties properties: Set<CMIOExtensionProperty>
    ) throws -> CMIOExtensionProviderProperties {
        let p = CMIOExtensionProviderProperties(dictionary: [:])
        if properties.contains(.providerName) { p.name = "Piano Keys" }
        if properties.contains(.providerManufacturer) { p.manufacturer = "Piano Keys" }
        return p
    }

    func setProviderProperties(_ providerProperties: CMIOExtensionProviderProperties) throws {}
}
