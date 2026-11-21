cmake_minimum_required(VERSION 3.20)
project(PodStudioNative LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

if(MSVC)                                              # one static C runtime for everything: a single self-contained .exe
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

include(FetchContent)
set(FETCHCONTENT_QUIET OFF)
# Dependencies are pinned. Set FETCHCONTENT_SOURCE_DIR_<NAME> to use a local checkout instead of downloading.
FetchContent_Declare(json     GIT_REPOSITORY https://github.com/nlohmann/json.git     GIT_TAG v3.11.3 GIT_SHALLOW ON)
FetchContent_Declare(imgui    GIT_REPOSITORY https://github.com/ocornut/imgui.git      GIT_TAG v1.91.9 GIT_SHALLOW ON)
FetchContent_Declare(miniaudio GIT_REPOSITORY https://github.com/mackron/miniaudio.git GIT_TAG 0.11.22 GIT_SHALLOW ON)
set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_MakeAvailable(json imgui miniaudio)

# ---- core: no operating-system code, tested on every platform
add_library(pscore STATIC core/audio.cpp core/dsp.cpp core/project.cpp core/render.cpp core/podmic.cpp core/recovery.cpp)
target_link_libraries(pscore PUBLIC nlohmann_json::nlohmann_json)
target_include_directories(pscore PUBLIC core)

enable_testing()
add_executable(core_tests tests/core_tests.cpp)
target_link_libraries(core_tests PRIVATE pscore)
add_test(NAME core_tests COMMAND core_tests ${CMAKE_BINARY_DIR}/reference)

# ---- the app
option(PODSTUDIO_BUILD_APP "Build the PodStudio application" ON)
if(PODSTUDIO_BUILD_APP)
  add_library(imgui_lib STATIC
    ${imgui_SOURCE_DIR}/imgui.cpp ${imgui_SOURCE_DIR}/imgui_draw.cpp ${imgui_SOURCE_DIR}/imgui_tables.cpp
    ${imgui_SOURCE_DIR}/imgui_widgets.cpp ${imgui_SOURCE_DIR}/misc/cpp/imgui_stdlib.cpp)
  target_include_directories(imgui_lib PUBLIC ${imgui_SOURCE_DIR} ${imgui_SOURCE_DIR}/misc/cpp)

  set(APP_SOURCES app/app.cpp app/engine.cpp app/theme.cpp app/widgets.cpp app/denoise.cpp
      app/page_session.cpp app/page_mic.cpp app/page_mix.cpp app/page_recordings.cpp app/page_script.cpp)
  if(WIN32)
    list(APPEND APP_SOURCES app/mp3_win32.cpp app/micctl_win32.cpp)
  else()
    list(APPEND APP_SOURCES app/mp3_stub.cpp app/micctl_demo.cpp)
  endif()

  if(WIN32)
    add_executable(PodStudio WIN32 ${APP_SOURCES} app/platform_win32.cpp app/main_win32.cpp app/podstudio.rc
      ${imgui_SOURCE_DIR}/backends/imgui_impl_win32.cpp ${imgui_SOURCE_DIR}/backends/imgui_impl_dx11.cpp)
    target_link_libraries(PodStudio PRIVATE d3d11 dxgi d3dcompiler dwmapi ole32 comdlg32 shell32 user32 gdi32 uuid mfplat mfreadwrite mfuuid setupapi hid)
    if(MSVC)
      target_link_options(PodStudio PRIVATE /MANIFEST:NO)                              # the manifest is embedded by podstudio.rc
      target_compile_definitions(PodStudio PRIVATE _CRT_SECURE_NO_WARNINGS NOMINMAX UNICODE _UNICODE)
      target_compile_options(PodStudio PRIVATE /utf-8 /W3)
    else()
      target_link_options(PodStudio PRIVATE -static -mwindows -municode)
    endif()
  else()
    find_package(OpenGL REQUIRED)
    find_package(glfw3 REQUIRED)
    find_package(Threads REQUIRED)
    add_executable(PodStudioPreview ${APP_SOURCES} app/platform_posix.cpp app/main_glfw.cpp
      ${imgui_SOURCE_DIR}/backends/imgui_impl_glfw.cpp ${imgui_SOURCE_DIR}/backends/imgui_impl_opengl3.cpp)
    target_link_libraries(PodStudioPreview PRIVATE glfw OpenGL::GL Threads::Threads ${CMAKE_DL_LIBS})
    add_executable(engine_tests tests/engine_tests.cpp app/engine.cpp)
    target_link_libraries(engine_tests PRIVATE pscore Threads::Threads ${CMAKE_DL_LIBS})
    target_include_directories(engine_tests PRIVATE ${miniaudio_SOURCE_DIR})
    add_test(NAME engine_tests COMMAND engine_tests ${CMAKE_BINARY_DIR})
    set(PS_APP PodStudioPreview)
  endif()
  foreach(t ${PS_APP} PodStudio)
    if(TARGET ${t})
      target_link_libraries(${t} PRIVATE pscore imgui_lib)
      target_include_directories(${t} PRIVATE ${miniaudio_SOURCE_DIR} ${imgui_SOURCE_DIR}/backends)
      if(NOT MSVC)
        target_compile_options(${t} PRIVATE -Wall -Wextra -Wno-unused-parameter)
      endif()
    endif()
  endforeach()
endif()
