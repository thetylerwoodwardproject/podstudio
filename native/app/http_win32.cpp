#ifdef _WIN32
#include "http_factory.h"

#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <winhttp.h>

#include <algorithm>
#include <cstdio>
#include <fstream>

namespace ps {
namespace {

std::wstring widen(const std::string& s) {
    if (s.empty()) return L"";
    int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), nullptr, 0);
    std::wstring w(size_t(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), int(s.size()), w.data(), n);
    return w;
}
std::string narrow(const std::wstring& w) {
    if (w.empty()) return "";
    int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), int(w.size()), nullptr, 0, nullptr, nullptr);
    std::string s(size_t(n), '\0');
    WideCharToMultiByte(CP_UTF8, 0, w.data(), int(w.size()), s.data(), n, nullptr, nullptr);
    return s;
}
std::string win_error(const char* what) {
    char b[160]; std::snprintf(b, sizeof b, "%s (error %lu)", what, GetLastError());
    return b;
}

struct Handle {
    HINTERNET h = nullptr;
    explicit Handle(HINTERNET x = nullptr) : h(x) {}
    ~Handle() { if (h) WinHttpCloseHandle(h); }
    Handle(const Handle&) = delete;
    Handle& operator=(const Handle&) = delete;
    operator HINTERNET() const { return h; }
};

class WinHttp : public Http {
public:
    HttpResponse send(const HttpRequest& req) override {
        HttpResponse out;
        URL_COMPONENTS uc{}; uc.dwStructSize = sizeof uc;
        uc.dwSchemeLength = uc.dwHostNameLength = uc.dwUrlPathLength = uc.dwExtraInfoLength = DWORD(-1);
        std::wstring url = widen(req.url);
        if (!WinHttpCrackUrl(url.c_str(), 0, 0, &uc)) { out.error = "invalid URL"; return out; }
        std::wstring host(uc.lpszHostName, uc.dwHostNameLength), path(uc.lpszUrlPath, uc.dwUrlPathLength);
        if (uc.dwExtraInfoLength) path.append(uc.lpszExtraInfo, uc.dwExtraInfoLength);
        const bool secure = uc.nScheme == INTERNET_SCHEME_HTTPS;

        Handle session(WinHttpOpen(L"PodStudio", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0));
        if (!session) { out.error = win_error("couldn't start WinHTTP"); return out; }
        Handle conn(WinHttpConnect(session, host.c_str(), uc.nPort, 0));
        if (!conn) { out.error = win_error("couldn't connect"); return out; }
        Handle r(WinHttpOpenRequest(conn, widen(req.method).c_str(), path.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                                    secure ? WINHTTP_FLAG_SECURE : 0));
        if (!r) { out.error = win_error("couldn't open the request"); return out; }
        DWORD policy = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;            // a redirect would carry the Authorization header along
        WinHttpSetOption(r, WINHTTP_OPTION_REDIRECT_POLICY, &policy, sizeof policy);
        const int ms = req.timeout_seconds * 1000;
        WinHttpSetTimeouts(r, 15000, 15000, ms, ms);

        std::wstring headers;
        for (auto& h : req.headers) headers += widen(h.first) + L": " + widen(h.second) + L"\r\n";

        uint64_t total = req.body.size();
        std::ifstream file;
        if (!req.body_file.empty()) {
            file.open(req.body_file, std::ios::binary | std::ios::ate);
            if (!file) { out.error = "couldn't read " + req.body_file; return out; }
            total = uint64_t(file.tellg());
            file.seekg(0);
        }
        if (!WinHttpSendRequest(r, headers.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : headers.c_str(), DWORD(-1), WINHTTP_NO_REQUEST_DATA, 0,
                                DWORD(std::min<uint64_t>(total, 0xFFFFFFFFu)), 0)) {
            out.error = win_error("couldn't send the request");
            return out;
        }
        uint64_t sent = 0;
        std::vector<char> buf(1 << 16);
        while (sent < total) {
            size_t n;
            if (file.is_open()) { file.read(buf.data(), std::streamsize(std::min<uint64_t>(buf.size(), total - sent))); n = size_t(file.gcount()); }
            else { n = size_t(std::min<uint64_t>(buf.size(), total - sent)); std::copy_n(req.body.data() + sent, n, buf.data()); }
            if (!n) break;
            DWORD wrote = 0;
            if (!WinHttpWriteData(r, buf.data(), DWORD(n), &wrote)) { out.error = win_error("the upload was interrupted"); return out; }
            sent += wrote;
            if (req.progress) req.progress(sent, total);
        }
        if (!WinHttpReceiveResponse(r, nullptr)) { out.error = win_error("no response"); return out; }
        DWORD status = 0, sz = sizeof status;
        WinHttpQueryHeaders(r, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX, &status, &sz, WINHTTP_NO_HEADER_INDEX);
        out.status = int(status);
        DWORD raw_len = 0;
        WinHttpQueryHeaders(r, WINHTTP_QUERY_RAW_HEADERS_CRLF, WINHTTP_HEADER_NAME_BY_INDEX, nullptr, &raw_len, WINHTTP_NO_HEADER_INDEX);
        if (raw_len) {
            std::wstring raw(raw_len / sizeof(wchar_t), L'\0');
            if (WinHttpQueryHeaders(r, WINHTTP_QUERY_RAW_HEADERS_CRLF, WINHTTP_HEADER_NAME_BY_INDEX, raw.data(), &raw_len, WINHTTP_NO_HEADER_INDEX)) {
                std::string text = narrow(raw);
                size_t pos = 0;
                while (pos < text.size()) {
                    size_t e = text.find("\r\n", pos);
                    if (e == std::string::npos) e = text.size();
                    std::string line = text.substr(pos, e - pos);
                    size_t c = line.find(':');
                    if (c != std::string::npos) {
                        std::string k = line.substr(0, c), v = line.substr(c + 1);
                        for (char& ch : k) ch = char(std::tolower((unsigned char)ch));
                        v.erase(0, v.find_first_not_of(" \t"));
                        out.headers[k] = v;
                    }
                    pos = e + 2;
                }
            }
        }
        for (;;) {
            DWORD avail = 0;
            if (!WinHttpQueryDataAvailable(r, &avail) || !avail) break;
            std::string chunk(avail, '\0');
            DWORD got = 0;
            if (!WinHttpReadData(r, chunk.data(), avail, &got) || !got) break;
            out.body.append(chunk.data(), got);
            if (out.body.size() > (64u << 20)) break;                   // API replies are small; don't buffer something huge
        }
        return out;
    }
};

}  // namespace

std::unique_ptr<Http> make_http() { return std::make_unique<WinHttp>(); }

}  // namespace ps
#endif
