# Poker Table — Regras ProGuard / R8
# Preserva a ponte JNI nativa entre o Kotlin/JVM e as bibliotecas C++ (libpoker-native.so, libnode.so)

-keep class com.pokertable.NodeBridge {
    native <methods>;
    *;
}

-keepclasseswithmembernames class * {
    native <methods>;
}
