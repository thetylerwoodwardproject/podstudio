// Finding out that a newer PodStudio exists, and downloading it safely. Port of podstudio/updates.py.
//
//   * the release is read over HTTPS from GitHub's API for this project only;
//   * downloads are only accepted from GitHub's own hosts, and redirects to anywhere else are refused;
//   * a release without a published SHA-256 checksum is never installed automatically (the release page is offered);
//   * the download is checked against that checksum before anything runs, and thrown away if it doesn't match.
#pragma once
#include <functional>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include "http.h"

namespace ps::updates {

constexpr const char* kRepo = "thetylerwoodwardproject/podstudio";
constexpr const char* kApi = "https://api.github.com";

class Error : public std::runtime_error { using std::runtime_error::runtime_error; };

std::optional<std::vector<int>> version_key(const std::string& v);      // "v2026.11.20" -> {2026,11,20,0}; "2026.11.20-3" -> {...,3}
bool is_newer(const std::string& candidate, const std::string& current);
bool is_installer_name(const std::string& name);                        // PodStudio-<version>[-rev]-x64-setup.exe
bool host_allowed(const std::string& url);

struct UpdateInfo {
    std::string version, notes, page, installer_url, installer_name, sha_url;
    long long installer_size = 0;
    std::vector<std::string> problems;
    bool can_install() const { return !installer_url.empty() && !sha_url.empty() && problems.empty(); }
};

// Returns the newest release if it is newer than `current`, else nullopt. No releases yet (404) means "no update".
std::optional<UpdateInfo> check(Http& http, const std::string& current, const std::string& user_agent,
                                const std::string& base = kApi, const std::string& repo = kRepo);

// Downloads the installer into `cache_dir` and verifies it. Returns the verified file's path.
std::string download(Http& http, const UpdateInfo& info, const std::string& cache_dir, const std::string& user_agent,
                     const std::function<void(uint64_t, uint64_t)>& progress);

std::string parse_checksum(const std::string& text, const std::string& filename);   // first 64-hex token; names must match

}  // namespace ps::updates
