// Image dimensions from a PNG or JPEG header, for the cover-art checks (no image library needed).
#pragma once
#include <string>
namespace ps {
bool image_size(const std::string& path, int& width, int& height);
}
