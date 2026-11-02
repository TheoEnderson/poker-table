cmake_minimum_required(VERSION 3.22.1)
project("pokertable")

# Inclui os cabeçalhos C++ do Node.js
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include/node)

# Declara a biblioteca importada libnode.so pré-compilada
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES IMPORTED_LOCATION
    ${CMAKE_CURRENT_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libnode.so)

# Compila a biblioteca de ponte JNI
add_library(poker-native SHARED native-lib.cpp)

# Vincula a ponte JNI com o libnode e as bibliotecas do sistema Android
target_link_libraries(poker-native
    node
    log
    android)
