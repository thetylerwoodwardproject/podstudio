// Run:  core_tests <dir containing fixture.wav and expected.txt from make_reference.py>
// Checks the C++ core against the Python implementation, plus some properties that need no reference.
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>
#include <string>

#include "../core/audio.h"
#include "../core/dsp.h"
#include "../core/render.h"

using namespace ps;

static int failures = 0, checks = 0;
#define CHECK(cond, ...) do { checks++; if (!(cond)) { failures++; std::printf("FAIL %s:%d  %s  ", __FILE__, __LINE__, #cond); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)
static void near(const char* what, double got, double want, double tol) {
    checks++;
    bool ok = std::fabs(got - want) <= tol;
    if (!ok) { failures++; std::printf("FAIL %-22s got %.10f want %.10f (tol %g)\n", what, got, want, tol); }
    else std::printf("ok   %-22s %.8f  (python %.8f)\n", what, got, want);
}

int main(int argc, char** argv) {
    std::string dir = argc > 1 ? argv[1] : ".";
    std::map<std::string, double> want;
    {
        std::ifstream in(dir + "/expected.txt");
        std::string line;
        while (std::getline(in, line)) { std::istringstream s(line); std::string k; double v; if (s >> k >> v) want[k] = v; }
    }
    CHECK(!want.empty(), "expected.txt missing in %s", dir.c_str());

    Audio a; std::string err;
    CHECK(read_wav(dir + "/fixture.wav", a, err), "%s", err.c_str());
    CHECK(a.frames() == size_t(want["frames"]), "frames %zu", a.frames());

    // --- calibration point from BS.1770: a full-scale 997 Hz sine in one channel reads -3.01 LUFS
    {
        Audio s; s.channels = 2; s.data.assign(10 * kRate * 2, 0.0f);
        for (int i = 0; i < 10 * kRate; i++) s.data[i * 2] = float(std::sin(2 * 3.14159265358979323846 * 997.0 * i / kRate));
        near("calibration lufs", *integrated_loudness(s), -3.01, 0.05);
    }
    near("lufs", *integrated_loudness(a), want["lufs"], 0.003);
    near("true_peak_db", true_peak_db(a), want["true_peak_db"], 0.003);
    {
        double sp = 0; for (float v : a.data) sp = std::max(sp, double(std::fabs(v)));
        near("sample_peak", sp, want["sample_peak"], 1e-9);
        CHECK(true_peak_db(a) >= lin_to_db(sp) - 1e-9, "true peak is never below the sample peak");
    }
    {
        Audio l = a; limit(l, -6.0);
        double mx = 0, ma = 0, sum = 0;
        for (float v : l.data) { mx = std::max(mx, double(std::fabs(v))); ma += std::fabs(v); sum += v; }
        near("limit_max", mx, want["limit_max"], 2e-4);
        near("limit_mean_abs", ma / l.data.size(), want["limit_mean_abs"], 2e-6);
        near("limit_sum", sum, want["limit_sum"], std::max(0.5, std::fabs(want["limit_sum"]) * 1e-4));
    }
    {
        auto g = voice_duck_gain(a, 12.0, -40.0, 400.0);
        double mean = 0, mn = 1e9; for (double v : g) { mean += v; mn = std::min(mn, v); }
        near("duck_mean", mean / g.size(), want["duck_mean"], 1e-6);
        near("duck_min", mn, want["duck_min"], 1e-6);
        for (size_t i : {size_t(0), size_t(1000), size_t(120000), size_t(400000), size_t(700000), g.size() - 1}) {
            char k[40]; std::snprintf(k, sizeof k, "duck_at_%zu", i);
            near(k, g[i], want[k], 1e-6);
        }
    }
    {
        Audio n = a; NormalizeResult r = normalize(n, -16.0);
        near("norm_measured", *r.measured_lufs, want["norm_measured"], 0.003);
        near("norm_gain_db", r.gain_db, want["norm_gain_db"], 0.003);
        near("norm_final_lufs", *r.final_lufs, want["norm_final_lufs"], 0.02);
        near("norm_true_peak", r.true_peak_db, want["norm_true_peak"], 0.02);
        CHECK(int(r.limited) == int(want["norm_limited"]), "limited flag");
        CHECK(r.true_peak_db <= kTrueCeilingDb + 1e-6, "ends under the ceiling: %.4f", r.true_peak_db);
    }

    // --- WAV round trip and crash-tolerant recording
    {
        std::string p = dir + "/roundtrip.wav";
        Audio w; w.channels = 2; w.data = {0.0f, 0.5f, -0.5f, 1.0f, -1.0f, 0.25f};
        CHECK(write_wav24(p, w, err), "%s", err.c_str());
        Audio r; CHECK(read_wav(p, r, err), "%s", err.c_str());
        CHECK(r.channels == 2 && r.frames() == 3, "shape");
        for (size_t i = 0; i < w.data.size() && i < r.data.size(); i++) CHECK(std::fabs(r.data[i] - w.data[i]) < 2e-7, "sample %zu", i);

        std::string q = dir + "/rec.wav";
        WavWriter ww; CHECK(ww.open(q, 1, kRate, err), "%s", err.c_str());
        std::vector<float> chunk(kRate / 2, 0.1f);
        for (int i = 0; i < 5; i++) ww.write(chunk.data(), chunk.size());           // 2.5 s; header is patched each second
        Audio mid; CHECK(read_wav(q, mid, err), "mid-recording read: %s", err.c_str());   // the file is readable while still open
        CHECK(mid.frames() >= size_t(2 * kRate) && mid.frames() <= size_t(5 * kRate / 2), "mid frames %zu", mid.frames());
        ww.close();
        Audio fin; CHECK(read_wav(q, fin, err), "%s", err.c_str());
        CHECK(fin.frames() == size_t(5 * kRate / 2) && fin.channels == 1, "final frames %zu", fin.frames());
    }
    {   // a header that was never finalised (size 0) still reads, taking the data to the end of the file
        std::string p = dir + "/unfinished.wav";
        Audio w; w.channels = 1; w.data.assign(1000, 0.2f);
        std::string e; write_wav24(p, w, e);
        FILE* f = std::fopen(p.c_str(), "r+b"); std::fseek(f, 40, SEEK_SET); unsigned char z[4] = {0, 0, 0, 0}; std::fwrite(z, 1, 4, f); std::fclose(f);
        Audio r; CHECK(read_wav(p, r, err) && r.frames() == 1000, "unfinished header");
    }
    {   Audio tiny; tiny.data.assign(100, 0.1f); CHECK(!integrated_loudness(tiny), "too short -> none");
        Audio sil; sil.data.assign(kRate * 2 * 2, 0.0f); CHECK(!integrated_loudness(sil), "silence -> none"); }

    // --- a whole session: project.json written by the Python app, rendered here, compared with Python's own master.wav
    {
        Project p; std::string e;
        CHECK(Project::load(dir + "/sess_cpp", p, e), "load: %s", e.c_str());
        CHECK(p.pads.size() == 2 && p.events.size() == 5 && p.pads[1].mode == "loop" && p.events[1].dur && !p.events[0].dur, "project fields");
        near("project mic_db", p.mic_db, -2.0, 1e-9);
        MasterResult r = mix_master(p, nullptr, nullptr);
        CHECK(r.ok, "render: %s", r.error.c_str());
        near("sess_measured", *r.measured_lufs, want["sess_measured"], 0.003);
        near("sess_final", *r.final_lufs, want["sess_final"], 0.02);
        near("sess_true_peak", r.true_peak_db, want["sess_true_peak"], 0.02);
        near("sess_gain_db", r.gain_db, want["sess_gain_db"], 0.003);
        CHECK(int(r.ducked) == int(want["sess_ducked"]) && int(r.limited) == int(want["sess_limited"]), "flags");
        Audio mine, theirs;
        CHECK(read_wav(p.master_path(), mine, e), "%s", e.c_str());
        CHECK(read_wav(dir + "/sess_py/audio/master.wav", theirs, e), "%s", e.c_str());
        CHECK(mine.frames() == theirs.frames(), "master length %zu vs %zu", mine.frames(), theirs.frames());
        double worst = 0; size_t n = std::min(mine.data.size(), theirs.data.size());
        for (size_t i = 0; i < n; i++) worst = std::max(worst, double(std::fabs(mine.data[i] - theirs.data[i])));
        std::printf("%s master.wav worst sample difference vs Python: %.2e\n", worst < 2e-4 ? "ok  " : "FAIL", worst);
        checks++; if (worst >= 2e-4) failures++;
        // and the project this app saves must load back in unchanged
        CHECK(p.save(e), "save: %s", e.c_str());
        Project again; CHECK(Project::load(p.root, again, e) && again.events.size() == 5 && again.pads.size() == 2, "round trip");
    }

    std::printf("\n%d checks, %d failed\n", checks, failures);
    return failures ? 1 : 0;
}
