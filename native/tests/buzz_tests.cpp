// The Buzzsprout client against a scripted fake server: what it sends, what it refuses to send, and how it fails.
#include <cmath>
#include <cstdio>
#include <deque>
#include <fstream>

#include "../core/buzzsprout.h"
#include "../core/chapters.h"

using namespace ps;
using json = nlohmann::json;
static int fails = 0, checks = 0;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; std::printf("FAIL line %d: %s  ", __LINE__, #c); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

struct Fake : Http {
    std::vector<HttpRequest> seen;
    std::deque<HttpResponse> script;
    HttpResponse send(const HttpRequest& r) override {
        seen.push_back(r);
        if (r.progress && !r.body_file.empty()) { r.progress(50, 100); r.progress(100, 100); }
        if (script.empty()) { HttpResponse e; e.status = 500; e.body = "script ran out"; return e; }
        HttpResponse x = script.front(); script.pop_front(); return x;
    }
};
HttpResponse ok(const json& j, int status = 200) { HttpResponse r; r.status = status; r.body = j.dump(); return r; }
HttpResponse bad(int status, const std::string& body = "", const char* retry_after = nullptr) {
    HttpResponse r; r.status = status; r.body = body; if (retry_after) r.headers["retry-after"] = retry_after; return r;
}
std::string header(const HttpRequest& r, const std::string& k) { for (auto& h : r.headers) if (h.first == k) return h.second; return "<none>"; }

int main(int argc, char** argv) {
    const std::string dir = argc > 1 ? argv[1] : ".";
    std::vector<double> sleeps;
    auto sleeper = [&](double s) { sleeps.push_back(s); };
    const std::string UA = "PodStudio/test";

    { // token and identification
        Fake f; f.script = {ok(json::array({{{"id", 7}, {"title", "My Show"}, {"contact_email", "private@example.com"}}}))};
        buzz::Client c("  tok123 \n", f, UA, "https://bz.test", sleeper);
        auto p = c.podcasts();
        CHECK(p.size() == 1 && p[0].id == 7 && p[0].title == "My Show", "podcasts parsed");
        CHECK(header(f.seen[0], "Authorization") == "Token token=tok123", "token is trimmed and sent as Token token=...");
        CHECK(header(f.seen[0], "User-Agent") == UA && f.seen[0].url == "https://bz.test/api/podcasts", "UA and url");
        bool threw = false; try { buzz::Client("   ", f, UA); } catch (const buzz::Error&) { threw = true; }
        CHECK(threw, "empty token refused");
    }
    { // episodes are always private; empty fields are dropped; no blind retry
        Fake f; f.script = {ok({{"id", 99}}, 201)};
        buzz::Client c("t", f, UA, "https://bz.test", sleeper);
        c.create_episode(7, "Ep 1", {{"description", ""}, {"tags", "a,b"}, {"episode_number", nullptr}, {"explicit", false}});
        json b = json::parse(f.seen[0].body);
        CHECK(b["private"] == true && b["title"] == "Ep 1" && b["tags"] == "a,b" && b["explicit"] == false && !b.contains("description") && !b.contains("episode_number"), "body %s", b.dump().c_str());
        Fake g; g.script = {bad(503), ok({{"id", 1}})};
        buzz::Client c2("t", g, UA, "https://bz.test", sleeper);
        bool threw = false; try { c2.create_episode(7, "x", json::object()); } catch (const buzz::Error&) { threw = true; }
        CHECK(threw && g.seen.size() == 1, "creating is never retried (it could duplicate the episode): %zu requests", g.seen.size());
    }
    { // retries with back-off and Retry-After
        Fake f; f.script = {bad(503), bad(429, "", "7"), ok({{"id", 5}, {"duration", 12}})};
        buzz::Client c("t", f, UA, "https://bz.test", sleeper);
        sleeps.clear();
        auto e = c.episode(7, 5);
        CHECK(e["id"] == 5 && f.seen.size() == 3, "succeeded on the third try");
        CHECK(sleeps.size() == 2 && sleeps[0] == 1.0 && sleeps[1] == 7.0, "waited %.1f then %.1f", sleeps.size() > 0 ? sleeps[0] : -1, sleeps.size() > 1 ? sleeps[1] : -1);
    }
    { // publishing resends explicit
        Fake f; f.script = {ok({{"id", 5}})};
        buzz::Client c("t", f, UA, "https://bz.test", sleeper);
        c.publish(7, 5, true);
        json b = json::parse(f.seen[0].body);
        CHECK(f.seen[0].method == "PATCH" && b["private"] == false && b["explicit"] == true, "publish body %s", b.dump().c_str());
    }
    { // upload: start -> PUT without the token -> complete
        std::ofstream(dir + "/ep.mp3", std::ios::binary) << "ID3fake-mp3-bytes";
        Fake f; f.script = {ok({{"upload", {{"id", "u 1"}, {"upload_url", "https://storage.test/put?sig=1"}}}}), HttpResponse{200, "", "", {}}, ok({{"id", 5}})};
        buzz::Client c("tok", f, UA, "https://bz.test", sleeper);
        uint64_t last = 0, tot = 0;
        c.upload_audio(7, 5, dir + "/ep.mp3", [&](uint64_t a, uint64_t b) { last = a; tot = b; });
        CHECK(f.seen.size() == 3, "three calls");
        json start = json::parse(f.seen[0].body);
        CHECK(start["type"] == "audio/mpeg" && start["filename"] == "ep.mp3" && start["byte_size"] == 17, "start body %s", start.dump().c_str());
        CHECK(f.seen[1].method == "PUT" && f.seen[1].url == "https://storage.test/put?sig=1" && f.seen[1].body_file == dir + "/ep.mp3", "PUT streams the file");
        CHECK(header(f.seen[1], "Authorization") == "<none>", "the token never goes to the storage host");
        CHECK(f.seen[2].url == "https://bz.test/api/7/episodes/5/uploads/u%201/complete", "complete url %s", f.seen[2].url.c_str());
        CHECK(last == 100 && tot == 100, "progress reported");
    }
    { // a failed PUT is aborted, and an insecure upload URL is refused
        Fake f; f.script = {ok({{"upload", {{"id", "u9"}, {"upload_url", "https://storage.test/put"}}}}), bad(403), ok(json::object())};
        buzz::Client c("tok", f, UA, "https://bz.test", sleeper);
        bool threw = false; try { c.upload_audio(7, 5, dir + "/ep.mp3", nullptr); } catch (const buzz::Error& e) { threw = e.status == 403; }
        CHECK(threw && f.seen.size() == 3 && f.seen[2].method == "DELETE" && f.seen[2].url.find("/u9/abort") != std::string::npos, "aborted after a failed PUT");
        Fake g; g.script = {ok({{"upload", {{"id", "u9"}, {"upload_url", "http://evil.test/put"}}}})};
        buzz::Client c2("tok", g, UA, "https://bz.test", sleeper);
        threw = false; try { c2.upload_audio(7, 5, dir + "/ep.mp3", nullptr); } catch (const buzz::Error& e) { threw = std::string(e.what()).find("insecure") != std::string::npos; }
        CHECK(threw && g.seen.size() == 1, "refused http:// storage");
    }
    { // artwork is multipart with explicit resent
        std::ofstream(dir + "/art.png", std::ios::binary) << "PNGDATA";
        Fake f; f.script = {ok({{"id", 5}})};
        buzz::Client c("t", f, UA, "https://bz.test", sleeper);
        c.set_artwork(7, 5, dir + "/art.png", false);
        const std::string ct = header(f.seen[0], "Content-Type"), &b = f.seen[0].body;
        CHECK(ct.rfind("multipart/form-data; boundary=", 0) == 0, "content type");
        CHECK(b.find("name=\"explicit\"\r\n\r\nfalse") != std::string::npos && b.find("name=\"artwork_file\"; filename=\"art.png\"") != std::string::npos
              && b.find("Content-Type: image/png") != std::string::npos && b.find("PNGDATA") != std::string::npos, "multipart parts");
    }
    { // chapters
        Fake f; f.script = {ok(json::array())};
        buzz::Client c("t", f, UA, "https://bz.test", sleeper);
        c.put_chapters(7, 5, {{0, "Intro"}, {3725.9, "Q&A"}});
        json b = json::parse(f.seen[0].body);
        CHECK(f.seen[0].method == "PUT" && b["chapters"][1]["start_time"] == "01:02:05" && b["chapters"][1]["title"] == "Q&A", "chapters body %s", b.dump().c_str());
        std::vector<std::string> notes;
        auto n = normalize_chapters({{30, "B"}, {10, ""}, {30.4, "dup"}, {9999, "late"}, {5, "A"}}, 600, notes);
        CHECK(n.size() == 3 && n[0].title == "Intro" && n[0].t == 0 && n[1].title == "A" && n[2].title == "B" && notes.size() == 4, "normalised to %zu chapters, %zu notes", n.size(), notes.size());
    }
    { // errors in both of Buzzsprout's formats, and bad tokens
        auto e1 = buzz::parse_error(422, R"({"error":{"message":"Title is too long","code":"invalid","param":"title"}})");
        CHECK(std::string(e1.what()) == "Title is too long" && e1.code == "invalid" && e1.param == "title", "current format");
        auto e2 = buzz::parse_error(422, R"({"title":["can't be blank"]})");
        CHECK(std::string(e2.what()) == "title can't be blank" && e2.param == "title", "legacy format: %s", e2.what());
        auto e3 = buzz::parse_error(401, "");
        CHECK(e3.code == "unauthorized", "401 means the token was rejected");
    }
    { // waiting for encoding
        Fake f; f.script = {ok({{"duration", -1}}), ok({{"duration", -1}}), ok({{"duration", 301}})};
        buzz::Client c("t", f, UA, "https://bz.test", sleeper);
        int polls = 0;
        auto e = c.wait_until_encoded(7, 5, 60, 5, [&] { polls++; });
        CHECK(e["duration"] == 301 && polls == 3, "polled until a duration appeared");
    }
    CHECK(buzz::format_hms(3725.9) == "01:02:05" && buzz::episode_url(7, 5) == "https://www.buzzsprout.com/7/episodes/5", "helpers");
    std::printf("\n%d checks, %d failed\n", checks, fails);
    return fails ? 1 : 0;
}
