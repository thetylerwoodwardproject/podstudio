#include "buzzsprout.h"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <fstream>
#include <random>
#include <sstream>
#include <thread>

namespace ps::buzz {
using json = nlohmann::json;

namespace {

bool retryable(int s) { return s == 429 || s == 500 || s == 502 || s == 503 || s == 504; }

std::string url_encode(const std::string& s) {
    static const char* hex = "0123456789ABCDEF";
    std::string o;
    for (unsigned char c : s) {
        if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') o += char(c);
        else { o += '%'; o += hex[c >> 4]; o += hex[c & 15]; }
    }
    return o;
}

std::string file_name(const std::string& p) { size_t k = p.find_last_of("/\\"); return k == std::string::npos ? p : p.substr(k + 1); }

std::string guess_mime(const std::string& name) {
    std::string e = name.substr(name.find_last_of('.') == std::string::npos ? name.size() : name.find_last_of('.'));
    for (char& c : e) c = char(std::tolower((unsigned char)c));
    return e == ".png" ? "image/png" : (e == ".jpg" || e == ".jpeg") ? "image/jpeg" : "application/octet-stream";
}

}  // namespace

std::string format_hms(double seconds) {
    long s = std::max(0L, long(seconds));
    char b[24];
    std::snprintf(b, sizeof b, "%02ld:%02ld:%02ld", s / 3600, (s / 60) % 60, s % 60);
    return b;
}

std::string episode_url(long long podcast, long long ep) {
    return "https://www.buzzsprout.com/" + std::to_string(podcast) + "/episodes/" + std::to_string(ep);
}

Error parse_error(int status, const std::string& raw) {
    std::string text = raw;
    text.erase(0, text.find_first_not_of(" \t\r\n"));
    while (!text.empty() && std::isspace((unsigned char)text.back())) text.pop_back();
    json d = json::parse(text, nullptr, false);
    if (!d.is_discarded() && d.is_object() && d.contains("error") && d["error"].is_object()) {      // current format
        const json& e = d["error"];
        std::string msg = e.value("message", ""); if (msg.empty()) msg = text;
        return Error(msg, status, e.value("code", ""), e.value("param", ""));
    }
    if (!d.is_discarded() && d.is_object()) {                                                       // legacy: {"title": ["can't be blank"]}
        std::string out, first;
        for (auto it = d.begin(); it != d.end(); ++it) {
            if (first.empty()) first = it.key();
            std::string v;
            if (it->is_array()) { for (auto& x : *it) v += (v.empty() ? "" : ", ") + (x.is_string() ? x.get<std::string>() : x.dump()); }
            else v = it->is_string() ? it->get<std::string>() : it->dump();
            out += (out.empty() ? "" : "; ") + it.key() + " " + v;
        }
        return Error(out.empty() ? "HTTP " + std::to_string(status) : out, status, "invalid", first);
    }
    if (status == 401 || status == 403) return Error("Buzzsprout rejected the API token.", status, "unauthorized");
    return Error(text.empty() ? "HTTP " + std::to_string(status) : text.substr(0, 200), status);
}

Client::Client(std::string token, Http& http, std::string ua, std::string base, std::function<void(double)> sleep)
    : token_(std::move(token)), base_(std::move(base)), ua_(std::move(ua)), http_(http), sleep_(std::move(sleep)) {
    auto a = token_.find_first_not_of(" \t\r\n"), z = token_.find_last_not_of(" \t\r\n");
    token_ = a == std::string::npos ? "" : token_.substr(a, z - a + 1);
    if (token_.empty()) throw Error("No API token.");
    while (!base_.empty() && base_.back() == '/') base_.pop_back();
    if (!sleep_) sleep_ = [](double s) { std::this_thread::sleep_for(std::chrono::duration<double>(s)); };
}

json Client::send(HttpRequest req, bool retry) {
    req.url = base_ + req.url;
    req.headers.insert(req.headers.begin(), {"Authorization", "Token token=" + token_});
    req.headers.push_back({"User-Agent", ua_});
    req.headers.push_back({"Accept", "application/json"});
    const int attempts = retry ? 4 : 1;
    for (int attempt = 0; attempt < attempts; attempt++) {
        HttpResponse r = http_.send(req);
        if (r.status == 0) {                                                  // no response at all
            if (attempt < attempts - 1) { sleep_(std::pow(2.0, attempt)); continue; }
            throw Error("Couldn't reach Buzzsprout: " + r.error);
        }
        if (r.status >= 200 && r.status < 300) {
            if (r.body.find_first_not_of(" \t\r\n") == std::string::npos) return json(nullptr);
            json j = json::parse(r.body, nullptr, false);
            if (j.is_discarded()) throw Error("Buzzsprout sent something unreadable.", r.status);
            return j;
        }
        if (retryable(r.status) && attempt < attempts - 1) {
            double wait = std::pow(2.0, attempt);
            auto it = r.headers.find("retry-after");
            if (it != r.headers.end()) { try { wait = std::min(std::stod(it->second), 60.0); } catch (...) {} }
            sleep_(wait);
            continue;
        }
        throw parse_error(r.status, r.body);
    }
    throw Error("unreachable");
}

json Client::call(const std::string& method, const std::string& path, const json* body, bool retry) {
    HttpRequest r;
    r.method = method; r.url = path;
    if (body) { r.body = body->dump(); r.headers.push_back({"Content-Type", "application/json; charset=utf-8"}); }
    return send(std::move(r), retry);
}

std::vector<PodcastInfo> Client::podcasts() {
    std::vector<PodcastInfo> out;                      // just what the app needs; the API also returns contact details
    json j = call("GET", "/api/podcasts");
    if (j.is_array()) for (auto& p : j) out.push_back({p.value("id", 0LL), p.value("title", std::to_string(p.value("id", 0LL)))});
    return out;
}

json Client::create_episode(long long podcast, const std::string& title, const json& fields) {
    json body = json::object();
    for (auto it = fields.begin(); it != fields.end(); ++it)
        if (!it->is_null() && !(it->is_string() && it->get<std::string>().empty())) body[it.key()] = *it;
    body["title"] = title; body["private"] = true;      // always private: it cannot be public until publish()
    return call("POST", "/api/" + std::to_string(podcast) + "/episodes", &body, false);      // no blind retry: could duplicate
}

json Client::episode(long long podcast, long long ep) { return call("GET", "/api/" + std::to_string(podcast) + "/episodes/" + std::to_string(ep)); }

json Client::update_episode(long long podcast, long long ep, const json& fields) {
    return call("PATCH", "/api/" + std::to_string(podcast) + "/episodes/" + std::to_string(ep), &fields);
}

json Client::publish(long long p, long long e, bool x) { return update_episode(p, e, {{"private", false}, {"explicit", x}}); }
json Client::unpublish(long long p, long long e, bool x) { return update_episode(p, e, {{"private", true}, {"explicit", x}}); }

json Client::set_artwork(long long podcast, long long ep, const std::string& path, bool explicit_) {
    std::ifstream in(path, std::ios::binary);
    if (!in) throw Error("Couldn't read the artwork file.");
    std::stringstream ss; ss << in.rdbuf();
    const std::string data = ss.str();
    if (long(data.size()) > kMaxArtBytes) throw Error("Artwork is " + std::to_string(data.size() / 1000000) + " MB; the limit here is 20 MB.");
    std::random_device rd; char hex[25];
    std::snprintf(hex, sizeof hex, "%08x%08x%08x", rd(), rd(), rd());
    const std::string boundary = std::string("----podstudio") + hex, name = file_name(path);
    std::string body = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"explicit\"\r\n\r\n" + (explicit_ ? "true" : "false") + "\r\n"
                     + "--" + boundary + "\r\nContent-Disposition: form-data; name=\"artwork_file\"; filename=\"" + name + "\"\r\nContent-Type: "
                     + guess_mime(name) + "\r\n\r\n" + data + "\r\n--" + boundary + "--\r\n";
    HttpRequest r;
    r.method = "PATCH"; r.url = "/api/" + std::to_string(podcast) + "/episodes/" + std::to_string(ep);
    r.body = std::move(body);
    r.headers.push_back({"Content-Type", "multipart/form-data; boundary=" + boundary});
    return send(std::move(r), true);
}

json Client::put_chapters(long long podcast, long long ep, const std::vector<Chapter>& chapters) {
    json list = json::array();
    for (const Chapter& c : chapters) list.push_back({{"title", c.title}, {"start_time", format_hms(c.t)}});
    json body = {{"chapters", list}};
    json r = call("PUT", "/api/" + std::to_string(podcast) + "/episodes/" + std::to_string(ep) + "/chapters", &body);
    return r.is_null() ? json::array() : r;
}

json Client::upload_audio(long long podcast, long long ep, const std::string& path, const std::function<void(uint64_t, uint64_t)>& progress) {
    std::ifstream in(path, std::ios::binary | std::ios::ate);
    if (!in) throw Error("Couldn't read the MP3.");
    const long long size = in.tellg();
    in.close();
    if (size > (5LL << 30)) throw Error("File is over 5 GiB.");
    const std::string base = "/api/" + std::to_string(podcast) + "/episodes/" + std::to_string(ep) + "/uploads";
    json start = {{"filename", file_name(path)}, {"type", "audio/mpeg"}, {"byte_size", size}};
    json started = call("POST", base, &start);
    json up = started.is_object() && started.contains("upload") ? started["upload"] : json::object();
    if (!up.is_object() || !up.contains("id") || !up.contains("upload_url") || !up["upload_url"].is_string())
        throw Error("Buzzsprout didn't return an upload URL.");
    const std::string id = up["id"].is_string() ? up["id"].get<std::string>() : up["id"].dump();
    const std::string url = up["upload_url"].get<std::string>();
    const bool local_test = base_.rfind("http://127.0.0.1", 0) == 0 && url.rfind("http://127.0.0.1", 0) == 0;
    if (url.rfind("https://", 0) != 0 && !local_test) throw Error("Refusing to upload over an insecure connection.");
    HttpRequest put;                                    // deliberately bare: no Authorization header goes to the storage host
    put.method = "PUT"; put.url = url; put.body_file = path; put.progress = progress; put.timeout_seconds = 600;
    put.headers = {{"Content-Type", "audio/mpeg"}, {"User-Agent", ua_}};
    HttpResponse r = http_.send(put);
    if (r.status < 200 || r.status >= 300) {
        try { call("DELETE", base + "/" + url_encode(id) + "/abort", nullptr, false); } catch (const Error&) {}
        if (r.status == 0) throw Error("Upload failed: " + r.error);
        throw Error("Upload failed (" + std::to_string(r.status) + ").", r.status, "upload_failed");
    }
    return call("POST", base + "/" + url_encode(id) + "/complete", nullptr, false);
}

json Client::wait_until_encoded(long long podcast, long long ep, double timeout_s, double poll_s, const std::function<void()>& on_poll) {
    auto end = std::chrono::steady_clock::now() + std::chrono::duration<double>(timeout_s);
    for (;;) {
        json e = episode(podcast, ep);
        if (on_poll) on_poll();
        if (e.is_object() && e.contains("duration") && e["duration"].is_number() && e["duration"].get<double>() > 0) return e;
        if (std::chrono::steady_clock::now() > end) throw Error("Buzzsprout is still encoding. Check the episode on buzzsprout.com.");
        sleep_(std::max(poll_s, 1.0));
    }
}

}  // namespace ps::buzz
