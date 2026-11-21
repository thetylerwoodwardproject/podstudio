// Engine tests that need no sound card: recording from the demo input, the pad mixer, ducking and the peak calculation.
#include <chrono>
#include <cmath>
#include <cstdio>
#include <thread>
#include <vector>

#include "../app/engine.h"

using namespace ps;
static int fails = 0, checks = 0;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; std::printf("FAIL line %d: %s  ", __LINE__, #c); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

int main(int argc, char** argv) {
    std::string dir = argc > 1 ? argv[1] : ".";
    Engine e;
    std::string err;
    e.init(err);                                              // may report "couldn't open the audio output" on a machine with none
    CHECK(e.open_demo(err), "%s", err.c_str());
    std::this_thread::sleep_for(std::chrono::milliseconds(300));
    CHECK(e.voice_rms_db() > -60.f && e.voice_rms_db() < 0.f, "voice level %.1f", e.voice_rms_db());
    CHECK(e.mic_peak_db() > e.mic_rms_db() - 0.01f, "peak is never below rms");

    // fader applies to the meter only
    float before = e.mic_peak_db();
    e.set_mic_fader_db(-12.f);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    CHECK(e.mic_peak_db() < before - 6.f || before < -60.f, "fader -12 dB moved the meter %.1f -> %.1f", before, e.mic_peak_db());
    e.set_mic_fader_db(0.f);

    // ---- live loudness (LUFS-M): follows the mic fader, and hotkeys add to it
    {
        // The demo voice has a slow on/off phrase pattern (about 3.2 s), so compare the loudest reading over a full cycle.
        auto loudest = [&] { float m = -90.f; for (int i = 0; i < 70; i++) { m = std::max(m, e.master_lufs()); std::this_thread::sleep_for(std::chrono::milliseconds(50)); } return m; };
        std::this_thread::sleep_for(std::chrono::milliseconds(600));
        const float l1 = loudest();
        CHECK(l1 > -60.f && l1 < 0.f, "mic loudness %.1f LUFS", l1);
        e.set_mic_fader_db(-12.f);
        std::this_thread::sleep_for(std::chrono::milliseconds(600));
        const float l2 = loudest();
        CHECK(std::fabs((l1 - l2) - 12.f) < 2.5f, "fader -12 dB moved the loudness %.1f -> %.1f LUFS", l1, l2);
        e.set_mic_fader_db(-60.f);                                       // mic fully down: only hotkeys remain
        std::this_thread::sleep_for(std::chrono::milliseconds(900));
        CHECK(e.master_lufs() < -50.f, "mic down reads %.1f", e.master_lufs());
        Clip tone; tone.data.resize(size_t(kRate) * 2 * 2);
        for (size_t i = 0; i < size_t(kRate) * 2; i++) { float v = 0.5f * float(std::sin(2 * 3.14159265358979 * 997.0 * double(i) / kRate)); tone.data[i * 2] = v; tone.data[i * 2 + 1] = v; }
        std::vector<float> blk(480 * 2);
        e.play(&tone, 0.0, true, false, 20);
        for (int i = 0; i < 100; i++) e.on_playback(blk.data(), 480);     // 1 s of the hotkey
        const float lh = e.master_lufs();
        CHECK(lh > -12.f && lh < -6.f, "a 0.5 sine in both channels reads %.2f LUFS (expect about -9)", lh);
        e.stop_all();
        for (int i = 0; i < 10; i++) e.on_playback(blk.data(), 480);
        e.set_mic_fader_db(0.f);
    }

    // ---- record 2 seconds
    CHECK(e.start_recording(dir + "/engine_rec.wav", err), "%s", err.c_str());
    std::this_thread::sleep_for(std::chrono::milliseconds(2000));
    double mid = e.rec_seconds();
    size_t frames = e.stop_recording();
    CHECK(mid > 1.7 && mid < 2.4, "rec_seconds %.3f", mid);
    CHECK(frames > size_t(1.7 * kRate) && frames < size_t(2.5 * kRate), "frames %zu", frames);
    Audio a;
    CHECK(read_wav(dir + "/engine_rec.wav", a, err) && a.channels == 1 && a.frames() == frames, "file has %zu frames, writer says %zu", a.frames(), frames);
    double rms = 0; for (float v : a.data) rms += double(v) * v;
    rms = std::sqrt(rms / std::max<size_t>(1, a.data.size()));
    CHECK(rms > 0.01, "recorded audio is not silent: rms %.4f", rms);
    CHECK(!e.rec_overflowed(), "no overflow");

    // ---- mixer: a clip plays, ends by itself, and a loop runs until stopped
    Clip c; c.data.assign(48000 * 2, 0.5f);                   // 1 s of constant 0.5
    std::vector<float> out(480 * 2);
    int v = e.play(&c, 0.0, false, false, 7);
    CHECK(v >= 0 && e.handle_active(7), "voice started");
    float peak = 0; int blocks = 0;
    for (; blocks < 150 && e.handle_active(7); blocks++) { e.on_playback(out.data(), 480); for (float s : out) peak = std::max(peak, std::fabs(s)); }
    CHECK(std::fabs(peak - 0.5f) < 1e-4, "one-shot plays at its level: %.4f", peak);
    CHECK(blocks >= 99 && blocks <= 102, "one-shot lasted %d blocks of 10 ms", blocks);
    e.on_playback(out.data(), 480);
    CHECK(!e.handle_active(7), "one-shot finished");
    CHECK(e.hotkeys_peak_db() < -80.f, "meter falls silent after it ends: %.1f", e.hotkeys_peak_db());

    e.play(&c, -6.0, true, false, 8);                         // loop at -6 dB
    for (int i = 0; i < 250; i++) e.on_playback(out.data(), 480);        // 2.5 s: past the clip's own length
    CHECK(e.handle_active(8), "loop still running after the clip's length");
    e.on_playback(out.data(), 480);
    CHECK(std::fabs(out[100] - 0.25f) < 1e-3f, "loop at -6 dB: %.4f", out[100]);
    e.stop_handle(8, 25);
    for (int i = 0; i < 5; i++) e.on_playback(out.data(), 480);
    CHECK(!e.handle_active(8), "loop faded out and stopped");

    // hotkeys fader and mute
    e.play(&c, 0.0, true, false, 9);
    e.set_hotkeys_fader_db(-20.f);
    e.on_playback(out.data(), 480); e.on_playback(out.data(), 480);
    CHECK(std::fabs(out[10] - 0.05f) < 2e-3f, "fader -20 dB: %.4f", out[10]);
    e.set_hotkeys_muted(true);
    e.on_playback(out.data(), 480);
    CHECK(std::fabs(out[10]) < 1e-6f, "muted");
    e.set_hotkeys_muted(false); e.set_hotkeys_fader_db(0.f); e.stop_all();
    for (int i = 0; i < 10; i++) e.on_playback(out.data(), 480);

    // ---- ducking follows the voice (demo input is above -40 dB most of the time)
    e.set_ducking(12.0, -80.0, 200.0);                        // threshold far below the signal: always ducked
    std::this_thread::sleep_for(std::chrono::milliseconds(600));
    CHECK(e.duck_db() < -11.f, "ducked by %.1f dB", e.duck_db());
    e.set_ducking(12.0, 0.0, 200.0);                          // threshold above the signal: released
    std::this_thread::sleep_for(std::chrono::milliseconds(1500));
    CHECK(e.duck_db() > -1.f, "released to %.1f dB", e.duck_db());
    e.play(&c, 0.0, true, true, 10);                          // a ducking pad is lowered while the voice is loud
    e.set_ducking(12.0, -80.0, 200.0);
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    e.on_playback(out.data(), 480);
    CHECK(out[10] < 0.2f, "ducking pad lowered: %.3f", out[10]);
    e.stop_all();

    e.close_input();
    std::printf("\n%d checks, %d failed\n", checks, fails);
    return fails ? 1 : 0;
}
