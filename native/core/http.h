// A minimal HTTP interface, so the Buzzsprout client is platform-neutral and testable. Windows implements it with WinHTTP.
#pragma once
#include <cstdint>
#include <functional>
#include <map>
#include <string>
#include <utility>
#include <vector>

namespace ps {

struct HttpRequest {
    std::string method = "GET", url;
    std::vector<std::pair<std::string, std::string>> headers;
    std::string body;                                          // sent as-is...
    std::string body_file;                                     // ...unless this is set: the file is streamed instead
    std::function<void(uint64_t sent, uint64_t total)> progress;
    int timeout_seconds = 120;
};

struct HttpResponse {
    int status = 0;                                            // 0 = no response (see error)
    std::string body, error;
    std::map<std::string, std::string> headers;                // keys lower-case
};

class Http {
public:
    virtual ~Http() = default;
    // Never follows redirects (they would carry the Authorization header somewhere else).
    virtual HttpResponse send(const HttpRequest& req) = 0;
};

}  // namespace ps
