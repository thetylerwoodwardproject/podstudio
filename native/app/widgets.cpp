#include "widgets.h"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "theme.h"

using namespace theme;

namespace ui {

static float clampf(float v, float lo, float hi) { return std::max(lo, std::min(hi, v)); }

float db_to_frac(float db) { return clampf((db + 60.f) / 60.f, 0.f, 1.f); }

std::string fmt_time(double s, bool tenths) {
    if (s < 0) s = 0;
    long t = long(s);
    char b[32];
    if (t >= 3600) std::snprintf(b, sizeof b, "%ld:%02ld:%02ld", t / 3600, (t / 60) % 60, t % 60);
    else if (tenths) std::snprintf(b, sizeof b, "%02ld:%02ld.%ld", t / 60, t % 60, long((s - double(t)) * 10));
    else std::snprintf(b, sizeof b, "%02ld:%02ld", t / 60, t % 60);
    return b;
}

ImVec2 text_size(ImFont* f, const char* t) {
    ImGui::PushFont(f);
    ImVec2 s = ImGui::CalcTextSize(t);
    ImGui::PopFont();
    return s;
}

void text_at(ImDrawList* dl, ImFont* f, ImVec2 p, ImU32 col, const char* t) {
    dl->AddText(f, f->FontSize, p, col, t);
}

void MeterState::update(float db, float dt) {
    if (db > level) level = db; else level = std::max(db, level - 30.f * dt);
    if (db >= peak) { peak = db; hold_t = 1.4f; }
    else { hold_t -= dt; if (hold_t < 0) peak = std::max(level, peak - 20.f * dt); }
}

// ------------------------------------------------------------------------------------------------ meters
void meter_vertical(const char* id, const MeterState& m, float h, bool ruler_right) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float bar_w = px(14), ruler_w = px(30);
    ImVec2 p = ImGui::GetCursorScreenPos();
    ImGui::PushID(id);
    ImGui::Dummy(ImVec2(bar_w + ruler_w, h));
    ImGui::PopID();
    const int N = 40;
    const float gap = px(2), seg_h = (h - gap * (N - 1)) / N;
    for (int i = 0; i < N; i++) {
        const float db_top = -60.f + (i + 1) * 60.f / N, db_mid = db_top - 30.f / N;
        const float y1 = p.y + h - i * (seg_h + gap), y0 = y1 - seg_h;
        ImU32 on = db_mid > -3.f ? hex(kAccent) : db_mid > -12.f ? hex(kWarn) : hex(kOk);
        bool lit = m.level >= db_mid;
        dl->AddRectFilled(ImVec2(p.x, y0), ImVec2(p.x + bar_w, y1), lit ? on : hex(0x1d1d21), px(2));
    }
    if (m.peak > -59.f) {                                                    // peak-hold tick
        float y = p.y + h - db_to_frac(m.peak) * h;
        dl->AddRectFilled(ImVec2(p.x - px(2), y - px(1.5f)), ImVec2(p.x + bar_w + px(2), y + px(1.5f)), hex(kText, 0.95f), px(1));
    }
    if (ruler_right) {
        const int marks[] = {0, -6, -12, -24, -36, -48};
        for (int db : marks) {
            float y = p.y + h - db_to_frac(float(db)) * h;
            char t[8]; std::snprintf(t, sizeof t, "%d", db);
            ImVec2 ts = text_size(fonts.small, t);
            float ty = std::max(p.y, std::min(p.y + h - ts.y, y - ts.y / 2));
            text_at(dl, fonts.small, ImVec2(p.x + bar_w + px(8), ty), db == 0 ? hex(kText) : hex(kFaint), t);
        }
    }
}

void meter_horizontal(const MeterState& m, float w, float h) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 p = ImGui::GetCursorScreenPos();
    ImGui::Dummy(ImVec2(w, h));
    dl->AddRectFilled(p, ImVec2(p.x + w, p.y + h), hex(0x1d1d21), h / 2);
    float f = db_to_frac(m.level);
    if (f > 0) {
        ImU32 c = m.level > -3.f ? hex(kAccent) : m.level > -12.f ? hex(kWarn) : hex(kOk);
        dl->AddRectFilled(p, ImVec2(p.x + w * f, p.y + h), c, h / 2);
    }
}

// ------------------------------------------------------------------------------------------------ fader
bool fader(const char* id, float* db, float h, unsigned color) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float w = px(40), thumb_w = px(34), thumb_h = px(16);
    ImVec2 p = ImGui::GetCursorScreenPos();
    ImGui::InvisibleButton(id, ImVec2(w, h));
    bool changed = false;
    const float travel = h - thumb_h;
    if (ImGui::IsItemActive()) {
        float f = 1.f - (ImGui::GetIO().MousePos.y - p.y - thumb_h / 2) / travel;
        float v = -60.f + clampf(f, 0.f, 1.f) * 72.f;
        if (std::fabs(v) < 1.4f) v = 0.f;                                    // detent at unity
        if (v != *db) { *db = v; changed = true; }
    }
    if (ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(0)) { *db = 0.f; changed = true; }
    if (ImGui::IsItemHovered()) {
        float wheel = ImGui::GetIO().MouseWheel;
        if (wheel != 0) { *db = clampf(*db + wheel * 1.0f, -60.f, 12.f); changed = true; }
        ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeNS);
    }
    const float cx = p.x + w / 2;
    const float frac = (clampf(*db, -60.f, 12.f) + 60.f) / 72.f;
    const float ty = p.y + travel * (1.f - frac) + thumb_h / 2;                  // thumb centre
    const float unity_y = p.y + travel * (1.f - 60.f / 72.f) + thumb_h / 2;
    dl->AddRectFilled(ImVec2(cx - px(2), p.y + thumb_h / 2), ImVec2(cx + px(2), p.y + h - thumb_h / 2), hex(0x1d1d21), px(2));
    dl->AddRectFilled(ImVec2(cx - px(2), ty), ImVec2(cx + px(2), p.y + h - thumb_h / 2), hex(color, 0.55f), px(2));
    // unity mark
    dl->AddLine(ImVec2(p.x, unity_y), ImVec2(p.x + px(6), unity_y), hex(kText, 0.85f), 1.5f);
    dl->AddLine(ImVec2(p.x + w - px(6), unity_y), ImVec2(p.x + w, unity_y), hex(kText, 0.85f), 1.5f);
    const bool hot = ImGui::IsItemActive() || ImGui::IsItemHovered();
    dl->AddRectFilled(ImVec2(cx - thumb_w / 2, ty - thumb_h / 2), ImVec2(cx + thumb_w / 2, ty + thumb_h / 2),
                      hot ? hex(0xffffff) : hex(0xe4e4e7), px(5));
    dl->AddRect(ImVec2(cx - thumb_w / 2, ty - thumb_h / 2), ImVec2(cx + thumb_w / 2, ty + thumb_h / 2), hex(0, 0.35f), px(5));
    dl->AddLine(ImVec2(cx - px(8), ty), ImVec2(cx + px(8), ty), hex(0x52525b), 1.5f);
    return changed;
}

// ------------------------------------------------------------------------------------------------ small controls
bool toggle(const char* id, bool* v) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float w = px(38), h = px(22);
    ImVec2 p = ImGui::GetCursorScreenPos();
    bool pressed = ImGui::InvisibleButton(id, ImVec2(w, h));
    if (pressed) *v = !*v;
    const bool hov = ImGui::IsItemHovered();
    dl->AddRectFilled(p, ImVec2(p.x + w, p.y + h), *v ? hex(kText) : hex(hov ? kLine2 : kMuted), h / 2);
    const float r = h / 2 - px(3);
    dl->AddCircleFilled(ImVec2(*v ? p.x + w - h / 2 : p.x + h / 2, p.y + h / 2), r, *v ? hex(kBg) : hex(kDim), 20);
    return pressed;
}

bool chip(const char* label, bool selected, float min_w) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 ts = text_size(fonts.body, label);
    const float w = std::max(min_w, ts.x + px(26)), h = px(32);
    ImVec2 p = ImGui::GetCursorScreenPos();
    bool pressed = ImGui::InvisibleButton(label, ImVec2(w, h));
    const bool hov = ImGui::IsItemHovered();
    dl->AddRectFilled(p, ImVec2(p.x + w, p.y + h), selected ? hex(kMuted) : hex(hov ? kRaised : kBg), px(8));
    dl->AddRect(p, ImVec2(p.x + w, p.y + h), hex(selected ? kLine2 : kLine), px(8));
    text_at(dl, fonts.body, ImVec2(p.x + (w - ts.x) / 2, p.y + (h - ts.y) / 2), selected ? hex(kText) : hex(kDim), label);
    return pressed;
}

bool pill_tabs(const char* const* labels, int n, int* sel, float w_each) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    const float h = px(36), pad = px(3);
    ImVec2 p = ImGui::GetCursorScreenPos();
    ImGui::Dummy(ImVec2(w_each * n + pad * 2, h));
    dl->AddRectFilled(p, ImVec2(p.x + w_each * n + pad * 2, p.y + h), hex(kRaised), px(10));
    dl->AddRect(p, ImVec2(p.x + w_each * n + pad * 2, p.y + h), hex(kLine), px(10));
    bool changed = false;
    for (int i = 0; i < n; i++) {
        ImVec2 a(p.x + pad + i * w_each, p.y + pad), b(a.x + w_each, p.y + h - pad);
        ImGui::SetCursorScreenPos(a);
        char id[24]; std::snprintf(id, sizeof id, "##tab%d", i);
        if (ImGui::InvisibleButton(id, ImVec2(w_each, b.y - a.y)) && *sel != i) { *sel = i; changed = true; }
        const bool hov = ImGui::IsItemHovered(), on = *sel == i;
        if (on) { dl->AddRectFilled(a, b, hex(kBg), px(8)); dl->AddRect(a, b, hex(kLine2), px(8)); }
        else if (hov) dl->AddRectFilled(a, b, hex(kMuted, 0.6f), px(8));
        ImFont* f = on ? fonts.semibold : fonts.body;
        ImVec2 ts = text_size(f, labels[i]);
        text_at(dl, f, ImVec2(a.x + (w_each - ts.x) / 2, a.y + (b.y - a.y - ts.y) / 2), on ? hex(kText) : hex(kDim), labels[i]);
    }
    ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + h));
    return changed;
}

static bool solid_button(const char* label, float w, float h, unsigned bg, unsigned bg_hover, unsigned fg) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 ts = text_size(fonts.semibold, label);
    if (w <= 0) w = ts.x + px(34);
    if (h <= 0) h = px(38);
    ImVec2 p = ImGui::GetCursorScreenPos();
    bool pressed = ImGui::InvisibleButton(label, ImVec2(w, h));
    const bool hov = ImGui::IsItemHovered(), act = ImGui::IsItemActive();
    const bool dis = ImGui::GetStyle().Alpha < 0.99f;
    dl->AddRectFilled(p, ImVec2(p.x + w, p.y + h), hex(act ? bg_hover : hov ? bg_hover : bg), px(9));
    text_at(dl, fonts.semibold, ImVec2(p.x + (w - ts.x) / 2, p.y + (h - ts.y) / 2), hex(fg), label);
    (void)dis;
    return pressed;
}
bool primary_button(const char* label, float w, float h) { return solid_button(label, w, h, kText, 0xd4d4d8, kBg); }
bool danger_button(const char* label, float w, float h) { return solid_button(label, w, h, 0xdc2626, 0xef4444, kText); }

bool record_button(bool recording, float size, bool enabled) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 p = ImGui::GetCursorScreenPos();
    bool pressed = ImGui::InvisibleButton("##rec", ImVec2(size, size)) && enabled;
    const bool hov = ImGui::IsItemHovered() && enabled;
    const ImVec2 c(p.x + size / 2, p.y + size / 2);
    const float t = float(ImGui::GetTime());
    const float pulse = recording ? 0.5f + 0.5f * std::sin(t * 5.f) : 0.f;
    if (recording) dl->AddCircleFilled(c, size / 2 + px(4) * pulse, hex(kAccent, 0.10f + 0.12f * pulse), 48);
    dl->AddCircle(c, size / 2 - px(1), enabled ? hex(hov || recording ? kText : kDim, 0.9f) : hex(kLine2), 48, px(2.5f));
    const unsigned col = enabled ? kAccent : 0x4b2326;
    if (recording) {
        const float s = size * 0.19f;
        dl->AddRectFilled(ImVec2(c.x - s, c.y - s), ImVec2(c.x + s, c.y + s), hex(col), px(5));
    } else {
        dl->AddCircleFilled(c, size * (hov ? 0.30f : 0.28f), hex(col), 40);
    }
    return pressed;
}

bool pad_button(const char* id, ImVec2 size, const char* key, const char* label, const char* mode_text, ImU32 color,
                float flash, bool active, bool empty, bool ducks) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 p = ImGui::GetCursorScreenPos();
    bool pressed = ImGui::InvisibleButton(id, size);
    const bool hov = ImGui::IsItemHovered(), down = ImGui::IsItemActive();
    ImVec2 q(p.x + size.x, p.y + size.y);
    const int cr = int(color & 255), cg = int((color >> 8) & 255), cb = int((color >> 16) & 255);
    auto tint = [&](float a) { return IM_COL32(cr, cg, cb, int(a * 255)); };
    ImU32 bg = hex(down ? 0x1f1f23 : hov ? 0x151518 : 0x0f0f12);
    dl->AddRectFilled(p, q, bg, px(12));
    if (!empty) {
        if (flash > 0.f || active) dl->AddRectFilled(p, q, tint(std::max(active ? 0.16f : 0.f, flash * 0.40f)), px(12));
        dl->AddRectFilled(ImVec2(p.x + px(1), p.y + size.y - px(5)), ImVec2(q.x - px(1), q.y - px(1)), tint(0.85f),
                          px(12), ImDrawFlags_RoundCornersBottom);
    }
    dl->AddRect(p, q, empty ? hex(kLine) : tint(active || flash > 0.1f ? 0.95f : hov ? 0.55f : 0.30f), px(12), 0, active ? px(2) : 1.f);
    // key chip
    ImVec2 ks = text_size(fonts.mono, key);
    const float kw = std::max(px(24), ks.x + px(14)), kh = px(24);
    ImVec2 k0(p.x + px(12), p.y + px(12));
    dl->AddRectFilled(k0, ImVec2(k0.x + kw, k0.y + kh), empty ? hex(kMuted) : tint(0.22f), px(7));
    text_at(dl, fonts.mono, ImVec2(k0.x + (kw - ks.x) / 2, k0.y + (kh - ks.y) / 2), empty ? hex(kDim) : tint(1.f), key);
    if (empty) {
        ImVec2 ts = text_size(fonts.body, "Add a sound");
        text_at(dl, fonts.body, ImVec2(p.x + (size.x - ts.x) / 2, p.y + size.y / 2 - ts.y / 2 + px(8)), hex(kFaint), "Add a sound");
        return pressed;
    }
    ImVec2 ms = text_size(fonts.small, mode_text);
    text_at(dl, fonts.small, ImVec2(q.x - px(12) - ms.x, k0.y + (kh - ms.y) / 2), hex(kDim), mode_text);
    if (ducks) {
        const char* d = "duck";
        ImVec2 ds = text_size(fonts.small, d);
        text_at(dl, fonts.small, ImVec2(q.x - px(12) - ds.x, k0.y + kh + px(4)), hex(kFaint), d);
    }
    ImGui::PushClipRect(ImVec2(p.x + px(10), p.y), ImVec2(q.x - px(10), q.y), true);
    text_at(dl, fonts.semibold, ImVec2(p.x + px(12), q.y - px(14) - text_size(fonts.semibold, label).y), hex(kText), label);
    ImGui::PopClipRect();
    return pressed;
}

// ------------------------------------------------------------------------------------------------ cards and labels
bool card_begin(const char* id, ImVec2 size, const char* title, const char* subtitle) {
    ImGui::PushStyleColor(ImGuiCol_ChildBg, hexv(0x0c0c0e));
    ImGui::PushStyleColor(ImGuiCol_Border, hexv(kLine));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(px(18), px(16)));
    ImGui::PushStyleVar(ImGuiStyleVar_ChildRounding, px(14));
    bool open = ImGui::BeginChild(id, size, ImGuiChildFlags_Borders | ImGuiChildFlags_AlwaysUseWindowPadding,
                                  ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse);
    if (open && title) {
        ImGui::PushFont(fonts.semibold);
        ImGui::TextUnformatted(title);
        ImGui::PopFont();
        if (subtitle) {
            ImGui::PushFont(fonts.small);
            ImGui::PushStyleColor(ImGuiCol_Text, hexv(kDim));
            ImGui::TextUnformatted(subtitle);
            ImGui::PopStyleColor();
            ImGui::PopFont();
        }
        ImGui::Dummy(ImVec2(0, px(2)));
    }
    return open;
}

void card_end() {
    ImGui::EndChild();
    ImGui::PopStyleVar(2);
    ImGui::PopStyleColor(2);
}

void label_dim(const char* text) {
    ImGui::PushFont(fonts.small);
    ImGui::PushStyleColor(ImGuiCol_Text, hexv(kDim));
    ImGui::TextUnformatted(text);
    ImGui::PopStyleColor();
    ImGui::PopFont();
}

void label_value(const char* label, const char* value, ImU32 value_color) {
    ImGui::PushFont(fonts.small);
    ImGui::PushStyleColor(ImGuiCol_Text, hexv(kDim));
    ImGui::TextUnformatted(label);
    ImGui::PopStyleColor();
    ImGui::PopFont();
    ImGui::PushFont(fonts.semibold);
    if (value_color) ImGui::PushStyleColor(ImGuiCol_Text, ImGui::ColorConvertU32ToFloat4(value_color));
    ImGui::TextUnformatted(value);
    if (value_color) ImGui::PopStyleColor();
    ImGui::PopFont();
}

bool slider_row(const char* label, float* v, float lo, float hi, const char* fmt, float w, const char* hint) {
    ImDrawList* dl = ImGui::GetWindowDrawList();
    ImVec2 p = ImGui::GetCursorScreenPos();
    char val[48]; std::snprintf(val, sizeof val, fmt, double(*v));
    text_at(dl, fonts.body, p, hex(kText), label);
    ImVec2 vs = text_size(fonts.mono, val);
    text_at(dl, fonts.mono, ImVec2(p.x + w - vs.x, p.y + px(1)), hex(kDim), val);
    const float lh = px(24);
    ImGui::SetCursorScreenPos(ImVec2(p.x, p.y + lh));
    const float th = px(22);
    ImVec2 q = ImGui::GetCursorScreenPos();
    ImGui::PushID(label);
    ImGui::InvisibleButton("##s", ImVec2(w, th));
    ImGui::PopID();
    bool changed = false;
    if (ImGui::IsItemActive()) {
        float f = clampf((ImGui::GetIO().MousePos.x - q.x - px(8)) / (w - px(16)), 0.f, 1.f);
        float nv = lo + f * (hi - lo);
        if (nv != *v) { *v = nv; changed = true; }
    }
    const float f = clampf((*v - lo) / (hi - lo), 0.f, 1.f);
    const float cy = q.y + th / 2, x0 = q.x + px(8), x1 = q.x + w - px(8), tx = x0 + (x1 - x0) * f;
    dl->AddRectFilled(ImVec2(x0, cy - px(2)), ImVec2(x1, cy + px(2)), hex(kMuted), px(2));
    dl->AddRectFilled(ImVec2(x0, cy - px(2)), ImVec2(tx, cy + px(2)), hex(kText), px(2));
    const bool hot = ImGui::IsItemActive() || ImGui::IsItemHovered();
    dl->AddCircleFilled(ImVec2(tx, cy), hot ? px(8.5f) : px(7.5f), hex(kText), 24);
    dl->AddCircle(ImVec2(tx, cy), hot ? px(8.5f) : px(7.5f), hex(kBg, 0.5f), 24, 1.f);
    if (hint) {
        ImGui::SetCursorScreenPos(ImVec2(q.x, q.y + th + px(2)));
        label_dim(hint);
    }
    ImGui::Dummy(ImVec2(0, px(4)));
    return changed;
}

}  // namespace ui
