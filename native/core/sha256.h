#pragma once
#include <cstdint>
#include <string>

namespace ps {
class Sha256 {
public:
    Sha256();
    void update(const void* data, size_t n);
    std::string hex();                                   // finishes the hash; call once
private:
    void block(const uint8_t* p);
    uint32_t h_[8];
    uint8_t buf_[64];
    size_t fill_ = 0;
    uint64_t total_ = 0;
};
std::string sha256_hex(const std::string& data);
bool sha256_file(const std::string& path, std::string& hex);
}
