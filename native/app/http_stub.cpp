#ifndef _WIN32
// Linux preview: no real network. With PODSTUDIO_DEMO set it answers like Buzzsprout so the Publish page can be previewed.
#include <cstdlib>

#include <nlohmann/json.hpp>

#include "http_factory.h"

namespace ps {
namespace {

class DemoHttp : public Http {
public:
    HttpResponse send(const HttpRequest& r) override {
        HttpResponse o; o.status = 200;
        using json = nlohmann::json;
        if (r.url.find("/api/podcasts") != std::string::npos) o.body = json::array({{{"id", 123}, {"title", "The Long Show"}}, {{"id", 456}, {"title", "Side Project"}}}).dump();
        else if (r.method == "POST" && r.url.find("/episodes") != std::string::npos && r.url.find("/uploads") == std::string::npos) o.body = json({{"id", 9001}}).dump();
        else if (r.method == "POST" && r.url.find("/uploads") != std::string::npos && r.url.find("/complete") == std::string::npos)
            o.body = json({{"upload", {{"id", "u1"}, {"upload_url", "https://storage.example/put"}}}}).dump();
        else if (r.method == "PUT" && r.url.rfind("https://storage", 0) == 0) { if (r.progress) { r.progress(1, 2); r.progress(2, 2); } o.body = ""; }
        else if (r.method == "GET") o.body = json({{"id", 9001}, {"duration", 302}}).dump();
        else o.body = "{}";
        return o;
    }
};

std::string g_token;

}  // namespace

bool in_demo_mode() { return std::getenv("PODSTUDIO_DEMO") != nullptr; }
std::unique_ptr<Http> make_http() { return std::make_unique<DemoHttp>(); }
namespace credstore {
bool available() { return true; }
std::string load() { return g_token; }
bool store(const std::string& t) { g_token = t; return true; }
void clear() { g_token.clear(); }
}

}  // namespace ps
#endif
