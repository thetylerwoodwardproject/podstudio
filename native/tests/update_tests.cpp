// The updater: version rules, picking the installer, and refusing anything untrustworthy.
#include <cstdio>
#include <deque>
#include <filesystem>
#include <fstream>

#include <nlohmann/json.hpp>

#include "../core/sha256.h"
#include "../core/updates.h"

using namespace ps;
using json = nlohmann::json;
namespace fs = std::filesystem;
static int fails = 0, checks = 0;
#define CHECK(c, ...) do { checks++; if (!(c)) { fails++; std::printf("FAIL line %d: %s  ", __LINE__, #c); std::printf(__VA_ARGS__); std::printf("\n"); } } while (0)

struct Fake : Http {
    std::vector<std::string> urls;
    std::deque<HttpResponse> script;
    HttpResponse send(const HttpRequest& r) override {
        urls.push_back(r.url);
        if (script.empty()) { HttpResponse e; e.status = 500; return e; }
        HttpResponse x = script.front(); script.pop_front(); return x;
    }
};
HttpResponse ok(const std::string& body, int s = 200) { HttpResponse r; r.status = s; r.body = body; return r; }
HttpResponse redirect(const std::string& to) { HttpResponse r; r.status = 302; r.headers["location"] = to; return r; }

int main(int argc, char** argv) {
    const std::string dir = argc > 1 ? argv[1] : ".";
    // SHA-256 against the standard vectors
    CHECK(sha256_hex("") == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "empty");
    CHECK(sha256_hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "abc");
    CHECK(sha256_hex(std::string(1000, 'a')) == "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3", "1000 a");

    CHECK(updates::is_newer("v2026.12.05", "2026.11.20") && updates::is_newer("2026.11.20-3", "2026.11.20-2") && updates::is_newer("2026.11.20-2", "2026.11.20"), "newer");
    CHECK(!updates::is_newer("2026.11.20", "2026.11.20-3") && !updates::is_newer("2026.11.19", "2026.11.20") && !updates::is_newer("latest", "2026.11.20"), "not newer");
    CHECK(updates::is_installer_name("PodStudio-2026.12.05-x64-setup.exe") && updates::is_installer_name("PodStudio-2026.12.05-3-x64-setup.exe")
          && !updates::is_installer_name("PodStudio-2026.12.05-x64-setup.exe.sha256") && !updates::is_installer_name("podstudio_2026.12.05_amd64.deb")
          && !updates::is_installer_name("PodStudio-1-x64-setup.exe; calc"), "installer names");
    CHECK(updates::host_allowed("https://github.com/o/r/x") && updates::host_allowed("https://objects.githubusercontent.com/a")
          && !updates::host_allowed("http://github.com/x") && !updates::host_allowed("https://evil.example.com/x") && !updates::host_allowed("https://github.com.evil.com/x"), "hosts");

    const std::string exe = std::string("MZ") + std::string(5000, 'x'), name = "PodStudio-2026.12.05-x64-setup.exe", sum = sha256_hex(exe);
    auto release = [&](bool with_sha, const std::string& url_host = "https://github.com/dl") {
        json assets = json::array({{{"name", "podstudio_2026.12.05_amd64.deb"}, {"size", 5}, {"browser_download_url", url_host + "/d.deb"}},
                                   {{"name", name}, {"size", int(exe.size())}, {"browser_download_url", url_host + "/" + name}}});
        if (with_sha) assets.push_back({{"name", name + ".sha256"}, {"size", 90}, {"browser_download_url", url_host + "/" + name + ".sha256"}});
        return ok(json({{"tag_name", "v2026.12.05"}, {"body", "Adds a thing."}, {"html_url", "https://github.com/o/r/releases/tag/x"}, {"assets", assets}}).dump());
    };
    { Fake f; f.script = {release(true)};
      auto i = updates::check(f, "2026.11.20", "UA");
      CHECK(i && i->can_install() && i->installer_name == name && i->version == "2026.12.05" && i->notes == "Adds a thing.", "picks the installer, not the .deb"); }
    { Fake f; f.script = {release(false)};
      auto i = updates::check(f, "2026.11.20", "UA");
      CHECK(i && !i->can_install() && i->problems.size() == 1 && i->problems[0].find("checksum") != std::string::npos, "no checksum, no auto-install"); }
    { Fake f; f.script = {release(true, "https://evil.example.com")};
      auto i = updates::check(f, "2026.11.20", "UA");
      CHECK(i && !i->can_install(), "untrusted download host"); }
    { Fake f; f.script = {ok("", 404)}; CHECK(!updates::check(f, "2026.11.20", "UA"), "404 means no releases yet"); }
    { Fake f; f.script = {release(true)}; CHECK(!updates::check(f, "2026.12.05", "UA"), "already current"); }
    { Fake f; f.script = {ok(json({{"tag_name", "v2027.01.01"}, {"prerelease", true}, {"assets", json::array()}}).dump())}; CHECK(!updates::check(f, "2026.11.20", "UA"), "pre-releases are ignored"); }

    // download: verified, written once, redirects only to GitHub
    { updates::UpdateInfo i; i.installer_name = name; i.installer_url = "https://github.com/dl/" + name; i.sha_url = i.installer_url + ".sha256";
      Fake f; f.script = {ok(sum + "  " + name + "\n"), redirect("https://objects.githubusercontent.com/blob/1"), ok(exe)};
      const std::string cache = dir + "/update-cache";
      std::string path = updates::download(f, i, cache, "UA", nullptr);
      std::string got; sha256_file(path, got);
      CHECK(got == sum && fs::path(path).filename() == name && f.urls.size() == 3 && f.urls[2] == "https://objects.githubusercontent.com/blob/1", "verified download via a GitHub redirect"); }
    { updates::UpdateInfo i; i.installer_name = name; i.installer_url = "https://github.com/dl/" + name; i.sha_url = i.installer_url + ".sha256";
      Fake f; f.script = {ok(sum + "  " + name + "\n"), redirect("https://evil.example.com/steal.exe")};
      bool threw = false; try { updates::download(f, i, dir + "/uc2", "UA", nullptr); } catch (const updates::Error& e) { threw = true; }
      CHECK(threw && !fs::exists(dir + "/uc2/" + name), "a redirect away from GitHub is refused"); }
    { updates::UpdateInfo i; i.installer_name = name; i.installer_url = "https://github.com/dl/" + name; i.sha_url = i.installer_url + ".sha256";
      Fake f; f.script = {ok(std::string(64, 'a') + "  " + name + "\n"), ok(exe)};
      bool threw = false; std::string msg; try { updates::download(f, i, dir + "/uc3", "UA", nullptr); } catch (const updates::Error& e) { threw = true; msg = e.what(); }
      CHECK(threw && msg.find("doesn't match") != std::string::npos && !fs::exists(dir + "/uc3/" + name), "a download that doesn't match is discarded"); }
    CHECK(updates::parse_checksum(sum + " *" + name, name) == sum && updates::parse_checksum(sum, name) == sum, "checksum formats");
    bool threw = false; try { updates::parse_checksum(sum + "  other.exe", name); } catch (const updates::Error&) { threw = true; }
    CHECK(threw, "a checksum for another file is not accepted");
    std::printf("\n%d checks, %d failed\n", checks, fails);
    return fails ? 1 : 0;
}
