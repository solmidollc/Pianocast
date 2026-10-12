#pragma once

#include <windows.h>
#include <atomic>
#include <thread>
#include <functional>
#include <vector>
#include <cstdint>

namespace pianokeys {

struct Frame {
    uint32_t width;
    uint32_t height;
    uint32_t stride;
    uint64_t timestampMs;
    uint32_t inputAgeMs;
    std::vector<uint8_t> pixels;  // BGRA, top-down
};

// Connects to \\.\pipe\pianokeys-vcam, decodes the PKVC wire protocol, and
// invokes onFrame on each delivered frame.
//
// Re-connects with backoff if the host app is not running yet. Stop() is
// safe to call from any thread.
class FramePipeReader {
public:
    using OnFrame = std::function<void(Frame&&)>;

    explicit FramePipeReader(OnFrame on_frame);
    ~FramePipeReader();

    void Start();
    void Stop();

private:
    void Run();
    bool Connect();
    bool ReadExact(void* buf, size_t count);

    OnFrame on_frame_;
    std::atomic<bool> stop_{false};
    std::thread thread_;
    HANDLE pipe_{INVALID_HANDLE_VALUE};
};

}  // namespace pianokeys
