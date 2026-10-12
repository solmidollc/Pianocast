import Foundation

/// A single decoded frame from the PKVC wire protocol.
struct PKFrame {
    let width: UInt32
    let height: UInt32
    let stride: UInt32
    /// Producer-side timestamp (Date.now() in the Electron main process).
    let timestampMs: UInt64
    /// Wall-clock age of the most recent MIDI event at frame capture time.
    let inputAgeMs: UInt32
    /// BGRA, row-major, top-down.
    let pixels: Data
}

/// Reads PKVC packets off the Unix domain socket the Electron app exposes and
/// publishes them via the `onFrame` callback. Reconnects with backoff if the
/// app disappears.
final class FrameSocketReader {
    private static let socketPath = "/tmp/pianokeys-vcam/frames.sock"
    private static let magic: [UInt8] = [0x50, 0x4B, 0x56, 0x43] // 'PKVC'
    private static let headerSize = 40

    private let onFrame: (PKFrame) -> Void
    private var thread: Thread?
    private var fd: Int32 = -1
    private var stopped = false

    init(onFrame: @escaping (PKFrame) -> Void) {
        self.onFrame = onFrame
    }

    func start() throws {
        stopped = false
        let t = Thread { [weak self] in self?.run() }
        t.name = "pianokeys.frameReader"
        t.qualityOfService = .userInteractive
        thread = t
        t.start()
    }

    func stop() {
        stopped = true
        if fd >= 0 {
            close(fd)
            fd = -1
        }
    }

    private func run() {
        var backoff: UInt32 = 100_000
        while !stopped {
            if !connectSocket() {
                usleep(backoff)
                backoff = min(backoff * 2, 1_000_000)
                continue
            }
            backoff = 100_000
            readLoop()
            if fd >= 0 {
                close(fd)
                fd = -1
            }
        }
    }

    private func connectSocket() -> Bool {
        fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let path = Self.socketPath
        let pathBytes = path.utf8CString
        guard pathBytes.count <= MemoryLayout.size(ofValue: addr.sun_path) else {
            close(fd); fd = -1; return false
        }
        withUnsafeMutablePointer(to: &addr.sun_path) { ptr in
            ptr.withMemoryRebound(to: CChar.self, capacity: pathBytes.count) { dest in
                _ = pathBytes.withUnsafeBufferPointer { src in
                    memcpy(dest, src.baseAddress, pathBytes.count)
                }
            }
        }
        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        let result = withUnsafePointer(to: &addr) { p -> Int32 in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.connect(fd, $0, len)
            }
        }
        if result != 0 {
            close(fd); fd = -1
            return false
        }
        return true
    }

    private func readLoop() {
        var header = [UInt8](repeating: 0, count: Self.headerSize)
        while !stopped {
            guard readExact(into: &header, count: Self.headerSize) else { return }
            guard header[0] == Self.magic[0],
                  header[1] == Self.magic[1],
                  header[2] == Self.magic[2],
                  header[3] == Self.magic[3] else { return }
            // version at 4..8, frame kind at 8..12 — assumed 1/1.
            let width  = readU32(header, 12)
            let height = readU32(header, 16)
            let stride = readU32(header, 20)
            let ts     = readU64(header, 24)
            let age    = readU32(header, 32)
            let length = readU32(header, 36)
            if length == 0 || length > 64 * 1024 * 1024 { return }
            var payload = Data(count: Int(length))
            let ok = payload.withUnsafeMutableBytes { raw -> Bool in
                guard let base = raw.baseAddress else { return false }
                return readExact(intoRaw: base, count: Int(length))
            }
            if !ok { return }
            onFrame(PKFrame(
                width: width,
                height: height,
                stride: stride,
                timestampMs: ts,
                inputAgeMs: age,
                pixels: payload
            ))
        }
    }

    private func readExact(into buf: UnsafeMutablePointer<UInt8>, count: Int) -> Bool {
        var remaining = count
        var ptr = buf
        while remaining > 0 {
            let n = read(fd, ptr, remaining)
            if n <= 0 { return false }
            remaining -= n
            ptr = ptr.advanced(by: n)
        }
        return true
    }
    private func readExact(into array: inout [UInt8], count: Int) -> Bool {
        return array.withUnsafeMutableBufferPointer { buf in
            guard let base = buf.baseAddress else { return false }
            return readExact(into: base, count: count)
        }
    }
    private func readExact(intoRaw: UnsafeMutableRawPointer, count: Int) -> Bool {
        var remaining = count
        var ptr = intoRaw
        while remaining > 0 {
            let n = read(fd, ptr, remaining)
            if n <= 0 { return false }
            remaining -= n
            ptr = ptr.advanced(by: n)
        }
        return true
    }

    private func readU32(_ b: [UInt8], _ o: Int) -> UInt32 {
        return UInt32(b[o]) | (UInt32(b[o+1]) << 8) | (UInt32(b[o+2]) << 16) | (UInt32(b[o+3]) << 24)
    }
    private func readU64(_ b: [UInt8], _ o: Int) -> UInt64 {
        var v: UInt64 = 0
        for i in 0..<8 { v |= UInt64(b[o+i]) << (8 * i) }
        return v
    }
}
