import Foundation
import CoreMediaIO
import CoreVideo
import CoreMedia

/// The single video stream for the Piano Keys device.
///
/// Holds a CVPixelBufferPool sized for 1920x1080 BGRA. On startStream() we
/// spin up the FrameSocketReader, which pulls PKVC frames off the Unix
/// socket. Each frame is copied into a fresh pixel buffer (latest-wins) and
/// sent to the CMIOExtensionStream as a CMSampleBuffer with a host-clock
/// presentation timestamp.
final class PianoKeysStream: NSObject, CMIOExtensionStreamSource {
    let stream: CMIOExtensionStream
    private let activeFormat: CMIOExtensionStreamFormat

    private var pixelBufferPool: CVPixelBufferPool?
    private var formatDescription: CMFormatDescription?
    private var reader: FrameSocketReader?
    private let sendQueue = DispatchQueue(
        label: "com.pianokeys.camera.send",
        qos: .userInteractive
    )

    init(parentDevice: CMIOExtensionDevice) {
        let width: Int32 = 1920
        let height: Int32 = 1080

        var fd: CMFormatDescription?
        CMVideoFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            codecType: kCVPixelFormatType_32BGRA,
            width: width,
            height: height,
            extensions: nil,
            formatDescriptionOut: &fd
        )

        activeFormat = CMIOExtensionStreamFormat(
            formatDescription: fd!,
            maxFrameDuration: CMTime(value: 1, timescale: 60),
            minFrameDuration: CMTime(value: 1, timescale: 60),
            validFrameDurations: nil
        )
        formatDescription = fd

        stream = CMIOExtensionStream(
            localizedName: "Piano Keys Stream",
            streamID: UUID(),
            direction: .source,
            clockType: .hostTime,
            source: nil
        )
        super.init()
        stream.source = self

        let poolAttrs: [String: Any] = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
        CVPixelBufferPoolCreate(
            kCFAllocatorDefault,
            [kCVPixelBufferPoolMinimumBufferCountKey as String: 3] as CFDictionary,
            poolAttrs as CFDictionary,
            &pixelBufferPool
        )
    }

    var formats: [CMIOExtensionStreamFormat] { [activeFormat] }

    var availableProperties: Set<CMIOExtensionProperty> {
        [.streamActiveFormatIndex, .streamFrameDuration]
    }

    func streamProperties(
        forProperties properties: Set<CMIOExtensionProperty>
    ) throws -> CMIOExtensionStreamProperties {
        let p = CMIOExtensionStreamProperties(dictionary: [:])
        if properties.contains(.streamActiveFormatIndex) { p.activeFormatIndex = 0 }
        if properties.contains(.streamFrameDuration) {
            p.frameDuration = CMTime(value: 1, timescale: 60)
        }
        return p
    }

    func setStreamProperties(_ properties: CMIOExtensionStreamProperties) throws {}

    func authorizedToStartStream(for client: CMIOExtensionClient) -> Bool { true }

    func startStream() throws {
        let r = FrameSocketReader { [weak self] frame in
            self?.publish(frame)
        }
        reader = r
        try r.start()
    }

    func stopStream() throws {
        reader?.stop()
        reader = nil
    }

    private func publish(_ frame: PKFrame) {
        guard let pool = pixelBufferPool, let fd = formatDescription else { return }
        sendQueue.async { [weak self] in
            guard let self else { return }

            var pixelBuffer: CVPixelBuffer?
            CVPixelBufferPoolCreatePixelBuffer(
                kCFAllocatorDefault,
                pool,
                &pixelBuffer
            )
            guard let pb = pixelBuffer else { return }

            CVPixelBufferLockBaseAddress(pb, [])
            defer { CVPixelBufferUnlockBaseAddress(pb, []) }

            guard let dst = CVPixelBufferGetBaseAddress(pb) else { return }
            let dstStride = CVPixelBufferGetBytesPerRow(pb)
            let height = Int(frame.height)
            let copyBytesPerRow = min(Int(frame.stride), dstStride)

            frame.pixels.withUnsafeBytes { srcRaw in
                guard let src = srcRaw.baseAddress else { return }
                for row in 0..<height {
                    memcpy(
                        dst.advanced(by: row * dstStride),
                        src.advanced(by: row * Int(frame.stride)),
                        copyBytesPerRow
                    )
                }
            }

            var timing = CMSampleTimingInfo(
                duration: CMTime(value: 1, timescale: 60),
                presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()),
                decodeTimeStamp: .invalid
            )

            var sampleBuffer: CMSampleBuffer?
            CMSampleBufferCreateReadyWithImageBuffer(
                allocator: kCFAllocatorDefault,
                imageBuffer: pb,
                formatDescription: fd,
                sampleTiming: &timing,
                sampleBufferOut: &sampleBuffer
            )
            guard let sb = sampleBuffer else { return }

            self.stream.send(
                sb,
                discontinuity: [],
                hostTimeInNanoseconds: mach_absolute_time()
            )
        }
    }
}
