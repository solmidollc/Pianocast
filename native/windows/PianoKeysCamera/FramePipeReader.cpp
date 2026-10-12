#include "FramePipeReader.h"

#include <cstring>

namespace pianokeys {

namespace {
constexpr const wchar_t* kPipeName = L"\\\\.\\pipe\\pianokeys-vcam";
constexpr size_t kHeaderSize = 40;
constexpr uint32_t kMaxPayload = 64 * 1024 * 1024;

inline uint32_t ReadU32(const uint8_t* b) {
    return static_cast<uint32_t>(b[0]) | (static_cast<uint32_t>(b[1]) << 8) |
           (static_cast<uint32_t>(b[2]) << 16) | (static_cast<uint32_t>(b[3]) << 24);
}
inline uint64_t ReadU64(const uint8_t* b) {
    uint64_t v = 0;
    for (int i = 0; i < 8; ++i) v |= static_cast<uint64_t>(b[i]) << (8 * i);
    return v;
}
}  // namespace

FramePipeReader::FramePipeReader(OnFrame on_frame)
    : on_frame_(std::move(on_frame)) {}

FramePipeReader::~FramePipeReader() { Stop(); }

void FramePipeReader::Start() {
    stop_.store(false);
    thread_ = std::thread(&FramePipeReader::Run, this);
}

void FramePipeReader::Stop() {
    stop_.store(true);
    if (pipe_ != INVALID_HANDLE_VALUE) {
        // Close to unblock a pending ReadFile in the worker.
        CancelIoEx(pipe_, nullptr);
        CloseHandle(pipe_);
        pipe_ = INVALID_HANDLE_VALUE;
    }
    if (thread_.joinable()) thread_.join();
}

void FramePipeReader::Run() {
    DWORD backoff_us = 100'000;
    while (!stop_.load()) {
        if (!Connect()) {
            Sleep(backoff_us / 1000);
            backoff_us = std::min<DWORD>(backoff_us * 2, 1'000'000);
            continue;
        }
        backoff_us = 100'000;

        uint8_t header[kHeaderSize];
        while (!stop_.load()) {
            if (!ReadExact(header, kHeaderSize)) break;
            if (!(header[0] == 'P' && header[1] == 'K' &&
                  header[2] == 'V' && header[3] == 'C')) break;
            // header[4..8] = version, header[8..12] = frame kind (assume 1/1)
            uint32_t width  = ReadU32(header + 12);
            uint32_t height = ReadU32(header + 16);
            uint32_t stride = ReadU32(header + 20);
            uint64_t ts     = ReadU64(header + 24);
            uint32_t age    = ReadU32(header + 32);
            uint32_t length = ReadU32(header + 36);
            if (length == 0 || length > kMaxPayload) break;

            Frame frame;
            frame.width = width;
            frame.height = height;
            frame.stride = stride;
            frame.timestampMs = ts;
            frame.inputAgeMs = age;
            frame.pixels.resize(length);
            if (!ReadExact(frame.pixels.data(), length)) break;
            on_frame_(std::move(frame));
        }
        if (pipe_ != INVALID_HANDLE_VALUE) {
            CloseHandle(pipe_);
            pipe_ = INVALID_HANDLE_VALUE;
        }
    }
}

bool FramePipeReader::Connect() {
    pipe_ = CreateFileW(
        kPipeName,
        GENERIC_READ | GENERIC_WRITE,
        0, nullptr, OPEN_EXISTING, FILE_FLAG_OVERLAPPED, nullptr);
    if (pipe_ == INVALID_HANDLE_VALUE) {
        // Wait briefly for the pipe to appear; the host app may be launching.
        return WaitNamedPipeW(kPipeName, 250) != 0;
    }
    DWORD mode = PIPE_READMODE_BYTE;
    SetNamedPipeHandleState(pipe_, &mode, nullptr, nullptr);
    return true;
}

bool FramePipeReader::ReadExact(void* buf, size_t count) {
    auto* p = static_cast<uint8_t*>(buf);
    size_t remaining = count;
    while (remaining > 0) {
        OVERLAPPED ov{};
        ov.hEvent = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        DWORD got = 0;
        BOOL ok = ReadFile(pipe_, p, static_cast<DWORD>(remaining), &got, &ov);
        if (!ok && GetLastError() == ERROR_IO_PENDING) {
            ok = GetOverlappedResult(pipe_, &ov, &got, TRUE);
        }
        CloseHandle(ov.hEvent);
        if (!ok || got == 0) return false;
        p += got;
        remaining -= got;
    }
    return true;
}

}  // namespace pianokeys
