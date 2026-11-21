#include "updates.h"

#include <algorithm>
#include <cctype>
#include <cstdio>
#include <filesystem>
#include <fstream>
#include <regex>

#include <nlohmann/json.hpp>

#include "sha256.h"

namespace fs = std::filesystem;
using json = nlohmann::json;

namespace ps::updates {

constexpr long long kMaxInstallerBytes = 700LL * 1000 * 1000;

std::optional<std::vector<int>> version_key(const std::string& v_in) {
    std::string v = v_in;
    v.erase(0, v.find_first_not_of(" \t"));
    while (!v.empty() && std::isspace((unsigned char)v.back())) v.pop_back();
    static const std::regex re(R"(v?(\d+(?:\.\d+){1,3})(?:-(\d+))?)");
    std::smatch m;
    if (!std::regex_match(v, m, re)) return std::nullopt;
    std::vector<int> k;
    std::string nums = m[1], part;
    for (size_t i = 0; i <= nums.size(); i++) {
        if (i == nums.size() || nums[i] == '.') { k.push_back(std::stoi(part)); part.clear(); } else part += nums[i];
    }
    while (k.size() < 3) k.push_back(0);                          // 2026.11 == 2026.11.0
    k.push_back(m[2].matched ? std::stoi(m[2]) : 0);
    return k;
}

bool is_newer(const std::string& a, const std::string& b) {
    auto x = version_key(a), y = version_key(b);
    return x && y && *x > *y;
}

bool is_installer_name(const std::string& n) {
    static const std::regex re(R"(PodStudio-[0-9][0-9.]*(-[0-9]+)?-x64-setup\.exe)");
    return std::regex_match(n, re);
}

bool host_allowed(const std::string& url) {
    static const char* hosts[] = {"github.com", "api.github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"};
    if (url.rfind("https://", 0) != 0) return false;
    std::string rest = url.substr(8);
    std::string host = rest.substr(0, rest.find_first_of("/:?#"));
    for (char& c : host) c = char(std::tolower((unsigned char)c));
    for (const char* h : hosts) {
        std::string s = h;
        if (host == s || (host.size() > s.size() && host.compare(host.size() - s.size() - 1, std::string::npos, "." + s) == 0)) return true;
    }
    return false;
}

namespace {

// One GET that follows redirects by hand, and only to GitHub's own hosts over HTTPS.
HttpResponse fetch(Http& http, std::string url, const std::string& ua, const std::string& accept, uint64_t max_bytes,
                   const std::function<void(uint64_t, uint64_t)>& progress, bool allow_local) {
    for (int hop = 0; hop < 6; hop++) {
        const bool local = allow_local && url.rfind("http://127.0.0.1", 0) == 0;
        if (!local && !host_allowed(url)) throw Error("Refusing to use a host that isn't GitHub's.");
        HttpRequest r;
        r.method = "GET"; r.url = url; r.timeout_seconds = 120; r.max_response_bytes = max_bytes; r.on_receive = progress;
        r.headers = {{"User-Agent", ua}};
        if (!accept.empty()) r.headers.push_back({"Accept", accept});
        HttpResponse resp = http.send(r);
        if (resp.status >= 300 && resp.status < 400) {
            auto it = resp.headers.find("location");
            if (it == resp.headers.end()) throw Error("GitHub sent a redirect with nowhere to go.");
            url = it->second;
            continue;
        }
        return resp;
    }
    throw Error("Too many redirects.");
}

}  // namespace

std::string parse_checksum(const std::string& text, const std::string& filename) {
    static const std::regex re(R"(^\s*([0-9a-fA-F]{64})(?:\s+\*?(.+?))?\s*$)");
    size_t pos = 0;
    while (pos <= text.size()) {
        size_t e = text.find('\n', pos);
        if (e == std::string::npos) e = text.size();
        std::string line = text.substr(pos, e - pos);
        if (!line.empty() && line.back() == '\r') line.pop_back();
        std::smatch m;
        if (std::regex_match(line, m, re)) {
            std::string named = m[2].matched ? m[2].str() : "";
            size_t slash = named.find_last_of("/\\");
            if (slash != std::string::npos) named = named.substr(slash + 1);
            if (named.empty() || named == filename) {
                std::string h = m[1];
                for (char& c : h) c = char(std::tolower((unsigned char)c));
                return h;
            }
        }
        pos = e + 1;
    }
    throw Error("The published checksum couldn't be read.");
}

std::optional<UpdateInfo> check(Http& http, const std::string& current, const std::string& ua, const std::string& base, const std::string& repo) {
    const bool local = base.rfind("http://127.0.0.1", 0) == 0;
    HttpResponse r = fetch(http, base + "/repos/" + repo + "/releases/latest", ua, "application/vnd.github+json", 2'000'000, nullptr, local);
    if (r.status == 404) return std::nullopt;                      // no releases yet is normal
    if (r.status == 0) throw Error("Couldn't reach GitHub: " + r.error);
    if (r.status != 200) throw Error("GitHub answered " + std::to_string(r.status) + ".");
    json rel = json::parse(r.body, nullptr, false);
    if (rel.is_discarded() || !rel.is_object()) throw Error("GitHub sent something unreadable.");
    if (rel.value("draft", false) || rel.value("prerelease", false)) return std::nullopt;
    std::string tag = rel.value("tag_name", "");
    if (!is_newer(tag, current)) return std::nullopt;
    UpdateInfo info;
    info.version = tag.rfind("v", 0) == 0 ? tag.substr(1) : tag;
    info.notes = rel.value("body", "");
    info.page = rel.value("html_url", "https://github.com/" + repo + "/releases");
    std::vector<json> assets;
    if (rel.contains("assets") && rel["assets"].is_array()) for (auto& a : rel["assets"]) if (a.is_object()) assets.push_back(a);
    const json* best = nullptr; std::vector<int> best_key;
    for (auto& a : assets) {
        std::string n = a.value("name", "");
        if (!is_installer_name(n)) continue;
        auto k = version_key(n.substr(10, n.find("-x64-") - 10));    // after "PodStudio-"
        if (!best || (k && *k > best_key)) { best = &a; if (k) best_key = *k; }
    }
    if (!best) { info.problems.push_back("This release has no installer for Windows."); return info; }
    info.installer_name = (*best).value("name", "");
    info.installer_url = (*best).value("browser_download_url", "");
    info.installer_size = (*best).value("size", 0LL);
    for (auto& a : assets) if (a.value("name", "") == info.installer_name + ".sha256") info.sha_url = a.value("browser_download_url", "");
    if (info.sha_url.empty()) info.problems.push_back("This release doesn't publish a checksum, so PodStudio won't install it automatically.");
    for (const std::string* u : {&info.installer_url, &info.sha_url})
        if (!u->empty() && !host_allowed(*u) && !(local && u->rfind("http://127.0.0.1", 0) == 0)) { info.problems.push_back("This release points at a download host that PodStudio doesn't trust."); break; }
    if (info.installer_size > kMaxInstallerBytes) info.problems.push_back("The installer is much larger than expected.");
    return info;
}

std::string download(Http& http, const UpdateInfo& info, const std::string& cache, const std::string& ua, const std::function<void(uint64_t, uint64_t)>& progress) {
    if (!info.can_install()) {
        std::string why; for (auto& p : info.problems) why += (why.empty() ? "" : " ") + p;
        throw Error(why.empty() ? "This update can't be installed automatically." : why);
    }
    if (!is_installer_name(info.installer_name)) throw Error("That isn't a PodStudio installer name.");
    const bool local = info.installer_url.rfind("http://127.0.0.1", 0) == 0;
    HttpResponse sum = fetch(http, info.sha_url, ua, "", 4096, nullptr, local);
    if (sum.status != 200) throw Error("The published checksum couldn't be downloaded.");
    const std::string expected = parse_checksum(sum.body, info.installer_name);
    HttpResponse file = fetch(http, info.installer_url, ua, "", kMaxInstallerBytes, progress, local);
    if (file.status != 200) throw Error(file.status == 0 ? "The download failed: " + file.error : "The download failed (" + std::to_string(file.status) + ").");
    if (sha256_hex(file.body) != expected) throw Error("The download doesn't match its published checksum, so it was discarded.");
    std::error_code ec;
    fs::create_directories(cache, ec);
    const std::string final_path = (fs::path(cache) / info.installer_name).string(), part = final_path + ".part";
    { std::ofstream o(part, std::ios::binary | std::ios::trunc); o.write(file.body.data(), std::streamsize(file.body.size())); if (!o) throw Error("Couldn't save the download."); }
    fs::remove(final_path, ec);
    fs::rename(part, final_path, ec);
    if (ec) throw Error("Couldn't save the download: " + ec.message());
    return final_path;
}

}  // namespace ps::updates
