// The few things that differ between Windows and the preview build.
#pragma once
#include <string>
#include <vector>

namespace platform {

std::string exe_dir();                                   // folder holding PodStudio.exe
// Native "Open" / "Save" dialogs. `patterns` like "*.wav;*.mp3". Return "" if cancelled or unavailable.
std::string open_file_dialog(const char* title, const char* description, const char* patterns);
std::string save_file_dialog(const char* title, const char* description, const char* patterns, const char* default_name);
void reveal(const std::string& path);                    // show a file or folder in the file manager
void open_url(const std::string& url);
// Runs a program to completion with no console window. Returns its exit code, or -1 if it couldn't start or timed out.
// Starts a program that outlives this one (the installer during an update). False if it couldn't start.
bool start_detached(const std::string& exe, const std::vector<std::string>& args);
bool installed_by_setup();                                // this copy has an uninstaller beside it, so it can update itself
int run_process(const std::vector<std::string>& args, std::string& output, int timeout_seconds);

}  // namespace platform
