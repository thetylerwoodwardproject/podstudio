// Windows-only checks of the parts that only exist on Windows: Media Foundation MP3 encoding, WinHTTP with TLS (against
// the real Buzzsprout and GitHub APIs, with a made-up token), Credential Manager, and HID enumeration.
// Needs no microphone and no sound card. Run by CI on a Windows runner.
#include <cmath>
#include <cstdio>
#include <string>

#include "../app/engine.h"
#include "../app/http_factory.h"
#include "../app/micctl.h"
#include "../app/mp3.h"
#include "../core/buzzsprout.h"
#include "../core/dsp.h"
#include "../core/updates.h"

using namespace ps;
static int fails = 0, checks = 0;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; std::printf("FAIL line %d: %s  ", __LINE__, #c); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

int main(int argc, char** argv) {
    const std::string dir = argc > 1 ? argv[1] : ".";

    // ---- MP3: encode 3 s of a tone with Media Foundation, decode it again, compare
    {
        CHECK(mp3::available(), "mp3 available");
        Audio a; a.channels = 2; a.data.resize(size_t(3 * kRate) * 2);
        for (size_t i = 0; i < size_t(3 * kRate); i++) {
            float v = 0.5f * float(std::sin(2 * 3.14159265358979 * 440.0 * double(i) / kRate));
            a.data[i * 2] = v; a.data[i * 2 + 1] = 0.5f * v;
        }
        const std::string path = dir + "/test.mp3";
        std::string err = mp3::encode(a, path, 128);
        CHECK(err.empty(), "encode: %s", err.c_str());
        Audio d; std::string e2;
        const bool decoded = decode_file(path, d, e2);
        CHECK(decoded, "decode: %s", e2.c_str());
        if (decoded) {
            const double secs = double(d.frames()) / kRate;
            CHECK(secs > 2.9 && secs < 3.3, "decoded length %.3f s", secs);
            double pk = 0; for (float v : d.data) pk = std::max(pk, double(std::fabs(v)));
            CHECK(pk > 0.35 && pk < 0.75, "decoded peak %.3f", pk);
            std::printf("MP3 round trip: %.2f s, peak %.3f, true peak %.2f dBTP\n", secs, pk, true_peak_db(d));
        }
    }

    // ---- Credential Manager round trip
    {
        credstore::clear();
        CHECK(credstore::load().empty(), "starts empty");
        CHECK(credstore::store("tok-ünï-123"), "store");
        CHECK(credstore::load() == "tok-ünï-123", "round trip: '%s'", credstore::load().c_str());
        credstore::clear();
        CHECK(credstore::load().empty(), "cleared");
    }

    // ---- WinHTTP + TLS against the real services, with a token that cannot be valid
    {
        auto http = make_http();
        buzz::Client c("not-a-real-token", *http, "PodStudio/ci-test (Windows)");
        bool rejected = false; std::string msg;
        try { c.podcasts(); } catch (const buzz::Error& e) { rejected = (e.status == 401 || e.status == 403); msg = e.what(); }
        CHECK(rejected, "Buzzsprout should answer 401/403 to a bad token over TLS: got '%s'", msg.c_str());
        try {
            auto info = updates::check(*http, "2000.01.01-1", "PodStudio/ci-test (Windows)");
            std::printf("GitHub releases check ok (%s)\n", info ? ("latest " + info->version).c_str() : "no release yet");
            CHECK(true, "ok");
        } catch (const std::exception& e) { CHECK(false, "GitHub check failed: %s", e.what()); }
    }

    // ---- HID enumeration with no PodMic attached
    {
        CHECK(!mic_hid_present(), "no PodMic on a CI runner");
        std::string err;
        auto link = connect_mic(err);
        CHECK(!link && !err.empty(), "connect fails cleanly: '%s'", err.c_str());
    }

    std::printf("\n%d checks, %d failed\n", checks, fails);
    return fails ? 1 : 0;
}
