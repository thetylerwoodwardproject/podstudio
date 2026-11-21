#ifdef _WIN32
#include "platform.h"

#define WIN32_LEAN_AND_MEAN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <commdlg.h>
#include <shellapi.h>

namespace platform {
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
// "Audio files\0*.wav;*.mp3\0All files\0*.*\0\0"
std::wstring filter(const char* desc, const char* pat) {
    std::wstring f = widen(desc); f.push_back(L'\0'); f += widen(pat); f.push_back(L'\0');
    f += L"All files"; f.push_back(L'\0'); f += L"*.*"; f.push_back(L'\0');
    return f;
}
std::string quote(const std::string& s) {                 // CommandLineToArgvW rules
    std::string o = "\"";
    int bs = 0;
    for (char c : s) {
        if (c == '\\') { bs++; continue; }
        if (c == '"') { o.append(size_t(bs) * 2 + 1, '\\'); o += '"'; }
        else { o.append(size_t(bs), '\\'); o += c; }
        bs = 0;
    }
    o.append(size_t(bs) * 2, '\\');
    return o + "\"";
}

}  // namespace

std::string exe_dir() {
    wchar_t b[MAX_PATH * 2];
    DWORD n = GetModuleFileNameW(nullptr, b, DWORD(sizeof b / sizeof b[0]));
    std::wstring p(b, n);
    size_t slash = p.find_last_of(L"\\/");
    return narrow(slash == std::wstring::npos ? p : p.substr(0, slash));
}

std::string open_file_dialog(const char* title, const char* description, const char* patterns) {
    wchar_t file[MAX_PATH * 4] = L"";
    std::wstring f = filter(description, patterns), t = widen(title);
    OPENFILENAMEW o{};
    o.lStructSize = sizeof o; o.hwndOwner = GetActiveWindow();
    o.lpstrFilter = f.c_str(); o.lpstrFile = file; o.nMaxFile = DWORD(sizeof file / sizeof file[0]);
    o.lpstrTitle = t.c_str(); o.Flags = OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER;
    return GetOpenFileNameW(&o) ? narrow(file) : "";
}

std::string save_file_dialog(const char* title, const char* description, const char* patterns, const char* default_name) {
    wchar_t file[MAX_PATH * 4] = L"";
    std::wstring dn = widen(default_name ? default_name : "");
    wcsncpy(file, dn.c_str(), MAX_PATH - 1);
    std::wstring f = filter(description, patterns), t = widen(title);
    OPENFILENAMEW o{};
    o.lStructSize = sizeof o; o.hwndOwner = GetActiveWindow();
    o.lpstrFilter = f.c_str(); o.lpstrFile = file; o.nMaxFile = DWORD(sizeof file / sizeof file[0]);
    o.lpstrTitle = t.c_str(); o.Flags = OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOCHANGEDIR | OFN_EXPLORER;
    return GetSaveFileNameW(&o) ? narrow(file) : "";
}

void reveal(const std::string& path) { ShellExecuteW(nullptr, L"open", widen(path).c_str(), nullptr, nullptr, SW_SHOWNORMAL); }
void open_url(const std::string& url) { ShellExecuteW(nullptr, L"open", widen(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL); }

int run_process(const std::vector<std::string>& args, std::string& output, int timeout_seconds) {
    SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
    HANDLE rd = nullptr, wr = nullptr;
    if (!CreatePipe(&rd, &wr, &sa, 0)) return -1;
    SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);
    std::string cmd;
    for (auto& a : args) cmd += (cmd.empty() ? "" : " ") + quote(a);
    std::wstring wcmd = widen(cmd);
    STARTUPINFOW si{}; si.cb = sizeof si; si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = wr; si.hStdError = wr; si.hStdInput = nullptr;
    PROCESS_INFORMATION pi{};
    BOOL ok = CreateProcessW(nullptr, wcmd.data(), nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);
    CloseHandle(wr);
    if (!ok) { CloseHandle(rd); return -1; }
    DWORD deadline = GetTickCount() + DWORD(timeout_seconds) * 1000;
    char buf[2048]; DWORD got;
    for (;;) {                                           // drain the pipe so the child never blocks on a full buffer
        DWORD avail = 0;
        if (PeekNamedPipe(rd, nullptr, 0, nullptr, &avail, nullptr) && avail) {
            if (ReadFile(rd, buf, sizeof buf, &got, nullptr) && got) output.append(buf, got);
            continue;
        }
        if (WaitForSingleObject(pi.hProcess, 50) == WAIT_OBJECT_0) {
            while (ReadFile(rd, buf, sizeof buf, &got, nullptr) && got) output.append(buf, got);
            break;
        }
        if (GetTickCount() > deadline) { TerminateProcess(pi.hProcess, 1); CloseHandle(rd); CloseHandle(pi.hProcess); CloseHandle(pi.hThread); return -1; }
    }
    DWORD code = 1;
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(rd); CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
    return int(code);
}

}  // namespace platform
#endif
