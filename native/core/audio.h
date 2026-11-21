// PodStudio native core: audio containers and file I/O. No operating-system code lives in core/, so everything
// here builds and is tested on Linux as well as Windows.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace ps {

constexpr int kRate = 48000;                 // every PodStudio session is 48 kHz

// Interleaved float audio. float keeps an hour of stereo at 1.4 GB instead of the 2.8 GB doubles would take;
// all accumulation (loudness, filters) is done in double.
struct Audio {
    int channels = 2;
    int rate = kRate;
    std::vector<float> data;                 // frames * channels
    size_t frames() const { return channels ? data.size() / channels : 0; }
    float* frame(size_t i) { return &data[i * channels]; }
    const float* frame(size_t i) const { return &data[i * channels]; }
};

// Reads PCM 16/24/32-bit and IEEE float WAV files (including files whose header was never finalised after a
// crash: the data chunk is taken to run to the end of the file). Returns false and sets err on failure.
bool read_wav(const std::string& path, Audio& out, std::string& err);

// Writes 24-bit PCM atomically (to path + ".part", then renamed), so a reader never sees a half-written file.
bool write_wav24(const std::string& path, const Audio& audio, std::string& err);

// Streaming 24-bit mono/stereo WAV writer for recording. The header is rewritten every second or so, so a crash
// or power cut leaves a file that read_wav() can still open and whose length is right to within a second.
class WavWriter {
public:
    WavWriter() = default;
    ~WavWriter();
    WavWriter(const WavWriter&) = delete;
    WavWriter& operator=(const WavWriter&) = delete;
    bool open(const std::string& path, int channels, int rate, std::string& err);
    bool write(const float* interleaved, size_t frames);   // samples are clipped to [-1, 1]
    bool close();
    bool is_open() const { return f_ != nullptr; }
    size_t frames_written() const { return frames_; }
private:
    void patch_header();
    void* f_ = nullptr;                      // FILE*
    int channels_ = 1, rate_ = kRate;
    size_t frames_ = 0, since_patch_ = 0;
};

}  // namespace ps
