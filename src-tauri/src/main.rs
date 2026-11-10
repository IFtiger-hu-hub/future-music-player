// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Enable WebKit2GTK DMA-BUF zero-copy GPU compositing and Skia GPU painting
    // while keeping bmalloc system heap override disabled so we get full 60/120fps
    // hardware acceleration without the 240MB static WKFastMalloc reservation.
    #[cfg(target_os = "linux")]
    {
        // Ensure DMA-BUF GPU renderer and hardware compositing mode are never disabled
        std::env::remove_var("WEBKIT_DISABLE_DMABUF_RENDERER");
        std::env::remove_var("WEBKIT_DISABLE_COMPOSITING_MODE");
        for (k, v) in [
            ("WEBKIT_SKIA_ENABLE_CPU_RENDERING", "0"),
            ("WEBKIT_SKIA_GPU_PAINTING_THREADS", "4"),
        ] {
            if std::env::var_os(k).is_none() {
                std::env::set_var(k, v);
            }
        }
    }

    future_music_player_lib::run()
}
