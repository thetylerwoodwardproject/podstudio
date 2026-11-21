// The HTTP transport and the credential store for this platform.
#pragma once
#include <memory>
#include <string>

#include "../core/http.h"

namespace ps {

std::unique_ptr<Http> make_http();
bool in_demo_mode();                                      // PODSTUDIO_DEMO is set: canned Buzzsprout answers, for screenshots

// The Buzzsprout API token, kept in the system credential store (Windows Credential Manager), never in a file.
namespace credstore {
bool available();
std::string load();                                       // "" if none
bool store(const std::string& token);
void clear();
}

}  // namespace ps
