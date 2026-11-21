// Loudness, true peak, limiting, ducking and normalisation. Ported from podstudio/loudness.py and render.py,
// and checked against them (native/tests/).
#pragma once
#include <atomic>
#include <cmath>
#include <optional>
#include <vector>

#include "audio.h"

namespace ps {

constexpr double kTrueCeilingDb = -1.0;             // podcast delivery ceiling, dBTP
inline double db_to_lin(double db) { return std::pow(10.0, db / 20.0); }
double lin_to_db(double x);

// ITU-R BS.1770-4 integrated loudness (LUFS), 48 kHz, channels weighted 1.0. nullopt if too short or silent.
std::optional<double> integrated_loudness(const Audio& a);

// BS.1770 style true peak in dB: 4x oversampled with the same windowed-sinc filter scipy's resample_poly uses.
double true_peak_db(const Audio& a);

// Small look-ahead peak limiter (5 ms). Returns true if it had to act; `a` is modified in place.
bool limit(Audio& a, double ceiling_db = kTrueCeilingDb, double lookahead_ms = 5.0);

// Per-sample linear gain that dips by amount_db while the mic's 10 ms RMS is above threshold_db, with look-ahead.
std::vector<double> voice_duck_gain(const Audio& mic, double amount_db, double threshold_db, double release_ms,
                                    double attack_ms = 40.0);

// Live loudness, for the Master meter: BS.1770 K-weighting over a sliding 400 ms window ("momentary" loudness),
// updated every 100 ms. Real-time safe: no allocation or locking while processing; mean_square() may be read from
// another thread. Feed it the samples of one stream; combine streams by adding their mean squares.
class LoudnessMeter {
public:
    explicit LoudnessMeter(int channels);
    void reset();
    void process(const float* interleaved, size_t frames);
    double mean_square() const;                         // channel-summed, K-weighted, over the last 400 ms (0 until 100 ms arrived)
    static double to_lufs(double mean_square);          // -0.691 + 10 log10(ms); -90 for silence
private:
    struct State { double sz1[2] = {0, 0}, sz2[2] = {0, 0}; };    // [stage]: shelf, high-pass
    int channels_;
    std::vector<State> st_;
    double acc_ = 0, hops_[4] = {0, 0, 0, 0};
    size_t n_ = 0;
    int filled_ = 0, idx_ = 0;
    std::atomic<double> ms_{0.0};
};

struct NormalizeResult {
    std::optional<double> measured_lufs, final_lufs;
    double gain_db = 0, true_peak_db = -120;
    bool limited = false;
};
// Gain to target_lufs, then limit until the true peak is under the ceiling. Modifies `mix` in place.
NormalizeResult normalize(Audio& mix, double target_lufs, double ceiling_db = kTrueCeilingDb);

}  // namespace ps
