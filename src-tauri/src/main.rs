// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Configure Glibc allocator and WebKit2GTK JavaScriptCore heap limits
    // before GTK/WebKit child processes are forked so freed image/DOM buffers
    // are immediately returned to the OS kernel instead of ballooning to 500MB+.
    #[cfg(target_os = "linux")]
    {
        for (k, v) in [
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
