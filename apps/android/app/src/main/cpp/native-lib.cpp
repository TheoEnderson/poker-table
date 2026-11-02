#include <jni.h>
#include <string>
#include <vector>
#include <pthread.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <android/log.h>

#define TAG "PokerTable:Native"
#define LOGI(...) __android_log_print(ANDROID_LOG_INFO, TAG, __VA_ARGS__)
#define LOGE(...) __android_log_print(ANDROID_LOG_ERROR, TAG, __VA_ARGS__)

namespace node {
    int Start(int argc, char* argv[]);
}

// Redirecionamento de stdout e stderr para o Android Logcat sob a tag "NodeJS"
static int pfd[2];
static pthread_t logging_thread;
static bool logging_started = false;

static void* stdout_logger(void*) {
    ssize_t rdsz;
    char buf[2048];
    while ((rdsz = read(pfd[0], buf, sizeof(buf) - 1)) > 0) {
        if (buf[rdsz - 1] == '\n') --rdsz;
        buf[rdsz] = 0;
        __android_log_print(ANDROID_LOG_INFO, "NodeJS", "%s", buf);
    }
    return nullptr;
}

static void start_redirecting_stdout() {
    if (logging_started) return;
    setvbuf(stdout, nullptr, _IOLBF, 0);
    setvbuf(stderr, nullptr, _IONBF, 0);
    if (pipe(pfd) == 0) {
        dup2(pfd[1], STDOUT_FILENO);
        dup2(pfd[1], STDERR_FILENO);
        if (pthread_create(&logging_thread, nullptr, stdout_logger, nullptr) == 0) {
            pthread_detach(logging_thread);
            logging_started = true;
        }
    }
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_pokertable_NodeBridge_changeWorkingDirectory(
    JNIEnv *env,
    jobject /* this */,
    jstring dir_path) {
    if (!dir_path) return JNI_FALSE;
    const char *path = env->GetStringUTFChars(dir_path, nullptr);
    if (!path) return JNI_FALSE;

    int res = chdir(path);
    if (res != 0) {
        LOGE("Falha ao alterar diretório de trabalho para '%s': errno=%d (%s)", path, errno, strerror(errno));
    } else {
        LOGI("Diretório de trabalho alterado com sucesso para: %s", path);
    }
    env->ReleaseStringUTFChars(dir_path, path);
    return (res == 0) ? JNI_TRUE : JNI_FALSE;
}

extern "C" JNIEXPORT jint JNICALL
Java_com_pokertable_NodeBridge_startNodeWithArguments(
    JNIEnv *env,
    jobject /* this */,
    jobjectArray arguments) {

    start_redirecting_stdout();

    int argc = env->GetArrayLength(arguments);
    std::vector<std::string> arg_strings;
    std::vector<char*> argv(argc);

    for (int i = 0; i < argc; i++) {
        auto js = (jstring)env->GetObjectArrayElement(arguments, i);
        const char *utf_str = env->GetStringUTFChars(js, nullptr);
        arg_strings.emplace_back(utf_str ? utf_str : "");
        argv[i] = const_cast<char*>(arg_strings.back().c_str());
        env->ReleaseStringUTFChars(js, utf_str);
        env->DeleteLocalRef(js);
    }

    LOGI("Iniciando Node.js runtime nativo (v24 FULL) com %d argumentos...", argc);
    for (int i = 0; i < argc; i++) {
        LOGI("  argv[%d] = %s", i, argv[i]);
    }

    // Executa o loop do Node.js (bloqueante na thread atual)
    int exit_code = node::Start(argc, argv.data());
    LOGI("Node.js runtime finalizado com código de saída: %d", exit_code);
    return exit_code;
}
