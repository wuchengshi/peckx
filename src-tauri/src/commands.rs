use crate::store::{AppConfig, Note, ReminderSetting, RepeatRule, Todo};
use tauri::State;
use crate::store::Store;

/**
 * 将分页参数校准为最小值 1，避免非法值导致索引错误。
 */
fn normalize_pagination(page: u64, page_size: u64) -> (u64, u64) {
    (page.max(1), page_size.max(1))
}

// ===== Note commands =====

/**
 * 创建笔记：接收纯文本内容，存入 store 并返回新笔记。
 */
#[tauri::command]
pub fn create_note(store: State<Store>, content: String) -> Result<Note, String> {
    store.create(&content).map_err(|e| e.to_string())
}

/**
 * 更新笔记：按 id 替换笔记内容，返回更新后的笔记。
 */
#[tauri::command]
pub fn update_note(store: State<Store>, id: String, content: String) -> Result<Note, String> {
    store.update(&id, &content).map_err(|e| e.to_string())
}

/**
 * 永久删除笔记：按 id 从磁盘删除对应的 meta 和 md 文件。
 */
#[tauri::command]
pub fn delete_note(store: State<Store>, id: String) -> Result<(), String> {
    store.delete(&id).map_err(|e| e.to_string())
}

/**
 * 归档笔记：将指定笔记标记为已归档。
 */
#[tauri::command]
pub fn archive_note(store: State<Store>, id: String) -> Result<Note, String> {
    store.set_archived(&id, true).map_err(|e| e.to_string())
}

/**
 * 取消归档：将已归档笔记恢复到活跃列表。
 */
#[tauri::command]
pub fn unarchive_note(store: State<Store>, id: String) -> Result<Note, String> {
    store.set_archived(&id, false).map_err(|e| e.to_string())
}

/**
 * 切换置顶状态：将笔记 pin 字段取反。
 */
#[tauri::command]
pub fn toggle_pin(store: State<Store>, id: String) -> Result<Note, String> {
    store.toggle_pin(&id).map_err(|e| e.to_string())
}

/**
 * 获取笔记列表：返回全部非删除笔记，archived 参数控制是否取归档。
 */
#[tauri::command]
pub fn get_notes(store: State<Store>, archived: bool) -> Result<Vec<Note>, String> {
    Ok(store.list(archived))
}

/**
 * 搜索笔记：按关键字在内容中匹配，仅返回当前范围（活跃/归档）。
 */
#[tauri::command]
pub fn search_notes(store: State<Store>, query: String, archived: bool) -> Result<Vec<Note>, String> {
    Ok(store.search(&query, archived))
}

/**
 * 获取单条笔记：按 id 读取。
 */
#[tauri::command]
pub fn get_note(store: State<Store>, id: String) -> Result<Note, String> {
    store.get(&id).map_err(|e| e.to_string())
}

/**
 * 保存图片：接收 base64 数据，存入 images 目录并返回 peckx:// URL。
 */
#[tauri::command]
pub fn save_image(store: State<Store>, data_base64: String, ext: String) -> Result<String, String> {
    store.save_image(&data_base64, &ext).map_err(|e| e.to_string())
}

/**
 * 读取本地图片并返回 data URL，供前端展示时作为稳定回退来源。
 */
#[tauri::command]
pub fn load_image_data_url(store: State<Store>, image_url: String) -> Result<String, String> {
    store.load_image_data_url(&image_url).map_err(|e| e.to_string())
}

/**
 * 切换笔记星标：将 starred 字段取反。
 */
#[tauri::command]
pub fn toggle_star_note(store: State<Store>, id: String) -> Result<Note, String> {
    store.toggle_star_note(&id).map_err(|e| e.to_string())
}

/**
 * 设置笔记分类：更新 category 字段，传递 None 可清空。
 */
#[tauri::command]
pub fn set_note_category(store: State<Store>, id: String, category: Option<String>) -> Result<Note, String> {
    store.set_note_category(&id, category).map_err(|e| e.to_string())
}

/**
 * 软删除笔记：标记 deleted_at，数据保留在磁盘。
 */
#[tauri::command]
pub fn soft_delete_note(store: State<Store>, id: String) -> Result<Note, String> {
    store.soft_delete_note(&id).map_err(|e| e.to_string())
}

/**
 * 恢复软删除的笔记：清除 deleted_at 标记。
 */
#[tauri::command]
pub fn restore_note(store: State<Store>, id: String) -> Result<Note, String> {
    store.restore_note(&id).map_err(|e| e.to_string())
}

/**
 * 永久删除笔记：从磁盘移除全部关联文件，不可恢复。
 */
#[tauri::command]
pub fn permanently_delete_note(store: State<Store>, id: String) -> Result<(), String> {
    store.permanently_delete_note(&id).map_err(|e| e.to_string())
}

// ===== Todo commands =====

/**
 * 创建待办：接收标题，返回新创建的待办。
 */
#[tauri::command]
pub fn create_todo(store: State<Store>, title: String) -> Result<Todo, String> {
    store.create_todo(&title).map_err(|e| e.to_string())
}

/**
 * 获取待办列表：返回当前未删除、未归档的全部待办（含已完成）。
 */
#[tauri::command]
pub fn get_todos(store: State<Store>) -> Result<Vec<Todo>, String> {
    Ok(store.get_todos())
}

/**
 * 切换待办完成状态：将 completed 取反。
 */
#[tauri::command]
pub fn toggle_todo(store: State<Store>, id: u64) -> Result<Todo, String> {
    store.toggle_todo(id).map_err(|e| e.to_string())
}

/**
 * 更新待办标题。
 */
#[tauri::command]
pub fn update_todo(store: State<Store>, id: u64, title: String) -> Result<Todo, String> {
    store.update_todo(id, &title).map_err(|e| e.to_string())
}

/**
 * 永久删除待办：从内存列表移除，不可恢复（底层调用 permanently_delete_todo）。
 */
#[tauri::command]
pub fn delete_todo(store: State<Store>, id: u64) -> Result<(), String> {
    store.delete_todo(id).map_err(|e| e.to_string())
}

/**
 * 切换待办星标：将 starred 取反。
 */
#[tauri::command]
pub fn toggle_star_todo(store: State<Store>, id: u64) -> Result<Todo, String> {
    store.toggle_star_todo(id).map_err(|e| e.to_string())
}

/**
 * 设置待办分类。
 */
#[tauri::command]
pub fn set_todo_category(store: State<Store>, id: u64, category: Option<String>) -> Result<Todo, String> {
    store.set_todo_category(id, category).map_err(|e| e.to_string())
}

/**
 * 设置待办截止时间。
 */
#[tauri::command]
pub fn set_todo_due_date(store: State<Store>, id: u64, due_date: Option<String>) -> Result<Todo, String> {
    store.set_todo_due_date(id, due_date).map_err(|e| e.to_string())
}

/**
 * 设置待办提醒列表。
 */
#[tauri::command]
pub fn set_todo_reminders(store: State<Store>, id: u64, reminders: Vec<ReminderSetting>) -> Result<Todo, String> {
    store.set_todo_reminders(id, reminders).map_err(|e| e.to_string())
}

/**
 * 设置待办重复规则。
 */
#[tauri::command]
pub fn set_todo_repeat(store: State<Store>, id: u64, repeat: Option<RepeatRule>) -> Result<Todo, String> {
    store.set_todo_repeat(id, repeat).map_err(|e| e.to_string())
}

/**
 * 设置待办附加笔记（富文本长内容）。
 */
#[tauri::command]
pub fn set_todo_note(store: State<Store>, id: u64, note: String) -> Result<Todo, String> {
    store.set_todo_note(id, note).map_err(|e| e.to_string())
}

/**
 * 归档待办：标记 is_archived。
 */
#[tauri::command]
pub fn archive_todo(store: State<Store>, id: u64) -> Result<Todo, String> {
    store.set_todo_archived(id, true).map_err(|e| e.to_string())
}

/**
 * 取消归档待办：清除 is_archived 标记。
 */
#[tauri::command]
pub fn unarchive_todo(store: State<Store>, id: u64) -> Result<Todo, String> {
    store.set_todo_archived(id, false).map_err(|e| e.to_string())
}

/**
 * 软删除待办：标记 deleted_at，保留在内存列表。
 */
#[tauri::command]
pub fn soft_delete_todo(store: State<Store>, id: u64) -> Result<Todo, String> {
    store.soft_delete_todo(id).map_err(|e| e.to_string())
}

/**
 * 恢复软删除的待办：清除 deleted_at。
 */
#[tauri::command]
pub fn restore_todo(store: State<Store>, id: u64) -> Result<Todo, String> {
    store.restore_todo(id).map_err(|e| e.to_string())
}

/**
 * 永久删除待办：从内存列表移除，不可恢复。
 */
#[tauri::command]
pub fn permanently_delete_todo(store: State<Store>, id: u64) -> Result<(), String> {
    store.permanently_delete_todo(id).map_err(|e| e.to_string())
}

// ===== Combined commands =====

#[tauri::command]
pub fn get_all_items(
    store: State<Store>,
    query: Option<String>,
    page: u64,
    page_size: u64,
) -> Result<serde_json::Value, String> {
    let (page, page_size) = normalize_pagination(page, page_size);
    let (items, total) = store.get_all_items(query.as_deref(), page, page_size);
    Ok(serde_json::json!({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) / page_size.max(1),
    }))
}

#[tauri::command]
pub fn get_trash_items(
    store: State<Store>,
    query: Option<String>,
    page: u64,
    page_size: u64,
) -> Result<serde_json::Value, String> {
    let (page, page_size) = normalize_pagination(page, page_size);
    let (items, total) = store.get_trash_items(query.as_deref(), page, page_size);
    Ok(serde_json::json!({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) / page_size.max(1),
    }))
}

#[tauri::command]
pub fn get_archive_items(
    store: State<Store>,
    query: Option<String>,
    page: u64,
    page_size: u64,
) -> Result<serde_json::Value, String> {
    let (page, page_size) = normalize_pagination(page, page_size);
    let (items, total) = store.get_archive_items(query.as_deref(), page, page_size);
    Ok(serde_json::json!({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) / page_size.max(1),
    }))
}

#[tauri::command]
pub fn get_completed_todos(
    store: State<Store>,
    query: Option<String>,
    page: u64,
    page_size: u64,
) -> Result<serde_json::Value, String> {
    let (page, page_size) = normalize_pagination(page, page_size);
    let (items, total) = store.get_completed_todos(query.as_deref(), page, page_size);
    Ok(serde_json::json!({
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) / page_size.max(1),
    }))
}

#[tauri::command]
pub fn get_categories(store: State<Store>) -> Result<Vec<String>, String> {
    Ok(store.get_categories())
}

#[tauri::command]
pub fn clean_expired_trash(store: State<Store>, retention_days: u64) -> Result<u64, String> {
    Ok(store.clean_expired_trash(retention_days))
}

#[tauri::command]
pub fn move_expired_completed_todos_to_trash(store: State<Store>, retention_days: u64) -> Result<u64, String> {
    Ok(store.move_expired_completed_todos_to_trash(retention_days))
}

// ===== Config commands =====

/**
 * 获取应用配置。
 */
#[tauri::command]
pub fn get_config(store: State<Store>) -> Result<AppConfig, String> {
    Ok(store.get_config())
}

/**
 * 保存应用配置。
 */
#[tauri::command]
pub fn set_config(store: State<Store>, config: AppConfig) -> Result<(), String> {
    store.set_config(&config).map_err(|e| e.to_string())
}

/**
 * 获取开机自启动的真实状态，避免前端配置文件与系统注册状态漂移。
 */
#[tauri::command]
pub fn get_auto_start_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| e.to_string())
}

/**
 * 设置开机自启动状态，并返回系统层最终生效的状态。
 */
#[tauri::command]
pub fn set_auto_start_enabled(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;

    if enabled {
        app.autolaunch().enable().map_err(|e| e.to_string())?;
    } else {
        app.autolaunch().disable().map_err(|e| e.to_string())?;
    }

    app.autolaunch()
        .is_enabled()
        .map_err(|e| e.to_string())
}

/**
 * 更新全局快捷键并立即重注册。
 */
#[tauri::command]
pub fn set_shortcut_toggle(
    store: State<Store>,
    app: tauri::AppHandle,
    shortcut: String,
) -> Result<AppConfig, String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let mut config = store.get_config();
    let old_shortcut = normalize_shortcut(&config.shortcut_toggle);
    let next_shortcut = normalize_shortcut(&shortcut);

    if next_shortcut == old_shortcut {
        config.shortcut_toggle = next_shortcut;
        store.set_config(&config).map_err(|e| e.to_string())?;
        return Ok(config);
    }

    // 规则：先卸载旧快捷键，再尝试注册新快捷键；如果新值无效或被占用，立即回退旧值。
    // 原因：避免保存了新配置却没有可用快捷键，导致窗口无法再被全局唤起。
    app.global_shortcut().unregister_all().map_err(|e| e.to_string())?;
    if let Err(error) = app.global_shortcut().register(next_shortcut.as_str()) {
        let _ = app.global_shortcut().register(old_shortcut.as_str());
        return Err(error.to_string());
    }

    config.shortcut_toggle = next_shortcut.clone();
    if let Err(error) = store.set_config(&config) {
        let _ = app.global_shortcut().unregister_all();
        let _ = app.global_shortcut().register(old_shortcut.as_str());
        return Err(error.to_string());
    }

    Ok(config)
}

/**
 * 快捷键配置为空或仅空白时回退默认值，避免错误配置让全局快捷键完全失效。
 */
fn normalize_shortcut(shortcut: &str) -> String {
    let trimmed = shortcut.trim();
    if trimmed.is_empty() {
        "Alt+X".to_string()
    } else {
        trimmed.to_string()
    }
}
