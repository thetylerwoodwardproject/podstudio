#define MA_NO_ENCODING
#define MA_NO_GENERATION
#define MA_NO_ENGINE
#define MA_NO_NODE_GRAPH
#define MA_NO_RESOURCE_MANAGER
#ifdef _WIN32
#define MA_ENABLE_ONLY_SPECIFIC_BACKENDS
#define MA_ENABLE_WASAPI
#endif
#define MINIAUDIO_IMPLEMENTATION
#include <miniaudio.h>

#include "engine.h"

#include <algorithm>
#include <cmath>
#include <chrono>
#include <cstring>

namespace ps {
namespace {

float to_db(double power) { return float(std::max(-90.0, 10.0 * std::log10(power + 1e-12))); }
float peak_to_db(float peak) { return float(std::max(-90.0, 20.0 * std::log10(double(peak) + 1e-9))); }
std::string lower(std::string s) { for (char& c : s) c = char(std::tolower((unsigned char)c)); return s; }

void capture_cb(ma_device* d, void*, const void* in, ma_uint32 frames) {
    static_cast<Engine*>(d->pUserData)->on_capture(static_cast<const float*>(in), frames);
}
void notify_cb(const ma_device_notification* n) {
    auto* e = static_cast<Engine*>(n->pDevice->pUserData);
    if (n->type == ma_device_notification_type_stopped) e->on_notification(1);
}
void playback_cb(ma_device* d, void* out, const void*, ma_uint32 frames) {
    static_cast<Engine*>(d->pUserData)->on_playback(static_cast<float*>(out), frames);
}

}  // namespace

// Single-producer single-consumer float ring, 8 seconds of mono.
struct Engine::Ring {
    std::vector<float> buf = std::vector<float>(size_t(kRate) * 8);
    std::atomic<size_t> head{0}, tail{0};               // head: next write, tail: next read (monotonic counters)
    size_t push(const float* x, size_t n) {
        size_t h = head.load(std::memory_order_relaxed), t = tail.load(std::memory_order_acquire);
        size_t room = buf.size() - (h - t);
        size_t k = std::min(n, room);
        for (size_t i = 0; i < k; i++) buf[(h + i) % buf.size()] = x[i];
        head.store(h + k, std::memory_order_release);
        return k;
    }
    size_t pop(float* x, size_t n) {
        size_t t = tail.load(std::memory_order_relaxed), h = head.load(std::memory_order_acquire);
        size_t k = std::min(n, h - t);
        for (size_t i = 0; i < k; i++) x[i] = buf[(t + i) % buf.size()];
        tail.store(t + k, std::memory_order_release);
        return k;
    }
};

Engine::Engine() = default;

Engine::~Engine() {
    close_input();
    stop_all();
    preview_close();
    if (play_) { ma_device_uninit(play_); delete play_; }
    if (ctx_) { ma_context_uninit(ctx_); delete ctx_; }
}

bool Engine::init(std::string& err) {
    ctx_ = new ma_context;
    if (ma_context_init(nullptr, 0, nullptr, ctx_) != MA_SUCCESS) { err = "no audio system available"; delete ctx_; ctx_ = nullptr; return false; }
    ring_ = std::make_unique<Ring>();
    play_ = new ma_device;
    ma_device_config c = ma_device_config_init(ma_device_type_playback);
    c.playback.format = ma_format_f32; c.playback.channels = 2; c.sampleRate = kRate;
    c.dataCallback = playback_cb; c.pUserData = this;
    c.periodSizeInFrames = 480;
    c.performanceProfile = ma_performance_profile_low_latency;
    if (ma_device_init(ctx_, &c, play_) != MA_SUCCESS || ma_device_start(play_) != MA_SUCCESS) {
        delete play_; play_ = nullptr;
        err = "couldn't open the audio output";           // inputs and the rest still work
    }
    return true;
}

// ---------------------------------------------------------------------------------------------------- input
std::vector<InputInfo> Engine::list_inputs() {
    std::vector<InputInfo> out;
    if (!ctx_) return out;
    ma_device_info* pb; ma_uint32 npb; ma_device_info* cp; ma_uint32 ncp;
    if (ma_context_get_devices(ctx_, &pb, &npb, &cp, &ncp) != MA_SUCCESS) return out;
    for (ma_uint32 i = 0; i < ncp; i++) {
        InputInfo in;
        in.name = cp[i].name;
        in.id.assign(reinterpret_cast<unsigned char*>(&cp[i].id), reinterpret_cast<unsigned char*>(&cp[i].id) + sizeof(ma_device_id));
        in.podmic = lower(in.name).find("podmic") != std::string::npos;
        out.push_back(std::move(in));
    }
    return out;
}

bool Engine::open_input(const InputInfo& in, std::string& err) {
    close_input();
    cap_ = new ma_device;
    ma_device_config c = ma_device_config_init(ma_device_type_capture);
    c.capture.format = ma_format_f32; c.capture.channels = 1; c.sampleRate = kRate;
    ma_device_id id;
    std::memcpy(&id, in.id.data(), std::min(sizeof id, in.id.size()));
    c.capture.pDeviceID = &id;
    c.dataCallback = capture_cb; c.pUserData = this;
    c.notificationCallback = notify_cb;
    c.periodSizeInFrames = 480;
    lost_ = false;
    if (ma_device_init(ctx_, &c, cap_) != MA_SUCCESS || ma_device_start(cap_) != MA_SUCCESS) {
        delete cap_; cap_ = nullptr; err = "couldn't open " + in.name; return false;
    }
    input_open_ = true;
    return true;
}

void Engine::demo_loop() {
    // A stand-in for a voice: harmonic buzz with syllable-rate gating and some breath noise.
    unsigned long long n = 0; unsigned seed = 12345;
    std::vector<float> blk(480);
    auto t0 = std::chrono::steady_clock::now();
    while (demo_.load()) {
        for (size_t i = 0; i < blk.size(); i++, n++) {
            double t = double(n) / kRate;
            double syll = std::max(0.0, std::sin(2 * 3.14159265 * 3.7 * t)) * (std::sin(2 * 3.14159265 * 0.31 * t) > -0.3 ? 1.0 : 0.0);
            double f0 = 118 + 14 * std::sin(2 * 3.14159265 * 0.9 * t), v = 0;
            for (int h = 1; h <= 8; h++) v += std::sin(2 * 3.14159265 * f0 * h * t) / h;
            seed = seed * 1664525u + 1013904223u;
            double noise = (double(seed >> 8) / 8388608.0 - 1.0) * 0.05;
            blk[i] = float(0.28 * syll * v * 0.6 + noise * 0.4);
        }
        on_capture(blk.data(), unsigned(blk.size()));
        t0 += std::chrono::milliseconds(10);
        std::this_thread::sleep_until(t0);
    }
}

bool Engine::open_demo(std::string&) {
    close_input();
    demo_ = true; input_open_ = true;
    demo_thread_ = std::thread([this] { demo_loop(); });
    return true;
}

void Engine::on_notification(int type) { if (type == 1) lost_ = true; }

void Engine::close_input() {
    if (recording_) stop_recording();
    if (demo_) { demo_ = false; if (demo_thread_.joinable()) demo_thread_.join(); }
    if (cap_) { ma_device_uninit(cap_); delete cap_; cap_ = nullptr; }
    input_open_ = false; lost_ = false;
    mic_rms_ = mic_peak_ = voice_rms_ = -90.f;
}

void Engine::on_capture(const float* in, unsigned frames) {
    if (!frames) return;
    const float db = mic_fader_db_.load();
    const float g = db <= -60.f ? 0.f : std::pow(10.f, db / 20.f);
    double sq = 0, sq_post = 0; float pk = 0;
    for (unsigned i = 0; i < frames; i++) {
        const float x = in[i];
        sq += double(x) * x;
        const float y = x * g;
        sq_post += double(y) * y;
        pk = std::max(pk, std::fabs(y));
    }
    const float voice = to_db(sq / frames);
    voice_rms_.store(voice);
    mic_rms_.store(to_db(sq_post / frames));
    mic_peak_.store(peak_to_db(pk));

    // ducking: dip while the voice is above the threshold; fast attack, adjustable release
    const double T = double(frames) / kRate;
    const float target = voice > duck_thresh_.load() ? -std::fabs(duck_amount_.load()) : 0.f;
    const double tau = (target < duck_state_db_ ? 0.040 : std::max(0.01, double(duck_release_ms_.load()) / 1000.0));
    const float a = float(std::exp(-T / tau));
    duck_state_db_ = target + (duck_state_db_ - target) * a;
    duck_now_db_.store(duck_state_db_);
    duck_gain_lin_.store(std::pow(10.f, duck_state_db_ / 20.f));

    if (recording_.load(std::memory_order_acquire)) {
        size_t k = ring_->push(in, frames);
        rec_frames_.fetch_add(k);
        if (k < frames) rec_overflow_ = true;
    }
}

// ---------------------------------------------------------------------------------------------------- recording
void Engine::writer_loop() {
    std::vector<float> tmp(4096);
    for (;;) {
        size_t n = ring_->pop(tmp.data(), tmp.size());
        if (n) { wav_.write(tmp.data(), n); continue; }
        if (!writer_run_.load()) {
            while ((n = ring_->pop(tmp.data(), tmp.size())) > 0) wav_.write(tmp.data(), n);   // drain what arrived last
            return;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(4));
    }
}

bool Engine::start_recording(const std::string& path, std::string& err) {
    if (recording_ || !input_open_) { err = "no input is open"; return false; }
    if (!wav_.open(path, 1, kRate, err)) return false;
    ring_->head = 0; ring_->tail = 0;
    rec_frames_ = 0; rec_overflow_ = false; rec_path_ = path;
    writer_run_ = true;
    writer_ = std::thread([this] { writer_loop(); });
    recording_.store(true, std::memory_order_release);
    return true;
}

size_t Engine::stop_recording() {
    if (!recording_) return 0;
    recording_.store(false, std::memory_order_release);
    std::this_thread::sleep_for(std::chrono::milliseconds(30));          // let an in-flight callback finish pushing
    writer_run_ = false;
    if (writer_.joinable()) writer_.join();
    size_t frames = wav_.frames_written();
    wav_.close();
    return frames;
}

// ---------------------------------------------------------------------------------------------------- pads
int Engine::play(const Clip* clip, double gain_db, bool loop, bool duck, int handle) {
    if (!clip || clip->frames() == 0) return -1;
    for (int i = 0; i < kVoices; i++) {
        Voice& v = voices_[i];
        if (v.active.load(std::memory_order_acquire)) continue;
        v.clip = clip; v.pos = 0; v.gain = float(std::pow(10.0, gain_db / 20.0)); v.fade = 1.f; v.fade_step = 0.f; v.duck = duck;
        v.loop.store(loop); v.stopping.store(false); v.handle.store(handle);
        v.active.store(true, std::memory_order_release);
        return i;
    }
    return -1;
}

void Engine::stop_handle(int handle, int fade_ms) {
    for (Voice& v : voices_)
        if (v.active.load(std::memory_order_acquire) && v.handle.load() == handle) {
            v.fade_samples.store(std::max(1, fade_ms * kRate / 1000));
            v.stopping.store(true);
        }
}

bool Engine::handle_active(int handle) const {
    for (const Voice& v : voices_)
        if (v.active.load(std::memory_order_acquire) && v.handle.load() == handle && !v.stopping.load()) return true;
    return false;
}

void Engine::stop_all() { for (Voice& v : voices_) if (v.active.load()) { v.fade_samples.store(240); v.stopping.store(true); } }

void Engine::set_ducking(double amount_db, double threshold_db, double release_ms) {
    duck_amount_ = float(amount_db); duck_thresh_ = float(threshold_db); duck_release_ms_ = float(release_ms);
}

void Engine::on_playback(float* out, unsigned frames) {
    std::memset(out, 0, size_t(frames) * 2 * sizeof(float));
    const float hdb = hk_fader_db_.load();
    const float hk_gain = (hk_muted_.load() || hdb <= -60.f) ? 0.f : std::pow(10.f, hdb / 20.f);
    const float duck = duck_gain_lin_.load();
    float hk_peak = 0;
    for (Voice& v : voices_) {
        if (!v.active.load(std::memory_order_acquire)) continue;
        if (v.stopping.load() && v.fade_step == 0.f) v.fade_step = v.fade / float(std::max(1, v.fade_samples.load()));
        const size_t n = v.clip->frames();
        const float base = v.gain * hk_gain * (v.duck ? duck : 1.f);
        bool done = false;
        for (unsigned i = 0; i < frames; i++) {
            if (v.pos >= n) {
                if (v.loop.load() && !v.stopping.load()) v.pos = 0;
                else { done = true; break; }
            }
            if (v.fade_step > 0.f) { v.fade -= v.fade_step; if (v.fade <= 0.f) { done = true; break; } }
            const float g = base * v.fade;
            const float l = v.clip->data[v.pos * 2] * g, r = v.clip->data[v.pos * 2 + 1] * g;
            out[i * 2] += l; out[i * 2 + 1] += r;
            hk_peak = std::max(hk_peak, std::max(std::fabs(l), std::fabs(r)));
            v.pos++;
        }
        if (done) { v.fade_step = 0.f; v.active.store(false, std::memory_order_release); }
    }
    hk_peak_.store(peak_to_db(hk_peak));

    // preview of a recorded file, after the hotkeys so it isn't ducked
    float pv_peak = 0;
    if (preview_playing_.load()) {
        std::unique_lock<std::mutex> lk(prev_mu_, std::try_to_lock);
        if (lk.owns_lock() && prev_) {
            float tmp[480 * 2];
            unsigned done = 0;
            while (done < frames) {
                ma_uint64 want = std::min<unsigned>(frames - done, 480), got = 0;
                ma_decoder_read_pcm_frames(prev_, tmp, want, &got);
                for (ma_uint64 i = 0; i < got * 2; i++) { out[done * 2 + i] += tmp[i]; pv_peak = std::max(pv_peak, std::fabs(tmp[i])); }
                done += unsigned(got);
                prev_pos_ += got;
                if (got < want) { preview_playing_ = false; preview_end_ = true; break; }
            }
        }
    }
    preview_peak_.store(peak_to_db(pv_peak));
    float mp = 0;
    for (unsigned i = 0; i < frames * 2; i++) { out[i] = std::max(-1.f, std::min(1.f, out[i])); mp = std::max(mp, std::fabs(out[i])); }
    master_peak_.store(peak_to_db(mp));
}

// ---------------------------------------------------------------------------------------------------- preview
bool Engine::preview_open(const std::string& path, std::string& err) {
    preview_close();
    auto* d = new ma_decoder;
    ma_decoder_config c = ma_decoder_config_init(ma_format_f32, 2, kRate);
    if (ma_decoder_init_file(path.c_str(), &c, d) != MA_SUCCESS) { delete d; err = "couldn't open " + path; return false; }
    ma_uint64 len = 0;
    ma_decoder_get_length_in_pcm_frames(d, &len);
    std::lock_guard<std::mutex> lk(prev_mu_);
    prev_ = d; prev_pos_ = 0; preview_dur_ = double(len) / kRate; preview_end_ = false;
    return true;
}

void Engine::preview_close() {
    preview_playing_ = false;
    std::lock_guard<std::mutex> lk(prev_mu_);
    if (prev_) { ma_decoder_uninit(prev_); delete prev_; prev_ = nullptr; }
    prev_pos_ = 0; preview_dur_ = 0;
}

void Engine::preview_play(bool play) { if (prev_) preview_playing_ = play; }

void Engine::preview_seek(double s) {
    std::lock_guard<std::mutex> lk(prev_mu_);
    if (!prev_) return;
    ma_uint64 f = ma_uint64(std::max(0.0, std::min(s, preview_dur_.load())) * kRate);
    if (ma_decoder_seek_to_pcm_frame(prev_, f) == MA_SUCCESS) { prev_pos_ = f; preview_end_ = false; }
}

double Engine::preview_position() const { return double(prev_pos_.load()) / kRate; }

bool Engine::preview_ended() { return preview_end_.exchange(false); }

// ---------------------------------------------------------------------------------------------------- files
bool decode_file(const std::string& path, Audio& out, std::string& err) {
    ma_decoder d;
    ma_decoder_config c = ma_decoder_config_init(ma_format_f32, 2, kRate);
    if (ma_decoder_init_file(path.c_str(), &c, &d) != MA_SUCCESS) { err = "couldn't read " + path; return false; }
    out.channels = 2; out.rate = kRate; out.data.clear();
    std::vector<float> buf(4096 * 2);
    for (;;) {
        ma_uint64 got = 0;
        ma_decoder_read_pcm_frames(&d, buf.data(), 4096, &got);
        if (!got) break;
        out.data.insert(out.data.end(), buf.begin(), buf.begin() + got * 2);
        if (got < 4096) break;
    }
    ma_decoder_uninit(&d);
    if (out.data.empty()) { err = "no audio in " + path; return false; }
    return true;
}

bool compute_peaks(const std::string& path, int bins, std::vector<float>& mins, std::vector<float>& maxs,
                   double& duration_s, std::string& err) {
    ma_decoder d;
    ma_decoder_config c = ma_decoder_config_init(ma_format_f32, 2, kRate);
    if (ma_decoder_init_file(path.c_str(), &c, &d) != MA_SUCCESS) { err = "couldn't read " + path; return false; }
    ma_uint64 total = 0;
    ma_decoder_get_length_in_pcm_frames(&d, &total);
    duration_s = double(total) / kRate;
    mins.assign(bins, 0.f); maxs.assign(bins, 0.f);
    if (total == 0) { ma_decoder_uninit(&d); return true; }
    const ma_uint64 hop = std::max<ma_uint64>(1, (total + bins - 1) / bins);
    std::vector<float> buf(8192 * 2);
    ma_uint64 idx = 0;
    std::vector<bool> seen(bins, false);
    for (;;) {
        ma_uint64 got = 0;
        ma_decoder_read_pcm_frames(&d, buf.data(), 8192, &got);
        if (!got) break;
        for (ma_uint64 i = 0; i < got; i++, idx++) {
            size_t b = size_t(std::min<ma_uint64>(idx / hop, bins - 1));
            float m = 0.5f * (buf[i * 2] + buf[i * 2 + 1]);
            if (!seen[b]) { mins[b] = maxs[b] = m; seen[b] = true; }
            else { mins[b] = std::min(mins[b], m); maxs[b] = std::max(maxs[b], m); }
        }
        if (got < 8192) break;
    }
    ma_decoder_uninit(&d);
    return true;
}

}  // namespace ps
