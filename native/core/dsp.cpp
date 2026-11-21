#include "dsp.h"

#include <algorithm>
#include <cmath>
#include <deque>

namespace ps {

double lin_to_db(double x) { return 20.0 * std::log10(std::max(x, 1e-12)); }

// ------------------------------------------------------------------------------------------------ loudness
namespace {

struct Biquad {                                       // direct form II transposed, double precision
    double b0, b1, b2, a1, a2, z1 = 0, z2 = 0;
    double run(double x) {
        double y = b0 * x + z1;
        z1 = b1 * x - a1 * y + z2;
        z2 = b2 * x - a2 * y;
        return y;
    }
};

// K-weighting at 48 kHz: stage 1 high shelf, stage 2 high pass (BS.1770-4 table coefficients).
Biquad shelf() { return {1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585}; }
Biquad rlb() { return {1.0, -2.0, 1.0, -1.99004745483398, 0.99007225036621}; }

}  // namespace

std::optional<double> integrated_loudness(const Audio& a) {
    const size_t block = 19200, step = 4800;            // 400 ms blocks, 75 % overlap, at 48 kHz
    const size_t n = a.frames();
    if (a.rate != kRate || a.channels < 1 || n < block) return std::nullopt;
    const int ch = a.channels;
    const size_t hops = n / step;                       // whole 100 ms hops
    // Energy per channel per hop; a 400 ms block is four consecutive hops.
    std::vector<double> hop_energy(hops * ch, 0.0);
    for (int c = 0; c < ch; c++) {
        Biquad s = shelf(), r = rlb();
        for (size_t h = 0; h < hops; h++) {
            double e = 0;
            for (size_t i = h * step; i < (h + 1) * step; i++) {
                double y = r.run(s.run(a.data[i * ch + c]));
                e += y * y;
            }
            hop_energy[h * ch + c] = e;
        }
    }
    const size_t blocks = hops - 3;                     // == floor((n - block) / step) + 1 for whole hops
    std::vector<double> ms(blocks);                     // channel-summed mean square per block
    for (size_t b = 0; b < blocks; b++) {
        double sum = 0;
        for (int c = 0; c < ch; c++)
            for (size_t k = 0; k < 4; k++) sum += hop_energy[(b + k) * ch + c];
        ms[b] = sum / double(block);
    }
    auto lk = [](double v) { return -0.691 + 10.0 * std::log10(v); };
    double acc = 0; size_t cnt = 0;
    for (double v : ms) if (lk(v) > -70.0) { acc += v; cnt++; }
    if (!cnt) return std::nullopt;
    const double rel = lk(acc / double(cnt)) - 10.0;
    acc = 0; cnt = 0;
    for (double v : ms) if (lk(v) > -70.0 && lk(v) > rel) { acc += v; cnt++; }
    if (!cnt) return std::nullopt;
    return lk(acc / double(cnt));
}

// ------------------------------------------------------------------------------------------------ live meter
LoudnessMeter::LoudnessMeter(int channels) : channels_(channels < 1 ? 1 : channels), st_(size_t(channels_)) {}

void LoudnessMeter::reset() {
    for (auto& s : st_) s = State();
    acc_ = 0; n_ = 0; filled_ = 0; idx_ = 0;
    for (double& h : hops_) h = 0;
    ms_.store(0.0, std::memory_order_relaxed);
}

void LoudnessMeter::process(const float* x, size_t frames) {
    static const Biquad shelf_c = shelf(), rlb_c = rlb();
    const size_t hop = 4800;                            // 100 ms at 48 kHz
    for (size_t i = 0; i < frames; i++) {
        for (int c = 0; c < channels_; c++) {
            State& st = st_[size_t(c)];
            const double in = x[i * size_t(channels_) + size_t(c)];
            // direct form II transposed, same coefficients as integrated_loudness()
            double y1 = shelf_c.b0 * in + st.sz1[0];
            st.sz1[0] = shelf_c.b1 * in - shelf_c.a1 * y1 + st.sz1[1];
            st.sz1[1] = shelf_c.b2 * in - shelf_c.a2 * y1;
            double y2 = rlb_c.b0 * y1 + st.sz2[0];
            st.sz2[0] = rlb_c.b1 * y1 - rlb_c.a1 * y2 + st.sz2[1];
            st.sz2[1] = rlb_c.b2 * y1 - rlb_c.a2 * y2;
            acc_ += y2 * y2;
        }
        if (++n_ == hop) {
            hops_[idx_] = acc_;
            idx_ = (idx_ + 1) % 4;
            if (filled_ < 4) filled_++;
            double sum = 0;
            for (int k = 0; k < filled_; k++) sum += hops_[k];
            ms_.store(sum / (double(filled_) * double(hop)), std::memory_order_relaxed);
            acc_ = 0; n_ = 0;
        }
    }
}

double LoudnessMeter::mean_square() const { return ms_.load(std::memory_order_relaxed); }

double LoudnessMeter::to_lufs(double ms) { return ms < 1e-9 ? -90.0 : std::max(-90.0, -0.691 + 10.0 * std::log10(ms)); }

// ------------------------------------------------------------------------------------------------ true peak
namespace {

double bessel_i0(double x) {
    double sum = 1.0, term = 1.0, q = x * x / 4.0;
    for (int k = 1; k < 60; k++) { term *= q / (double(k) * k); sum += term; if (term < 1e-18 * sum) break; }
    return sum;
}

// scipy.signal.resample_poly(x, 4, 1) default filter: firwin(81, 1/4, window=('kaiser', 5.0)) * 4.
std::vector<double> upsample4_filter() {
    const int up = 4, half = 10 * up, taps = 2 * half + 1;
    const double cutoff = 1.0 / up, beta = 5.0, pi = 3.14159265358979323846;
    std::vector<double> h(taps);
    double sum = 0;
    for (int i = 0; i < taps; i++) {
        double m = i - half;
        double ideal = (m == 0) ? cutoff : std::sin(pi * cutoff * m) / (pi * m);          // cutoff * sinc(cutoff*m)
        double r = 2.0 * i / (taps - 1) - 1.0;
        double win = bessel_i0(beta * std::sqrt(std::max(0.0, 1.0 - r * r))) / bessel_i0(beta);
        h[i] = ideal * win;
        sum += h[i];
    }
    for (double& v : h) v = v / sum * up;                // unity DC gain, then the zero-stuffing gain
    return h;
}

}  // namespace

double true_peak_db(const Audio& a) {
    static const std::vector<double> h = upsample4_filter();
    const int up = 4, half = 40, taps = int(h.size());
    const size_t n = a.frames();
    const int ch = a.channels;
    double peak = 0;
    for (float v : a.data) peak = std::max(peak, double(std::fabs(v)));
    // Output sample 4k+p (p = 0..3) is the sum over input samples k-m of x[k-m] * h[4m + (half + p) mod ...];
    // computing it directly per phase avoids ever materialising the zero-stuffed signal.
    for (int c = 0; c < ch; c++) {
        for (size_t k = 0; k < n; k++) {
            for (int p = 1; p < up; p++) {                // phase 0 is the original sample, already counted
                const long centre = long(half) + p;       // filter index aligned with input k for this phase
                double y = 0;
                // x[j] contributes h[centre + 4*(k - j)]; indices must fall inside [0, taps)
                long jmin = long(k) - (taps - 1 - centre) / up;
                long jmax = long(k) + centre / up;
                if (jmin < 0) jmin = 0;
                if (jmax > long(n) - 1) jmax = long(n) - 1;
                for (long j = jmin; j <= jmax; j++) y += a.data[j * ch + c] * h[centre + long(up) * (long(k) - j)];
                peak = std::max(peak, std::fabs(y));
            }
        }
    }
    return lin_to_db(peak);
}

// ------------------------------------------------------------------------------------------------ limiter
bool limit(Audio& a, double ceiling_db, double lookahead_ms) {
    const double ceil = db_to_lin(ceiling_db);
    const size_t n = a.frames();
    const int ch = a.channels;
    std::vector<double> gain(n, 1.0);
    bool any = false;
    for (size_t i = 0; i < n; i++) {
        double pk = 0;
        for (int c = 0; c < ch; c++) pk = std::max(pk, double(std::fabs(a.data[i * ch + c])));
        if (pk > ceil) { gain[i] = ceil / std::max(pk, 1e-12); any = true; }
    }
    if (!any) return false;
    const long w = std::max(1L, long(kRate * lookahead_ms / 1000.0));
    // Sliding minimum over [i-w, i+w] (monotonic deque), padding with 1.0 outside the signal.
    std::vector<double> g(n);
    std::deque<long> dq;
    auto val = [&](long i) { return (i < 0 || i >= long(n)) ? 1.0 : gain[i]; };
    for (long i = -w; i < long(n) + w; i++) {
        double v = val(i + w);                            // newest sample entering the window centred on i
        while (!dq.empty() && val(dq.back()) >= v) dq.pop_back();
        dq.push_back(i + w);
        while (dq.front() < i - w) dq.pop_front();
        if (i >= 0 && i < long(n)) g[i] = val(dq.front());
    }
    // Smooth with a normalised Hann window (numpy.hanning), edge-padded. Where the whole window is 1.0 the result is
    // exactly 1.0, so the (expensive) convolution only runs near gain reductions.
    const long m = 2 * w + 1;
    std::vector<double> kernel(m);
    double ks = 0;
    for (long k = 0; k < m; k++) { kernel[k] = 0.5 - 0.5 * std::cos(2.0 * 3.14159265358979323846 * double(k) / double(m - 1)); ks += kernel[k]; }
    for (double& v : kernel) v /= ks;
    std::vector<long> dirty(n + 1, 0);                    // prefix count of samples with g < 1
    for (size_t i = 0; i < n; i++) dirty[i + 1] = dirty[i] + (g[i] < 1.0);
    auto gp = [&](long i) { return g[std::min<long>(std::max<long>(i, 0), long(n) - 1)]; };
    for (size_t i = 0; i < n; i++) {
        long lo = std::max<long>(0, long(i) - w), hi = std::min<long>(long(n) - 1, long(i) + w);
        double out = 1.0;
        if (dirty[hi + 1] - dirty[lo] > 0 || long(i) - w < 0 || long(i) + w > long(n) - 1) {
            out = 0;
            for (long k = 0; k < m; k++) out += gp(long(i) - w + k) * kernel[k];
        }
        const float s = float(std::min(out, 1.0));
        for (int c = 0; c < ch; c++) a.data[i * ch + c] *= s;
    }
    return true;
}

// ------------------------------------------------------------------------------------------------ ducking
std::vector<double> voice_duck_gain(const Audio& mic, double amount_db, double threshold_db, double release_ms,
                                    double attack_ms) {
    const size_t hop = 480, total = mic.frames();
    const size_t n = total / hop;
    std::vector<double> out(total, 1.0);
    if (n == 0) return out;
    const int ch = mic.channels;
    std::vector<double> target(n);
    for (size_t h = 0; h < n; h++) {
        double e = 0;
        for (size_t i = h * hop; i < (h + 1) * hop; i++) {
            double m = 0;
            for (int c = 0; c < ch; c++) m += mic.data[i * ch + c];
            m /= ch;
            e += m * m;
        }
        double rms_db = 10.0 * std::log10(e / hop + 1e-12);
        target[h] = rms_db > threshold_db ? -std::fabs(amount_db) : 0.0;
    }
    const size_t look = std::max<size_t>(1, size_t(std::lround(attack_ms / 10.0)));
    std::vector<double> ahead(n);
    for (size_t h = 0; h < n; h++) ahead[h] = h + look < n ? target[h + look] : target[n - 1];   // look-ahead
    const double a_att = std::exp(-1.0 / std::max(attack_ms / 10.0, 0.1));
    const double a_rel = std::exp(-1.0 / std::max(release_ms / 10.0, 0.1));
    std::vector<double> gain(n);
    double cur = 0;
    for (size_t h = 0; h < n; h++) {
        double coef = ahead[h] < cur ? a_att : a_rel;       // going down = attack, up = release
        cur = ahead[h] + (cur - ahead[h]) * coef;
        gain[h] = cur;
    }
    // Linear interpolation between hop centres, clamped at both ends (numpy.interp).
    for (size_t i = 0; i < total; i++) {
        double pos = (double(i) / hop) - 0.5;                // index into `gain` in hop units
        double db;
        if (pos <= 0) db = gain[0];
        else if (pos >= double(n - 1)) db = gain[n - 1];
        else { size_t k = size_t(pos); double f = pos - double(k); db = gain[k] * (1 - f) + gain[k + 1] * f; }
        out[i] = std::pow(10.0, db / 20.0);
    }
    return out;
}

// ------------------------------------------------------------------------------------------------ normalize
NormalizeResult normalize(Audio& mix, double target_lufs, double ceiling_db) {
    NormalizeResult r;
    r.measured_lufs = integrated_loudness(mix);
    r.gain_db = r.measured_lufs ? target_lufs - *r.measured_lufs : 0.0;
    const float g = float(db_to_lin(r.gain_db));
    for (float& v : mix.data) v *= g;
    const std::vector<float> scaled = mix.data;
    double ceil = ceiling_db;
    for (int attempt = 0; attempt < 5; attempt++) {
        mix.data = scaled;
        r.limited = limit(mix, ceil) || r.limited;
        r.true_peak_db = true_peak_db(mix);
        if (r.true_peak_db <= ceiling_db) break;
        double sample_peak = 0;
        for (float v : mix.data) sample_peak = std::max(sample_peak, double(std::fabs(v)));
        ceil = std::min(ceil, lin_to_db(sample_peak)) - (r.true_peak_db - ceiling_db) - 0.05;   // true peaks sit above sample peaks
    }
    r.final_lufs = integrated_loudness(mix);
    return r;
}

}  // namespace ps
