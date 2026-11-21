#if !defined(_WIN32)
#include "platform.h"

#include <cstdio>
#include <cstdlib>
#include <filesystem>
#include <unistd.h>

namespace platform {

std::string exe_dir() {
    char b[4096];
    ssize_t n = readlink("/proc/self/exe", b, sizeof b - 1);
    if (n <= 0) return ".";
    b[n] = 0;
    return std::filesystem::path(b).parent_path().string();
}

static std::string shell_quote(const std::string& s) {
    std::string o = "'";
    for (char c : s) { if (c == '\'') o += "'\\''"; else o += c; }
    return o + "'";
}

static std::string capture(const std::string& cmd) {
    std::string out;
    if (FILE* p = popen(cmd.c_str(), "r")) {
        char b[1024];
        while (std::fgets(b, sizeof b, p)) out += b;
        pclose(p);
    }
    while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back();
    return out;
}

std::string open_file_dialog(const char* title, const char*, const char*) {
    return capture(std::string("zenity --file-selection --title=") + shell_quote(title) + " 2>/dev/null");
}
std::string save_file_dialog(const char* title, const char*, const char*, const char*) {
    return capture(std::string("zenity --file-selection --save --title=") + shell_quote(title) + " 2>/dev/null");
}
void reveal(const std::string& path) { if (std::system(("xdg-open " + shell_quote(path) + " >/dev/null 2>&1 &").c_str())) {} }
void open_url(const std::string& url) { reveal(url); }

int run_process(const std::vector<std::string>& args, std::string& output, int) {
    std::string cmd;
    for (auto& a : args) cmd += shell_quote(a) + " ";
    cmd += "2>&1";
    FILE* p = popen(cmd.c_str(), "r");
    if (!p) return -1;
    char b[1024];
    while (std::fgets(b, sizeof b, p)) output += b;
    int rc = pclose(p);
    return WIFEXITED(rc) ? WEXITSTATUS(rc) : -1;
}

}  // namespace platform
#endif
