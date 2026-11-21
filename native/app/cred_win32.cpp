#ifdef _WIN32
#include "http_factory.h"

#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <wincred.h>

#include <cstdlib>
#include <vector>

namespace ps {

bool in_demo_mode() { return std::getenv("PODSTUDIO_DEMO") != nullptr; }

namespace credstore {
namespace {
const wchar_t* kTarget = L"PodStudio: Buzzsprout API token";
}

bool available() { return true; }

std::string load() {
    PCREDENTIALW c = nullptr;
    if (!CredReadW(kTarget, CRED_TYPE_GENERIC, 0, &c)) return "";
    std::string out;
    if (c->CredentialBlobSize) {                                       // stored as UTF-16, like the Python build, so both read it
        const wchar_t* w = reinterpret_cast<const wchar_t*>(c->CredentialBlob);
        const int n = int(c->CredentialBlobSize / sizeof(wchar_t));
        int len = WideCharToMultiByte(CP_UTF8, 0, w, n, nullptr, 0, nullptr, nullptr);
        out.assign(size_t(len), '\0');
        WideCharToMultiByte(CP_UTF8, 0, w, n, out.data(), len, nullptr, nullptr);
    }
    CredFree(c);
    return out;
}

bool store(const std::string& token) {
    int n = MultiByteToWideChar(CP_UTF8, 0, token.data(), int(token.size()), nullptr, 0);
    std::vector<wchar_t> w(static_cast<size_t>(n > 0 ? n : 0));
    MultiByteToWideChar(CP_UTF8, 0, token.data(), int(token.size()), w.data(), n);
    CREDENTIALW c{};
    c.Type = CRED_TYPE_GENERIC;
    c.TargetName = const_cast<LPWSTR>(kTarget);
    c.UserName = const_cast<LPWSTR>(L"PodStudio");
    c.CredentialBlobSize = DWORD(w.size() * sizeof(wchar_t));
    c.CredentialBlob = reinterpret_cast<LPBYTE>(w.data());
    c.Persist = CRED_PERSIST_LOCAL_MACHINE;
    return CredWriteW(&c, 0) != FALSE;
}

void clear() { CredDeleteW(kTarget, CRED_TYPE_GENERIC, 0); }

}  // namespace credstore
}  // namespace ps
#endif
