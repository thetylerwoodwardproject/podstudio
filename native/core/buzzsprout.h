// Buzzsprout API client (https://github.com/Buzzsprout/buzzsprout-api). Port of podstudio/buzzsprout.py.
//
// Publish flow: create a private episode -> start upload -> PUT the file bytes (no Authorization header) -> complete
// upload -> wait for encoding -> (only when the user confirms) make it public. PodStudio only ever creates private drafts.
#pragma once
#include <functional>
#include <stdexcept>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

#include "http.h"
#include "project.h"

namespace ps::buzz {

constexpr const char* kApi = "https://www.buzzsprout.com";
constexpr long kMaxArtBytes = 20 * 1000 * 1000;

class Error : public std::runtime_error {
public:
    Error(const std::string& m, int status = 0, std::string code = "", std::string param = "")
        : std::runtime_error(m), status(status), code(std::move(code)), param(std::move(param)) {}
    int status;
    std::string code, param;
};

struct PodcastInfo { long long id; std::string title; };

class Client {
public:
    // `sleep` is injectable so tests don't wait. user_agent names the app only, nothing about the user.
    Client(std::string token, Http& http, std::string user_agent, std::string base = kApi,
           std::function<void(double)> sleep = nullptr);

    std::vector<PodcastInfo> podcasts();
    nlohmann::json create_episode(long long podcast, const std::string& title, const nlohmann::json& fields);   // always private
    nlohmann::json episode(long long podcast, long long ep);
    nlohmann::json update_episode(long long podcast, long long ep, const nlohmann::json& fields);
    nlohmann::json publish(long long podcast, long long ep, bool explicit_);       // explicit is resent: omitting it clears the flag
    nlohmann::json unpublish(long long podcast, long long ep, bool explicit_);
    nlohmann::json set_artwork(long long podcast, long long ep, const std::string& path, bool explicit_);
    nlohmann::json put_chapters(long long podcast, long long ep, const std::vector<Chapter>& chapters);
    nlohmann::json upload_audio(long long podcast, long long ep, const std::string& path,
                                const std::function<void(uint64_t, uint64_t)>& progress);
    nlohmann::json wait_until_encoded(long long podcast, long long ep, double timeout_s, double poll_s,
                                      const std::function<void()>& on_poll = nullptr);

private:
    nlohmann::json call(const std::string& method, const std::string& path, const nlohmann::json* body = nullptr, bool retry = true);
    nlohmann::json send(HttpRequest req, bool retry);
    std::string token_, base_, ua_;
    Http& http_;
    std::function<void(double)> sleep_;
};

std::string format_hms(double seconds);
std::string episode_url(long long podcast, long long ep);
Error parse_error(int status, const std::string& body);

}  // namespace ps::buzz
