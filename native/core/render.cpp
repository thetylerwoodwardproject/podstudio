#include "render.h"

#include <algorithm>
#include <cmath>

namespace ps {

bool read_stereo(const std::string& path, Audio& out, std::string& err) {
    Audio a;
    if (!read_wav(path, a, err)) return false;
    if (a.rate != kRate) { err = path + ": expected 48000 Hz audio"; return false; }
    if (a.channels == 2) { out = std::move(a); return true; }
    out.channels = 2; out.rate = kRate;
    out.data.resize(a.frames() * 2);
    for (size_t i = 0; i < a.frames(); i++) {
        out.data[i * 2] = a.data[i * a.channels];
        out.data[i * 2 + 1] = a.channels > 1 ? a.data[i * a.channels + 1] : a.data[i * a.channels];
    }
    return true;
}

namespace {

// A held, toggled or looped hit lasts `dur` (a loop with no end runs to the end of the take); cut ends get a 10 ms fade.
Audio shape_clip(const Audio& clip, const std::optional<double>& dur, bool loop, double room_s) {
    Audio out; out.channels = 2;
    size_t n;
    if (loop) {
        n = size_t(std::max(0.0, std::llround((dur ? *dur : room_s) * kRate) * 1.0));
        if (n == 0 || clip.frames() == 0) return out;
        out.data.resize(n * 2);
        for (size_t i = 0; i < n; i++) { size_t s = i % clip.frames(); out.data[i * 2] = clip.data[s * 2]; out.data[i * 2 + 1] = clip.data[s * 2 + 1]; }
    } else if (dur) {
        n = size_t(std::max(0LL, std::llround(*dur * kRate)));
        if (n >= clip.frames()) return clip;
        out.data.assign(clip.data.begin(), clip.data.begin() + n * 2);
    } else {
        return clip;
    }
    size_t fade = std::min<size_t>(out.frames(), size_t(0.010 * kRate));
    for (size_t i = 0; i < fade; i++) {
        float g = fade > 1 ? 1.0f - float(i) / float(fade - 1) : 0.0f;
        size_t at = out.frames() - fade + i;
        out.data[at * 2] *= g; out.data[at * 2 + 1] *= g;
    }
    return out;
}

}  // namespace

double clip_gain_db(const Audio& clip) {
    double peak = 0;
    for (float v : clip.data) peak = std::max(peak, double(std::fabs(v)));
    if (peak < 1e-5) return 0.0;
    std::optional<double> lufs = clip.frames() >= size_t(0.5 * kRate) ? integrated_loudness(clip) : std::nullopt;
    double want = lufs ? (-22.0 - *lufs) : (-9.0 - lin_to_db(peak));
    want = std::min(want, -3.0 - lin_to_db(peak));
    return std::max(-40.0, std::min(12.0, want));
}

bool render_hotkeys(const Project& p, double length_s, Audio& plain, Audio& duckable, std::string& err) {
    const size_t total = std::max<size_t>(size_t(std::llround(length_s * kRate)), 1);
    for (Audio* a : {&plain, &duckable}) { a->channels = 2; a->rate = kRate; a->data.assign(total * 2, 0.0f); }
    std::vector<std::pair<std::string, Audio>> cache;
    for (const Event& ev : p.events) {
        const std::string path = p.clips_dir() + "/" + ev.clip;
        if (!file_exists(path)) continue;
        auto it = std::find_if(cache.begin(), cache.end(), [&](auto& c) { return c.first == ev.clip; });
        if (it == cache.end()) {
            Audio c;
            if (!read_stereo(path, c, err)) return false;
            cache.push_back({ev.clip, std::move(c)});
            it = cache.end() - 1;
        }
        size_t start = size_t(std::max(0LL, std::llround(ev.t * kRate)));
        if (start >= total) continue;
        Audio clip = shape_clip(it->second, ev.dur, ev.loop, double(total - start) / kRate);
        const float g = float(db_to_lin(ev.gain_db));
        Audio& dst = ev.duck ? duckable : plain;
        size_t n = std::min(clip.frames(), total - start);
        for (size_t i = 0; i < n * 2; i++) dst.data[start * 2 + i] += clip.data[i] * g;
    }
    return true;
}

MasterResult mix_master(Project& p, const DenoiseFn& denoise, const std::function<void(const std::string&)>& progress) {
    MasterResult r;
    auto tick = [&](const char* m) { if (progress) progress(m); };
    std::string mic_path = p.mic_path();
    if (p.denoise) {
        if (!denoise) r.notes.push_back("Noise reduction isn't available, so the master was rendered without it.");
        else {
            tick("Reducing noise (DeepFilterNet)");
            std::string e = denoise(mic_path, p.clean_path(), p.denoise_atten_db);
            if (e.empty()) { mic_path = p.clean_path(); r.denoised = true; }
            else r.notes.push_back("Noise reduction skipped: " + e);               // never lose the render over a cleanup problem
        }
    }
    std::string err;
    tick("Reading mic take");
    Audio mic;
    if (!read_stereo(mic_path, mic, err)) { r.error = err; return r; }
    tick("Rendering hotkey track");
    Audio plain, duck;
    if (!render_hotkeys(p, double(mic.frames()) / kRate, plain, duck, err)) { r.error = err; return r; }
    {
        Audio stem = plain;                                                         // the stem stays un-ducked
        for (size_t i = 0; i < stem.data.size(); i++) stem.data[i] += duck.data[i];
        if (!write_wav24(p.hotkeys_path(), stem, err)) { r.error = err; return r; }
    }
    r.ducked = std::any_of(duck.data.begin(), duck.data.end(), [](float v) { return v != 0.0f; });
    if (r.ducked) {
        tick("Ducking hotkeys under your voice");
        auto g = voice_duck_gain(mic, p.duck_amount_db, p.duck_threshold_db, p.duck_release_ms);
        for (size_t i = 0; i < duck.frames() && i < g.size(); i++) { duck.data[i * 2] *= float(g[i]); duck.data[i * 2 + 1] *= float(g[i]); }
    }
    const size_t n = std::max(mic.frames(), plain.frames());
    Audio mix; mix.channels = 2; mix.data.assign(n * 2, 0.0f);
    const float mg = float(db_to_lin(p.mic_db)), hg = float(db_to_lin(p.hotkeys_db));
    for (size_t i = 0; i < mic.data.size(); i++) mix.data[i] += mic.data[i] * mg;
    if (!p.hotkeys_muted) for (size_t i = 0; i < plain.data.size(); i++) mix.data[i] += (plain.data[i] + duck.data[i]) * hg;
    plain = Audio(); duck = Audio(); mic = Audio();
    tick("Normalizing loudness and true peak");
    NormalizeResult nr = normalize(mix, p.target_lufs);
    tick("Writing master");
    if (!write_wav24(p.master_path(), mix, err)) { r.error = err; return r; }
    r.ok = true; r.measured_lufs = nr.measured_lufs; r.final_lufs = nr.final_lufs; r.gain_db = nr.gain_db;
    r.true_peak_db = nr.true_peak_db; r.limited = nr.limited;
    return r;
}

}  // namespace ps
