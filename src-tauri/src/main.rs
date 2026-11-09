// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Enable WebKit2GTK DMA-BUF zero-copy GPU compositing and Skia GPU painting
    // while keeping bmalloc system heap override disabled so we get full 60/120fps
    // hardware acceleration without the 240MB static WKFastMalloc reservation.
    #[cfg(target_os = "linux")]
    {
        // Ensure DMA-BUF GPU renderer is NOT disabled unless explicitly requested by user
        for (k, v) in [
            ("WebKitSystemHeapOverrideEnablement", "0"),
            ("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "0"),
            ("WEBKIT_SKIA_GPU_PAINTING_THREADS", "2"),
            ("JSC_gcMaxHeapSize", "134217728"),
        ] {
            if std::env::var_os(k).is_none() {
                std::env::set_var(k, v);
            }
        }
    }

    future_music_player_lib::run()
}
