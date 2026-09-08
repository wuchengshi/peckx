#![windows_subsystem = "windows"]

mod commands;
mod reminders;
mod store;

use crate::reminders::ReminderCenter;
use crate::store::Store;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::http::{Response, StatusCode};
use tauri::Manager;
use tauri::menu::{MenuItemBuilder, MenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

const DEFAULT_SHORTCUT: &str = "Alt+X";

/**
 * 应用入口：初始化数据目录、注册 peckx:// 图片协议、创建托盘图标与主窗口。
 */
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args(["--from-autostart"])
                .build(),
        )
        .register_asynchronous_uri_scheme_protocol("peckx", move |app, request, responder| {
            let images_dir = resolve_runtime_data_dir(app.app_handle()).join("images");
            let uri = request.uri();
            let host = uri.host().unwrap_or("");
            let path = uri.path();

            let filename = match host {
                // 新格式：peckx://images/<filename>
                "images" => path.trim_start_matches('/'),
                // 兼容旧格式：peckx://localhost/images/<filename>
                _ => path.trim_start_matches("/images/"),
            };

            if filename.is_empty() {
                let resp = Response::builder()
                    .status(StatusCode::NOT_FOUND)
                    .body(Vec::new())
                    .unwrap();
                responder.respond(resp);
                return;
            }

            let filepath = images_dir.join(filename);
            match fs::read(&filepath) {
                Ok(data) => {
                    let mime = mime_guess(filename);
                    let resp = Response::builder()
                        .status(StatusCode::OK)
                        .header("Content-Type", mime)
                        .body(data)
                        .unwrap();
                    responder.respond(resp);
                }
                Err(_) => {
                    let resp = Response::builder()
                        .status(StatusCode::NOT_FOUND)
                        .body(Vec::new())
                        .unwrap();
                    responder.respond(resp);
                }
            }
        })
        .setup(move |app| {
            use tauri_plugin_global_shortcut::ShortcutState;

            let app_dir = resolve_runtime_data_dir(app.handle());
            let images_dir = app_dir.join("images");
            std::fs::create_dir_all(&images_dir).ok();
            let store = Store::new(app_dir.clone()).expect("Failed to initialize store");
            app.manage(store);
            app.manage(ReminderCenter::default());

            let shortcut = current_shortcut(app.handle());
            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_shortcuts([shortcut.as_str()])?
                    .with_handler(|app, _shortcut, event| {
                        if event.state == ShortcutState::Pressed {
                            toggle_main_window(app);
                        }
                    })
                    .build(),
            )?;

            // 托盘右键菜单
            let config_item = MenuItemBuilder::with_id("config", "配置").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "退出").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&config_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("peck-x")
                .menu(&tray_menu)
                // 左键由自定义事件恢复主窗口，菜单仅保留给右键操作，避免出现菜单闪烁。
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id() == "config" {
                        if let Some(window) = show_main_window(app) {
                            let _ = window.eval("window.__openConfig?.()");
                        }
                    } else if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let _ = show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let window = app.get_webview_window("main").unwrap();
            let window_clone = window.clone();
            window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window_clone.hide();
                }
            });
            reminders::start_scheduler(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_note,
            commands::update_note,
            commands::delete_note,
            commands::archive_note,
            commands::unarchive_note,
            commands::toggle_pin,
            commands::get_notes,
            commands::search_notes,
            commands::get_note,
            commands::save_image,
            commands::load_image_data_url,
            commands::toggle_star_note,
            commands::set_note_category,
            commands::soft_delete_note,
            commands::restore_note,
            commands::permanently_delete_note,
            commands::create_todo,
            commands::get_todos,
            commands::toggle_todo,
            commands::update_todo,
            commands::delete_todo,
            commands::toggle_star_todo,
            commands::set_todo_category,
            commands::set_todo_due_date,
            commands::set_todo_reminders,
            commands::set_todo_repeat,
            commands::set_todo_note,
            commands::archive_todo,
            commands::unarchive_todo,
            commands::soft_delete_todo,
            commands::restore_todo,
            commands::permanently_delete_todo,
            commands::get_all_items,
            commands::get_trash_items,
            commands::get_archive_items,
            commands::get_completed_todos,
            commands::get_categories,
            commands::clean_expired_trash,
            commands::move_expired_completed_todos_to_trash,
            commands::get_config,
            commands::set_config,
            commands::get_auto_start_enabled,
            commands::set_auto_start_enabled,
            commands::set_shortcut_toggle,
            reminders::send_test_email,
            reminders::get_active_reminders,
            reminders::get_reminder_slot,
            reminders::handle_reminder_action,
            reminders::open_active_reminder_target,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/**
 * 解析运行期数据目录：安装版固定使用系统用户数据目录，避免把用户数据写入安装目录。
 */
fn resolve_runtime_data_dir(app: &AppHandle) -> PathBuf {
    // 规则：安装目录只放程序文件；用户配置、待办和图片统一放系统 app data。
    // 原因：这样用户可自由选择安装路径，而不会因为 Program Files 等目录权限导致运行期写入失败。
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| legacy_runtime_data_dir())
}

fn legacy_runtime_data_dir() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));
    exe_dir.join("peckxData")
}

/**
 * 恢复、显示并聚焦主窗口：同时覆盖被关闭后隐藏到托盘和最小化到任务栏两种状态。
 */
fn show_main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let window = app.get_webview_window("main")?;
    // 恢复顺序：先取消最小化，再显示、置顶并聚焦。
    // 原因：Alt+X 以“是否置顶”作为切换依据；显示分支必须保持置顶，下一次快捷键才能稳定走最小化分支。
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    Some(window)
}

/**
 * 读取当前配置中的快捷键，空值时回退默认值。
 */
fn current_shortcut(app: &AppHandle) -> String {
    app.try_state::<Store>()
        .map(|store| normalize_shortcut(&store.get_config().shortcut_toggle))
        .unwrap_or_else(|| DEFAULT_SHORTCUT.to_string())
}

/**
 * 切换主窗口显示状态，供托盘快捷键复用。
 */
fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_always_on_top().unwrap_or(false) {
            let _ = window.set_always_on_top(false);
            let _ = window.minimize();
        } else {
            let _ = show_main_window(app);
        }
    }
}

/**
 * 快捷键配置为空或仅空白时回退默认值，避免错误配置让全局快捷键完全失效。
 */
fn normalize_shortcut(shortcut: &str) -> String {
    let trimmed = shortcut.trim();
    if trimmed.is_empty() {
        DEFAULT_SHORTCUT.to_string()
    } else {
        trimmed.to_string()
    }
}

/**
 * 根据文件扩展名猜测 MIME 类型，用于图片协议响应。
 */
fn mime_guess(filename: &str) -> String {
    let ext = filename.rsplit('.').next().unwrap_or("");
    match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }.into()
}
