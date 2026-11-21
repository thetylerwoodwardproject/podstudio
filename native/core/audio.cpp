#include "audio.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace ps {
namespace {

uint32_t rd32(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | (uint32_t(p[3]) << 24); }
uint16_t rd16(const uint8_t* p) { return uint16_t(p[0] | (p[1] << 8)); }
void wr32(uint8_t* p, uint32_t v) { p[0] = v; p[1] = v >> 8; p[2] = v >> 16; p[3] = v >> 24; }
void wr16(uint8_t* p, uint16_t v) { p[0] = v; p[1] = v >> 8; }

// 44-byte canonical header for 24-bit PCM.
void make_header(uint8_t h[44], int channels, int rate, uint32_t data_bytes) {
    std::memcpy(h, "RIFF", 4);          wr32(h + 4, 36 + data_bytes);
    std::memcpy(h + 8, "WAVEfmt ", 8);  wr32(h + 16, 16);
    wr16(h + 20, 1);                    wr16(h + 22, uint16_t(channels));
    wr32(h + 24, uint32_t(rate));       wr32(h + 28, uint32_t(rate * channels * 3));
    wr16(h + 32, uint16_t(channels * 3)); wr16(h + 34, 24);
    std::memcpy(h + 36, "data", 4);     wr32(h + 40, data_bytes);
}

void put24(uint8_t* p, float v) {
    v = std::min(1.0f, std::max(-1.0f, v));
    int32_t s = int32_t(std::lrintf(v * 8388607.0f));
    p[0] = uint8_t(s); p[1] = uint8_t(s >> 8); p[2] = uint8_t(s >> 16);
}

}  // namespace

bool read_wav(const std::string& path, Audio& out, std::string& err) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) { err = "cannot open " + path; return false; }
    std::vector<uint8_t> buf;
    uint8_t chunk[1 << 16];
    for (size_t n; (n = std::fread(chunk, 1, sizeof chunk, f)) > 0;) buf.insert(buf.end(), chunk, chunk + n);
    std::fclose(f);
    if (buf.size() < 12 || std::memcmp(buf.data(), "RIFF", 4) || std::memcmp(buf.data() + 8, "WAVE", 4)) {
        err = "not a WAV file"; return false;
    }
    int format = 0, channels = 0, bits = 0, rate = 0;
    size_t pos = 12, data_at = 0, data_len = 0;
    while (pos + 8 <= buf.size()) {
        uint32_t size = rd32(&buf[pos + 4]);
        if (!std::memcmp(&buf[pos], "fmt ", 4) && pos + 8 + 16 <= buf.size()) {
            format = rd16(&buf[pos + 8]); channels = rd16(&buf[pos + 10]);
            rate = int(rd32(&buf[pos + 12])); bits = rd16(&buf[pos + 22]);
            if (format == 0xFFFE && size >= 26) format = rd16(&buf[pos + 32]);     // WAVE_FORMAT_EXTENSIBLE
        } else if (!std::memcmp(&buf[pos], "data", 4)) {
            data_at = pos + 8;
            size_t avail = buf.size() - data_at;
            // A recording that never got its final header has a zero or stale size: trust the file length instead.
            data_len = (size == 0 || size == 0xFFFFFFFFu || size > avail) ? avail : size;
            break;
        }
        pos += 8 + size + (size & 1);
    }
    if (!channels || !data_at) { err = "no audio data"; return false; }
    int bytes = bits / 8;
    bool ok_fmt = (format == 1 && (bits == 16 || bits == 24 || bits == 32)) || (format == 3 && bits == 32);
    if (!ok_fmt) { err = "unsupported WAV format"; return false; }
    size_t frames = data_len / (size_t(bytes) * channels);
    out.channels = channels; out.rate = rate;
    out.data.assign(frames * channels, 0.0f);
    const uint8_t* p = &buf[data_at];
    for (size_t i = 0; i < frames * channels; i++, p += bytes) {
        float v;
        if (format == 3) { uint32_t u = rd32(p); std::memcpy(&v, &u, 4); }
        else if (bits == 16) v = int16_t(rd16(p)) / 32768.0f;
        else if (bits == 24) { int32_t s = (p[0] | (p[1] << 8) | (p[2] << 16)); if (s & 0x800000) s -= 0x1000000; v = s / 8388608.0f; }
        else v = int32_t(rd32(p)) / 2147483648.0f;
        out.data[i] = v;
    }
    return true;
}

bool write_wav24(const std::string& path, const Audio& a, std::string& err) {
    std::string tmp = path + ".part";
    FILE* f = std::fopen(tmp.c_str(), "wb");
    if (!f) { err = "cannot write " + tmp; return false; }
    uint8_t h[44];
    make_header(h, a.channels, a.rate, uint32_t(a.data.size() * 3));
    bool ok = std::fwrite(h, 1, 44, f) == 44;
    std::vector<uint8_t> block(3 * (1 << 16));
    for (size_t i = 0; ok && i < a.data.size(); i += (1 << 16)) {
        size_t n = std::min<size_t>(1 << 16, a.data.size() - i);
        for (size_t k = 0; k < n; k++) put24(&block[k * 3], a.data[i + k]);
        ok = std::fwrite(block.data(), 3, n, f) == n;
    }
    ok = (std::fclose(f) == 0) && ok;
    if (!ok) { err = "write failed"; std::remove(tmp.c_str()); return false; }
    std::remove(path.c_str());                       // rename() does not overwrite on Windows
    if (std::rename(tmp.c_str(), path.c_str()) != 0) { err = "cannot replace " + path; return false; }
    return true;
}

WavWriter::~WavWriter() { close(); }

bool WavWriter::open(const std::string& path, int channels, int rate, std::string& err) {
    close();
    FILE* f = std::fopen(path.c_str(), "wb");
    if (!f) { err = "cannot create " + path; return false; }
    f_ = f; channels_ = channels; rate_ = rate; frames_ = since_patch_ = 0;
    uint8_t h[44];
    make_header(h, channels, rate, 0);
    if (std::fwrite(h, 1, 44, f) != 44) { err = "write failed"; close(); return false; }
    return true;
}

bool WavWriter::write(const float* x, size_t frames) {
    if (!f_) return false;
    std::vector<uint8_t> b(frames * channels_ * 3);
    for (size_t i = 0; i < frames * channels_; i++) put24(&b[i * 3], x[i]);
    if (std::fwrite(b.data(), 1, b.size(), static_cast<FILE*>(f_)) != b.size()) return false;
    frames_ += frames; since_patch_ += frames;
    if (since_patch_ >= size_t(rate_)) patch_header();                 // about once a second
    return true;
}

void WavWriter::patch_header() {
    FILE* f = static_cast<FILE*>(f_);
    uint8_t h[44];
    make_header(h, channels_, rate_, uint32_t(frames_ * channels_ * 3));
    std::fflush(f);
    std::fseek(f, 0, SEEK_SET);
    std::fwrite(h, 1, 44, f);
    std::fseek(f, 0, SEEK_END);
    std::fflush(f);
    since_patch_ = 0;
}

bool WavWriter::close() {
    if (!f_) return true;
    patch_header();
    bool ok = std::fclose(static_cast<FILE*>(f_)) == 0;
    f_ = nullptr;
    return ok;
}

}  // namespace ps
