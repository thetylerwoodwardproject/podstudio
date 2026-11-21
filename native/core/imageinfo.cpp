#include "imageinfo.h"

#include <cstdint>
#include <cstdio>
#include <cstring>
#include <vector>

namespace ps {

bool image_size(const std::string& path, int& w, int& h) {
    FILE* f = std::fopen(path.c_str(), "rb");
    if (!f) return false;
    uint8_t head[32];
    size_t n = std::fread(head, 1, sizeof head, f);
    bool ok = false;
    if (n >= 24 && !std::memcmp(head, "\x89PNG\r\n\x1a\n", 8)) {                       // IHDR: width, height as big-endian u32
        w = int((head[16] << 24) | (head[17] << 16) | (head[18] << 8) | head[19]);
        h = int((head[20] << 24) | (head[21] << 16) | (head[22] << 8) | head[23]);
        ok = true;
    } else if (n >= 4 && head[0] == 0xFF && head[1] == 0xD8) {                          // JPEG: walk the segments to a start-of-frame
        std::fseek(f, 2, SEEK_SET);
        for (;;) {
            int c = std::fgetc(f);
            while (c != EOF && c != 0xFF) c = std::fgetc(f);
            int m = std::fgetc(f);
            while (m == 0xFF) m = std::fgetc(f);
            if (c == EOF || m == EOF) break;
            if (m == 0xD8 || (m >= 0xD0 && m <= 0xD7) || m == 0x01) continue;           // markers with no length
            uint8_t len[2];
            if (std::fread(len, 1, 2, f) != 2) break;
            const int seg = (len[0] << 8) | len[1];
            if ((m >= 0xC0 && m <= 0xCF) && m != 0xC4 && m != 0xC8 && m != 0xCC) {
                uint8_t sof[5];
                if (std::fread(sof, 1, 5, f) != 5) break;
                h = (sof[1] << 8) | sof[2]; w = (sof[3] << 8) | sof[4];
                ok = true;
                break;
            }
            std::fseek(f, seg - 2, SEEK_CUR);
        }
    }
    std::fclose(f);
    return ok && w > 0 && h > 0;
}

}  // namespace ps
