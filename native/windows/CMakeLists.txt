cmake_minimum_required(VERSION 3.20)
project(PianoKeysCamera LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS OFF)

if(NOT WIN32)
    message(FATAL_ERROR "This target only builds on Windows.")
endif()

# In-proc COM server DLL
add_library(PianoKeysCamera SHARED
    PianoKeysCamera/dllmain.cpp
    PianoKeysCamera/MediaSource.cpp
    PianoKeysCamera/MediaStream.cpp
    PianoKeysCamera/FramePipeReader.cpp
    PianoKeysCamera/PianoKeysCamera.def
)
target_link_libraries(PianoKeysCamera PRIVATE
    mfplat mfuuid mf strmiids runtimeobject ole32 advapi32
)
target_compile_definitions(PianoKeysCamera PRIVATE
    _UNICODE UNICODE WIN32_LEAN_AND_MEAN NOMINMAX
)
set_target_properties(PianoKeysCamera PROPERTIES
    OUTPUT_NAME "PianoKeysCamera"
)

# Helper exe that registers the virtual camera with the OS post-install.
add_executable(PianoKeysCameraRegister
    PianoKeysCamera/Registration.cpp
    PianoKeysCamera/dllmain.cpp  # for the CLSID symbol
)
target_link_libraries(PianoKeysCameraRegister PRIVATE
    mfplat mfuuid mf mfvirtualcamera runtimeobject ole32
)
target_compile_definitions(PianoKeysCameraRegister PRIVATE
    _UNICODE UNICODE WIN32_LEAN_AND_MEAN NOMINMAX
)
