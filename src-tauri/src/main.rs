// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Configure WebKit2GTK bmalloc override, DMABUF/Skia thread limits, and Glibc
    // allocator before GTK/WebKit child processes are forked so WebKitWebProcess
    // does not hoard 240MB+ in WKFastMalloc or spawn 8 Skia + dual GPU driver stacks.
    #[cfg(target_os = "linux")]
    {
        for (k, v) in [
            ("WebKitSystemHeapOverrideEnablement", "0"),
            ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
            ("WEBKIT_SKIA_CPU_PAINTING_THREADS", "1"),
            ("WEBKIT_SKIA_GPU_PAINTING_THREADS", "0"),
            ("MALLOC_TRIM_THRESHOLD_", "65536"),
            ("MALLOC_MMAP_THRESHOLD_", "65536"),
            ("JSC_gcMaxHeapSize", "33554432"),
            ("JSC_smallHeapRAMFraction", "0.04"),
            ("JSC_mediumHeapRAMFraction", "0.08"),
        ] {
            if std::env::var_os(k).is_none() {
                std::env::set_var(k, v);
            }
        }
    }

    future_music_player_lib::run()
}
