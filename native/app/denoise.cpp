#include "denoise.h"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <filesystem>

#include "../core/audio.h"
#include "platform.h"

namespace fs = std::filesystem;

namespace denoise {

std::string find_binary() {
    std::vector<std::string> c;
    if (const char* e = std::getenv("PODSTUDIO_DEEPFILTER")) c.push_back(e);
    const std::string d = platform::exe_dir();
#ifdef _WIN32
    const char* name = "deep-filter.exe";
#else
    const char* name = "deep-filter";
#endif
    c.push_back((fs::path(d) / name).string());
    c.push_back((fs::path(d) / "bin" / name).string());
    if (const char* path = std::getenv("PATH")) {
        std::string p = path;
#ifdef _WIN32
        const char sep = ';';
#else
        const char sep = ':';
#endif
        size_t s = 0;
        while (s <= p.size()) {
            size_t e = p.find(sep, s);
            if (e == std::string::npos) e = p.size();
            if (e > s) c.push_back((fs::path(p.substr(s, e - s)) / name).string());
            s = e + 1;
        }
    }
    for (auto& x : c) { std::error_code ec; if (!x.empty() && fs::is_regular_file(x, ec)) return x; }
    return "";
}

bool available() { return !find_binary().empty(); }

std::string run(const std::string& src, const std::string& dst, double atten_db) {
    const std::string bin = find_binary();
    if (bin.empty()) return "DeepFilterNet (deep-filter) is not installed";
    ps::Audio a; std::string err;
    if (!ps::read_wav(src, a, err)) return err;
    if (a.rate != ps::kRate) return "expected 48000 Hz audio";
    std::error_code ec;
    fs::path tmp = fs::temp_directory_path(ec) / ("podstudio-dfn-" + std::to_string(std::rand()));
    fs::create_directories(tmp / "out", ec);
    struct Cleanup { fs::path p; ~Cleanup() { std::error_code e; fs::remove_all(p, e); } } cleanup{tmp};
    // deep-filter's WAV reader rejects 24-bit files; 32-bit float carries our 24-bit audio without loss
    if (!ps::write_wav_float((tmp / "in.wav").string(), a, err)) return err;
    char att[32]; std::snprintf(att, sizeof att, "%.1f", std::max(0.0, atten_db));
    std::string out;
    int rc = platform::run_process({bin, "-D", "-a", att, "-o", (tmp / "out").string(), (tmp / "in.wav").string()}, out, 3600);
    if (rc != 0 || !fs::exists(tmp / "out" / "in.wav")) {
        while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back();
        size_t nl = out.find_last_of('\n');
        return "deep-filter failed: " + (out.empty() ? std::string("no output") : out.substr(nl == std::string::npos ? 0 : nl + 1));
    }
    ps::Audio clean;
    if (!ps::read_wav((tmp / "out" / "in.wav").string(), clean, err)) return err;
    if (clean.rate != a.rate) return "unexpected sample rate from deep-filter";
    clean.channels = a.channels;
    clean.data.resize(a.data.size(), 0.0f);                // delay compensation trims the tail slightly: pad it back
    if (!ps::write_wav24(dst, clean, err)) return err;
    return "";
}

}  // namespace denoise
