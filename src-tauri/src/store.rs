use std::fs;
use std::io;
use std::path::PathBuf;

use base64::Engine;
use chrono::{DateTime, Datelike, Duration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike, Weekday};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/**
 * 笔记实体：完整的内容模型，content 与 .md 文件对应，元数据持久化到 .meta.json。
 */
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Note {
    pub id: String,
    pub content: String,
    pub is_archived: bool,
    pub pinned: bool,
    #[serde(default)]
    pub starred: bool,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/**
 * 重复规则：供待办使用，包含展示标签和 RRULE。
 */
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RepeatRule {
    pub label: String,
    pub rrule: String,
}

/**
 * 提醒配置：保存提醒时间和触达渠道。
 */
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ReminderSetting {
    pub value: String,
    #[serde(default = "ReminderSetting::default_channels")]
    pub channels: Vec<String>,
    #[serde(default)]
    pub email_sent_marker: Option<i64>,
}

impl ReminderSetting {
    fn default_channels() -> Vec<String> {
        vec!["app".to_string()]
    }
}

/**
 * 待办实体：支持完成状态、截止、提醒、重复和分类等元数据。
 */
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Todo {
    pub id: u64,
    pub title: String,
    pub completed: bool,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub starred: bool,
    #[serde(default)]
    pub category: Option<String>,
    #[serde(default)]
    pub due_date: Option<String>,
    #[serde(default, deserialize_with = "deserialize_reminders", serialize_with = "serialize_reminders")]
    pub reminders: Vec<ReminderSetting>,
    #[serde(default)]
    pub repeat: Option<RepeatRule>,
    #[serde(default)]
    pub note: String,
    #[serde(default)]
    pub is_archived: bool,
    #[serde(default)]
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/**
 * 统一条目视图：将笔记和待办合并为可排序、分页的通用结构，供前端统一列表渲染。
 */
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AllItem {
    pub item_type: String,
    pub id: String,
    pub content: String,
    pub pinned: bool,
    pub completed: bool,
    pub starred: bool,
    pub category: Option<String>,
    pub due_date: Option<String>,
    #[serde(default)]
    pub reminders: Vec<ReminderSetting>,
    pub repeat: Option<RepeatRule>,
    pub is_archived: bool,
    pub deleted_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/**
 * 应用配置：持久化到 config.json，开机自启动、全局快捷键等由前端通过 Tauri 插件管理。
 */
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct AppConfig {
    pub auto_start: bool,
    pub shortcut_toggle: String,
    pub completed_retention_days: u64,
    pub trash_retention_days: u64,
    pub home_preview_count: u64,
    pub notification_email: String,
    pub notification_phone: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        AppConfig {
            auto_start: false,
            shortcut_toggle: "Alt+X".to_string(),
            completed_retention_days: 7,
            trash_retention_days: 7,
            home_preview_count: 8,
            notification_email: String::new(),
            notification_phone: String::new(),
        }
    }
}

/**
 * 邮件系统配置：持久化到 sys-config.json，仅供后端提醒发信链路读取。
 */
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(default)]
pub struct MailConfig {
    pub email_reminder_enabled: bool,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_username: String,
    pub smtp_password: String,
    pub smtp_sender_email: String,
    pub smtp_sender_name: String,
    pub smtp_ssl: bool,
}

impl Default for MailConfig {
    fn default() -> Self {
        MailConfig {
            email_reminder_enabled: false,
            smtp_host: "smtp.yeah.net".to_string(),
            smtp_port: 465,
            smtp_username: String::new(),
            smtp_password: String::new(),
            smtp_sender_email: String::new(),
            smtp_sender_name: String::new(),
            smtp_ssl: true,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Default)]
#[serde(default)]
struct LegacyCombinedConfig {
    auto_start: bool,
    shortcut_toggle: String,
    completed_retention_days: u64,
    trash_retention_days: u64,
    home_preview_count: u64,
    notification_email: String,
    notification_phone: String,
    email_reminder_enabled: bool,
    smtp_host: String,
    smtp_port: u16,
    smtp_username: String,
    smtp_password: String,
    smtp_sender_email: String,
    smtp_sender_name: String,
    smtp_ssl: bool,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum ReminderSerde {
    Legacy(String),
    Structured(ReminderSetting),
}

fn deserialize_reminders<'de, D>(deserializer: D) -> Result<Vec<ReminderSetting>, D::Error>
where
    D: Deserializer<'de>,
{
    let values = Vec::<ReminderSerde>::deserialize(deserializer)?;
    Ok(values
        .into_iter()
        .filter_map(|item| match item {
            ReminderSerde::Legacy(value) => {
                let trimmed = value.trim();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(ReminderSetting {
                        value: trimmed.to_string(),
                        channels: ReminderSetting::default_channels(),
                        email_sent_marker: None,
                    })
                }
            }
            ReminderSerde::Structured(setting) => Some(setting),
        })
        .collect())
}

fn serialize_reminders<S>(reminders: &[ReminderSetting], serializer: S) -> Result<S::Ok, S::Error>
where
    S: Serializer,
{
    reminders.serialize(serializer)
}

/**
 * 待办 JSON 的根结构：包含递增 id 和待办列表。
 */
#[derive(Debug, Serialize, Deserialize, Default)]
struct TodosFile {
    #[serde(default)]
    todos: Vec<Todo>,
    #[serde(default)]
    next_id: u64,
}

/**
 * Store：数据存储层，持有笔记磁盘目录、图片目录、待办文件路径，并通过 Mutex 保护并发访问。
 */
pub struct Store {
    notes_dir: PathBuf,
    images_dir: PathBuf,
    todos_path: PathBuf,
    config_path: PathBuf,
    mail_config_path: PathBuf,
    todos: std::sync::Mutex<TodosFile>,
}

impl Store {
    /**
     * 初始化 Store：确保笔记目录、图片目录存在，读取或创建 todos.json。
     */
    pub fn new(app_dir: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&app_dir).ok();
        let notes_dir = app_dir.join("notes");
        let images_dir = app_dir.join("images");
        let todos_path = app_dir.join("todos.json");
        let config_path = app_dir.join("config.json");
        let mail_config_path = app_dir.join("sys-config.json");
        let legacy_mail_config_path = app_dir.join("smtp-config.json");
        fs::create_dir_all(&notes_dir).ok();
        fs::create_dir_all(&images_dir).ok();

        let todos = if todos_path.exists() {
            let text = fs::read_to_string(&todos_path)?;
            serde_json::from_str(&text).unwrap_or_default()
        } else {
            TodosFile::default()
        };

        let store = Store {
            notes_dir,
            images_dir,
            todos_path,
            config_path,
            mail_config_path,
            todos: std::sync::Mutex::new(todos),
        };

        if !store.mail_config_path.exists() && legacy_mail_config_path.exists() {
            if let Ok(text) = fs::read_to_string(&legacy_mail_config_path) {
                if let Ok(config) = serde_json::from_str::<MailConfig>(&text) {
                    let _ = store.set_mail_config(&config);
                    let _ = fs::remove_file(&legacy_mail_config_path);
                }
            }
        }

        if store.config_path.exists() && !store.mail_config_path.exists() {
            if let Some(legacy) = fs::read_to_string(&store.config_path)
                .ok()
                .and_then(|text| serde_json::from_str::<LegacyCombinedConfig>(&text).ok())
            {
                if legacy_contains_mail_fields(&legacy) {
                    let app_config = store.get_config();
                    let mail_config = store.get_mail_config();
                    let _ = store.set_mail_config(&mail_config);
                    let _ = store.set_config(&app_config);
                }
            }
        }

        store.ensure_runtime_files()?;

        Ok(store)
    }

    /**
     * 首次运行时补齐运行目录中的默认数据文件，确保安装版应用开箱即可用。
     */
    fn ensure_runtime_files(&self) -> io::Result<()> {
        if !self.todos_path.exists() {
            let text = serde_json::to_string_pretty(&TodosFile::default()).unwrap();
            fs::write(&self.todos_path, text)?;
        }
        if !self.config_path.exists() {
            let text = serde_json::to_string_pretty(&AppConfig::default()).unwrap();
            fs::write(&self.config_path, text)?;
        }
        if !self.mail_config_path.exists() {
            let text = serde_json::to_string_pretty(&MailConfig::default()).unwrap();
            fs::write(&self.mail_config_path, text)?;
        }
        Ok(())
    }

    /**
     * 将待办数据持久化写入 todos.json。
     */
    fn save_todos(&self) -> io::Result<()> {
        let todos = self.todos.lock().unwrap();
        let text = serde_json::to_string_pretty(&*todos).unwrap();
        fs::write(&self.todos_path, text)
    }

    /**
     * 返回当前 UTC+8 格式的日期时间字符串，用于时间戳统一。
     */
    fn now() -> String {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let secs_per_day: u64 = 86400;
        let days = now / secs_per_day;
        let time_within_day = now % secs_per_day;
        let h = time_within_day / 3600 + 8;
        let h = h % 24;
        let m = (time_within_day % 3600) / 60;
        let s = time_within_day % 60;

        let mut y = 1970i64;
        let mut remaining = days as i64;
        loop {
            let year_days = if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 { 366 } else { 365 };
            if remaining < year_days { break; }
            remaining -= year_days;
            y += 1;
        }
        let month_days_normal = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let month_days_leap = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        let is_leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let month_days = if is_leap { &month_days_leap } else { &month_days_normal };
        let mut mo = 1;
        for &md in month_days {
            if remaining < md as i64 { break; }
            remaining -= md as i64;
            mo += 1;
        }
        let d = remaining + 1;
        format!("{:04}-{:02}-{:02} {:02}:{:02}:{:02}", y, mo, d, h, m, s)
    }

    /**
     * 返回 UTC+8 时间戳（Unix 秒），用于过期计算。
     */
    fn timestamp_now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    /**
     * 快速构造无效输入的 IO 错误，规范和简化非法参数校验。
     */
    fn invalid_input(message: &str) -> io::Error {
        io::Error::new(io::ErrorKind::InvalidInput, message)
    }

    /**
     * 校验并清洗笔记内容：去首尾空白，检查非空和长度上限。
     */
    fn normalize_note_content(content: &str) -> io::Result<String> {
        let normalized = content.trim();
        if normalized.is_empty() {
            return Err(Self::invalid_input("note content cannot be empty"));
        }
        if normalized.chars().count() > 20000 {
            return Err(Self::invalid_input("note content exceeds 20000 characters"));
        }
        Ok(normalized.to_string())
    }

    /**
     * 校验并清洗待办标题：合并多余空白，检查非空和长度上限。
     */
    fn normalize_todo_title(title: &str) -> io::Result<String> {
        let normalized = title.split_whitespace().collect::<Vec<_>>().join(" ");
        if normalized.is_empty() {
            return Err(Self::invalid_input("todo title cannot be empty"));
        }
        if normalized.chars().count() > 200 {
            return Err(Self::invalid_input("todo title exceeds 200 characters"));
        }
        Ok(normalized)
    }

    /**
     * 标准化可选文本字段：去空白后若为空则返回 None。
     */
    fn normalize_optional_text(value: Option<String>) -> Option<String> {
        value
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
    }

    /**
     * 清洗笔记正文：去首尾空白。
     */
    fn normalize_note_body(value: String) -> String {
        value.trim().to_string()
    }

    /**
     * 标准化提醒列表：去空白、去空值、去重、排序。
     */
    fn normalize_reminders(reminders: Vec<ReminderSetting>) -> Vec<ReminderSetting> {
        let mut result: Vec<ReminderSetting> = reminders
            .into_iter()
            .filter_map(|item| {
                let value = item.value.trim().to_string();
                if value.is_empty() {
                    return None;
                }
                let channels = Self::normalize_reminder_channels(item.channels);
                Some(ReminderSetting {
                    value,
                    channels,
                    email_sent_marker: item.email_sent_marker,
                })
            })
            .collect();
        result.sort_by(|left, right| left.value.cmp(&right.value).then(left.channels.cmp(&right.channels)));
        result.dedup_by(|left, right| left.value == right.value && left.channels == right.channels);
        result
    }

    /**
     * 提醒渠道按 app/email/sms 的固定顺序归一化；app 始终保留，避免默认软件提醒被错误关闭。
     */
    fn normalize_reminder_channels(channels: Vec<String>) -> Vec<String> {
        let mut result = vec!["app".to_string()];
        for item in channels {
            let normalized = item.trim().to_lowercase();
            if matches!(normalized.as_str(), "app" | "email" | "sms") && !result.contains(&normalized) {
                result.push(normalized);
            }
        }
        result.sort_by_key(|item| match item.as_str() {
            "app" => 0,
            "email" => 1,
            "sms" => 2,
            _ => 3,
        });
        result
    }

    /**
     * 标准化重复规则：去空白并校验，无效时返回 None。
     */
    fn normalize_repeat_rule(repeat: Option<RepeatRule>) -> Option<RepeatRule> {
        let rule = repeat?;
        let label = rule.label.trim().to_string();
        let rrule = rule.rrule.trim().to_uppercase();
        if label.is_empty() || rrule.is_empty() {
            return None;
        }
        Some(RepeatRule { label, rrule })
    }

    /**
     * 标准化搜索关键字：转小写、去首尾空白，空字符串转为 None。
     */
    fn normalize_query(query: Option<&str>) -> Option<String> {
        query
            .map(|item| item.trim().to_lowercase())
            .filter(|item| !item.is_empty())
    }

    /**
     * 安全化分页参数：页数和每页大小至少为 1。
     */
    fn normalize_pagination(page: u64, page_size: u64) -> (u64, u64) {
        let safe_page = page.max(1);
        let safe_page_size = page_size.max(1);
        (safe_page, safe_page_size)
    }

    /**
     * 从磁盘读取单条笔记：合并 .meta.json 元数据与 .md 正文，缺失则返回 None。
     */
    fn read_note_file(&self, id: &str) -> Option<Note> {
        let meta_path = self.notes_dir.join(format!("{}.meta.json", id));
        let content_path = self.notes_dir.join(format!("{}.md", id));
        if !meta_path.exists() { return None; }
        let meta_text = fs::read_to_string(&meta_path).ok()?;
        let meta: NoteMeta = serde_json::from_str(&meta_text).ok()?;
        let content = fs::read_to_string(&content_path).unwrap_or_default();
        Some(Note {
            id: meta.id,
            content,
            is_archived: meta.is_archived,
            pinned: meta.pinned,
            starred: meta.starred,
            category: meta.category,
            deleted_at: meta.deleted_at,
            created_at: meta.created_at,
            updated_at: meta.updated_at,
        })
    }

    /**
     * 将笔记写入磁盘：元数据写为 .meta.json，正文写为 .md。
     */
    fn write_note_file(&self, note: &Note) -> io::Result<()> {
        let meta_path = self.notes_dir.join(format!("{}.meta.json", note.id));
        let content_path = self.notes_dir.join(format!("{}.md", note.id));
        let meta = NoteMeta {
            id: note.id.clone(),
            is_archived: note.is_archived,
            pinned: note.pinned,
            starred: note.starred,
            category: note.category.clone(),
            deleted_at: note.deleted_at.clone(),
            created_at: note.created_at.clone(),
            updated_at: note.updated_at.clone(),
        };
        let meta_text = serde_json::to_string_pretty(&meta).unwrap();
        fs::write(&meta_path, meta_text)?;
        fs::write(&content_path, &note.content)?;
        Ok(())
    }

    /**
     * 从磁盘删除单条笔记的全部关联文件。
     */
    fn delete_note_file(&self, id: &str) -> io::Result<()> {
        let meta_path = self.notes_dir.join(format!("{}.meta.json", id));
        let content_path = self.notes_dir.join(format!("{}.md", id));
        if meta_path.exists() { fs::remove_file(&meta_path).ok(); }
        if content_path.exists() { fs::remove_file(&content_path).ok(); }
        Ok(())
    }

    /**
     * 从 notes 目录扫描符合归档状态的非删除笔记，按星标、置顶、更新时间排序。
     */
    fn list_notes_from_disk(&self, archived: bool) -> Vec<Note> {
        let mut notes = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.notes_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".meta.json") {
                    let id = name.strip_suffix(".meta.json").unwrap_or("");
                    if let Some(note) = self.read_note_file(id) {
                        if note.deleted_at.is_some() { continue; }
                        if note.is_archived == archived {
                            notes.push(note);
                        }
                    }
                }
            }
        }
        notes.sort_by(|a, b| {
            b.starred.cmp(&a.starred)
                .then_with(|| b.pinned.cmp(&a.pinned))
                .then_with(|| b.updated_at.cmp(&a.updated_at))
        });
        notes
    }

    /**
     * 扫描 notes 目录中所有被标记为已删除的笔记，按更新时间倒序。
     */
    fn list_deleted_notes(&self) -> Vec<Note> {
        let mut notes = Vec::new();
        if let Ok(entries) = fs::read_dir(&self.notes_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with(".meta.json") {
                    let id = name.strip_suffix(".meta.json").unwrap_or("");
                    if let Some(note) = self.read_note_file(id) {
                        if note.deleted_at.is_some() {
                            notes.push(note);
                        }
                    }
                }
            }
        }
        notes.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        notes
    }

    // ===== Note CRUD =====

    /**
     * 创建笔记：校验内容、生成 UUID、写入磁盘文件。
     */
    pub fn create(&self, content: &str) -> io::Result<Note> {
        let normalized_content = Self::normalize_note_content(content)?;
        let id = uuid_v4();
        let now = Self::now();
        let note = Note {
            id,
            content: normalized_content,
            is_archived: false,
            pinned: false,
            starred: false,
            category: None,
            deleted_at: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.write_note_file(&note)?;
        Ok(note)
    }

    /**
     * 获取笔记：按 id 读取，不存在则返回 NotFound。
     */
    pub fn get(&self, id: &str) -> io::Result<Note> {
        self.read_note_file(id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "note not found"))
    }

    /**
     * 更新笔记：替换内容并刷新更新时间。
     */
    pub fn update(&self, id: &str, content: &str) -> io::Result<Note> {
        let mut note = self.get(id)?;
        note.content = Self::normalize_note_content(content)?;
        note.updated_at = Self::now();
        self.write_note_file(&note)?;
        Ok(note)
    }

    /**
     * 永久删除：直接删除磁盘上的笔记文件。
     */
    pub fn delete(&self, id: &str) -> io::Result<()> {
        self.delete_note_file(id)
    }

    /**
     * 设置笔记的归档状态。
     */
    pub fn set_archived(&self, id: &str, archived: bool) -> io::Result<Note> {
        let mut note = self.get(id)?;
        note.is_archived = archived;
        note.updated_at = Self::now();
        self.write_note_file(&note)?;
        Ok(note)
    }

    /**
     * 切换置顶状态：pin 取反。
     */
    pub fn toggle_pin(&self, id: &str) -> io::Result<Note> {
        let mut note = self.get(id)?;
        note.pinned = !note.pinned;
        note.updated_at = Self::now();
        self.write_note_file(&note)?;
        Ok(note)
    }

    /**
     * 切换星标：starred 取反。
     */
    pub fn toggle_star_note(&self, id: &str) -> io::Result<Note> {
        let mut note = self.get(id)?;
        note.starred = !note.starred;
        note.updated_at = Self::now();
        self.write_note_file(&note)?;
        Ok(note)
    }

    /**
     * 设置笔记分类：传递 None 可清空。
     */
    pub fn set_note_category(&self, id: &str, category: Option<String>) -> io::Result<Note> {
        let mut note = self.get(id)?;
        note.category = Self::normalize_optional_text(category);
        note.updated_at = Self::now();
        self.write_note_file(&note)?;
        Ok(note)
    }

    /**
     * 软删除笔记：设置 deleted_at 时间，不删除文件。
     */
    pub fn soft_delete_note(&self, id: &str) -> io::Result<Note> {
        let mut note = self.get(id)?;
        note.deleted_at = Some(Self::now());
        note.updated_at = Self::now();
        self.write_note_file(&note)?;
        Ok(note)
    }

    /**
     * 恢复软删除的笔记：清除 deleted_at。
     */
    pub fn restore_note(&self, id: &str) -> io::Result<Note> {
        let mut note = self.get(id)?;
        note.deleted_at = None;
        note.updated_at = Self::now();
        self.write_note_file(&note)?;
        Ok(note)
    }

    /**
     * 从磁盘永久删除笔记文件。
     */
    pub fn permanently_delete_note(&self, id: &str) -> io::Result<()> {
        self.delete_note_file(id)
    }

    /**
     * 列出笔记：返回当前归档状态下的全部非删除笔记。
     */
    pub fn list(&self, archived: bool) -> Vec<Note> {
        self.list_notes_from_disk(archived)
    }

    /**
     * 按关键字在笔记内容中搜索（大小写不敏感）。
     */
    pub fn search(&self, query: &str, archived: bool) -> Vec<Note> {
        let q = query.to_lowercase();
        let mut notes = self.list_notes_from_disk(archived);
        notes.retain(|n| n.content.to_lowercase().contains(&q));
        notes
    }

    // ===== Image storage =====

    /**
     * 保存图片：接收 base64 数据和扩展名，写入 images 目录并返回 peckx:// URL。
     */
    pub fn save_image(&self, data_base64: &str, ext: &str) -> io::Result<String> {
        // 规则：后端在写盘前再次校验扩展名并确保目录存在。
        // 原因：前端白名单只能约束当前 UI，最终落盘边界仍要在后端兜底，避免异常输入或目录缺失直接变成模糊的保存失败。
        let normalized_ext = normalize_image_extension(ext)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "unsupported image extension"))?;
        fs::create_dir_all(&self.images_dir)?;
        let id = uuid_v4();
        let filename = format!("{}.{}", id, normalized_ext);
        let filepath = self.images_dir.join(&filename);
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data_base64.trim())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "invalid base64"))?;
        fs::write(&filepath, &bytes)?;
        Ok(format!("peckx://images/{}", filename))
    }

    /**
     * 读取本地图片并返回 data URL，供前端展示层在协议不可用时回退使用。
     */
    pub fn load_image_data_url(&self, image_url: &str) -> io::Result<String> {
        let filename = extract_image_filename(image_url)
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "invalid image url"))?;
        let filepath = self.images_dir.join(&filename);
        let bytes = fs::read(&filepath)?;
        let mime = image_mime_from_filename(&filename);
        Ok(format!(
            "data:{};base64,{}",
            mime,
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }

    // ===== Todo CRUD =====

    /**
     * 创建待办：校验标题并分配递增 id，存入内存列表和磁盘。
     */
    pub fn create_todo(&self, title: &str) -> io::Result<Todo> {
        let normalized_title = Self::normalize_todo_title(title)?;
        let mut data = self.todos.lock().unwrap();
        let id = data.next_id;
        data.next_id += 1;
        let now = Self::now();
        let todo = Todo {
            id,
            title: normalized_title,
            completed: false,
            completed_at: None,
            starred: false,
            category: None,
            due_date: None,
            reminders: Vec::new(),
            repeat: None,
            note: String::new(),
            is_archived: false,
            deleted_at: None,
            created_at: now.clone(),
            updated_at: now,
        };
        data.todos.push(todo.clone());
        drop(data);
        self.save_todos()?;
        Ok(todo)
    }

    /**
     * 获取全部未删除、未归档的待办，排序规则：星标优先、未完成优先、最近更新优先。
     */
    pub fn get_todos(&self) -> Vec<Todo> {
        let data = self.todos.lock().unwrap();
        let mut todos: Vec<Todo> = data.todos.iter()
            .filter(|t| t.deleted_at.is_none() && !t.is_archived)
            .cloned()
            .collect();
        todos.sort_by(|a, b| {
            b.starred.cmp(&a.starred)
                .then_with(|| a.completed.cmp(&b.completed))
                .then_with(|| b.updated_at.cmp(&a.updated_at))
        });
        todos
    }

    /**
     * 读取单个待办快照，供提醒运行时在不暴露内部锁的前提下做精确更新。
     */
    pub fn get_todo(&self, id: u64) -> io::Result<Todo> {
        let data = self.todos.lock().unwrap();
        data.todos.iter()
            .find(|todo| todo.id == id)
            .cloned()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "todo not found"))
    }

    /**
     * 在锁定数据中查找待办的可变引用，找不到时返回 NotFound。
     */
    fn find_todo_mut<'a>(&self, data: &'a mut TodosFile, id: u64) -> io::Result<&'a mut Todo> {
        data.todos.iter_mut().find(|t| t.id == id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "todo not found"))
    }

    /**
     * 切换待办完成状态：completed 取反。
     */
    pub fn toggle_todo(&self, id: u64) -> io::Result<Todo> {
        let todo = self.get_todo(id)?;
        if todo.completed {
            self.set_todo_completed(id, false)
        } else {
            self.complete_todo_with_repeat(id)
        }
    }

    /**
     * 完成待办；若存在可解析的重复规则和截止时间，则直接推进到下一次而不是停留在已完成。
     */
    pub fn complete_todo_with_repeat(&self, id: u64) -> io::Result<Todo> {
        self.complete_todo_with_repeat_occurrences(id, 1)
    }

    /**
     * 完成待办；若提醒已聚合多个重复周期，则按遗漏次数一次性推进。
     */
    pub fn complete_todo_with_repeat_occurrences(&self, id: u64, occurrences: u32) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        let due_date = todo.due_date.clone();
        let repeat = todo.repeat.clone();
        let reminders = todo.reminders.clone();
        let repeat_steps = occurrences.max(1);

        let next_occurrence = repeat
            .as_ref()
            .and_then(|rule| due_date.as_deref().and_then(parse_due_datetime_local).and_then(|due_at| {
                let mut next_due_at = due_at;
                // 规则顺序：先按聚合出的遗漏次数逐次推进 repeat，再整体平移绝对提醒。
                // 原因：提醒聚合后一次完成必须跨过同样数量的周期，否则会立刻回放剩余 backlog。
                for _ in 0..repeat_steps {
                    next_due_at = next_due_from_repeat(next_due_at, rule)?;
                }
                Some((due_at, next_due_at))
            }));

        if let Some((current_due_at, next_due_at)) = next_occurrence {
            // 规则顺序：先按 repeat 推进新的 due_date，再基于新旧 due 的差值平移绝对提醒，最后清空完成态。
            // 这样能避免“定时@绝对时间”继续指向旧日期，或已完成状态阻断下一轮提醒调度。
            todo.due_date = Some(format_due_datetime_local(next_due_at));
            todo.reminders = shift_reminders_to_next_due(reminders, current_due_at, next_due_at);
            todo.completed = false;
            todo.completed_at = None;
        } else {
            let was_completed = todo.completed;
            todo.completed = true;
            todo.completed_at = if was_completed {
                todo.completed_at.clone()
            } else {
                Some(Self::now())
            };
        }

        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 直接设置待办完成状态，供提醒处理等需要幂等写入的场景复用，避免 toggle 误反转状态。
     */
    pub fn set_todo_completed(&self, id: u64, completed: bool) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        let was_completed = todo.completed;
        todo.completed = completed;
        // 规则：只在未完成转完成时记录时间；幂等提醒不能重置已有保留期，恢复后再完成才重新计时。
        todo.completed_at = if completed {
            if was_completed { todo.completed_at.clone() } else { Some(Self::now()) }
        } else {
            None
        };
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 更新待办标题。
     */
    pub fn update_todo(&self, id: u64, title: &str) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        todo.title = Self::normalize_todo_title(title)?;
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 切换待办星标：starred 取反。
     */
    pub fn toggle_star_todo(&self, id: u64) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        todo.starred = !todo.starred;
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 设置待办分类。
     */
    pub fn set_todo_category(&self, id: u64, category: Option<String>) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        todo.category = Self::normalize_optional_text(category);
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 设置待办截止时间。
     */
    pub fn set_todo_due_date(&self, id: u64, due_date: Option<String>) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        todo.due_date = Self::normalize_optional_text(due_date);
        // 规则顺序：先写入新的截止时间；若截止被清空，再同步清空提醒。
        // 原因：提醒调度依赖 due_date 计算触发点，保留“无截止但有提醒”会形成可保存但永不触发的错误状态。
        if todo.due_date.as_deref().map_or(true, |value| value.trim().is_empty()) {
            todo.reminders.clear();
        }
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 设置待办提醒列表。
     */
    pub fn set_todo_reminders(&self, id: u64, reminders: Vec<ReminderSetting>) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        let normalized = Self::normalize_reminders(reminders);
        // 规则：先校验截止时间，再允许写入提醒；没有截止时间时禁止保存任何提醒。
        // 原因：提醒调度依赖 due_date 计算触发点，若放行“仅提醒无截止”，会形成“看起来已设置、实际永不触发”的误导状态。
        if !normalized.is_empty() && todo.due_date.as_deref().map_or(true, |value| value.trim().is_empty()) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "请先设置截止时间，再设置提醒"));
        }
        todo.reminders = normalized;
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 标记指定提醒已成功发送邮件。
     */
    pub fn mark_reminder_email_sent(&self, id: u64, reminder_value: &str, sent_marker: i64) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        let reminder = todo
            .reminders
            .iter_mut()
            .find(|item| item.value.trim() == reminder_value.trim())
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "reminder not found"))?;
        reminder.email_sent_marker = Some(sent_marker);
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 设置待办重复规则。
     */
    pub fn set_todo_repeat(&self, id: u64, repeat: Option<RepeatRule>) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        todo.repeat = Self::normalize_repeat_rule(repeat);
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 设置待办附加笔记。
     */
    pub fn set_todo_note(&self, id: u64, note: String) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        todo.note = Self::normalize_note_body(note);
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 设置待办的归档/取消归档状态。
     */
    pub fn set_todo_archived(&self, id: u64, archived: bool) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        todo.is_archived = archived;
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 软删除待办：设置 deleted_at，保留在内存列表。
     */
    pub fn soft_delete_todo(&self, id: u64) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        todo.deleted_at = Some(Self::now());
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 恢复软删除的待办：清除 deleted_at。
     */
    pub fn restore_todo(&self, id: u64) -> io::Result<Todo> {
        let mut data = self.todos.lock().unwrap();
        let todo = self.find_todo_mut(&mut data, id)?;
        todo.deleted_at = None;
        todo.updated_at = Self::now();
        let result = todo.clone();
        drop(data);
        self.save_todos()?;
        Ok(result)
    }

    /**
     * 永久删除待办（别名：委托给 permanently_delete_todo）。
     */
    pub fn delete_todo(&self, id: u64) -> io::Result<()> {
        self.permanently_delete_todo(id)
    }

    /**
     * 从内存列表永久移除待办数据，不可恢复。
     */
    pub fn permanently_delete_todo(&self, id: u64) -> io::Result<()> {
        let mut data = self.todos.lock().unwrap();
        let idx = data.todos.iter().position(|t| t.id == id)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "todo not found"))?;
        data.todos.remove(idx);
        drop(data);
        self.save_todos()
    }

    /**
     * 获取已归档的待办列表（未删除）。
     */
    pub fn get_archived_todos(&self) -> Vec<Todo> {
        let data = self.todos.lock().unwrap();
        let mut todos: Vec<Todo> = data.todos.iter()
            .filter(|t| t.is_archived && t.deleted_at.is_none())
            .cloned()
            .collect();
        todos.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        todos
    }

    // ===== Category listing =====

    /**
     * 从活跃笔记和待办中收集去重并排序的分类列表。
     */
    pub fn get_categories(&self) -> Vec<String> {
        let mut cats = Vec::new();
        for n in self.list_notes_from_disk(false) {
            if let Some(ref cat) = n.category {
                if !cat.is_empty() && !cats.contains(cat) { cats.push(cat.clone()); }
            }
        }
        let data = self.todos.lock().unwrap();
        for t in &data.todos {
            if t.deleted_at.is_some() || t.is_archived { continue; }
            if let Some(ref cat) = t.category {
                if !cat.is_empty() && !cats.contains(cat) { cats.push(cat.clone()); }
            }
        }
        drop(data);
        cats.sort();
        cats
    }

    // ===== Trash cleanup =====

    /**
     * 清理过期垃圾桶：删除保留天数已过的笔记和待办，返回清理条数。
     */
    pub fn clean_expired_trash(&self, retention_days: u64) -> u64 {
        let now_ts = Self::timestamp_now();
        let retention_secs = retention_days * 86400;
        let mut count = 0u64;

        // Clean notes
        let deleted_notes = self.list_deleted_notes();
        for n in &deleted_notes {
            if let Some(ref dt) = n.deleted_at {
                // Parse "YYYY-MM-DD HH:MM:SS" to timestamp
                if let Ok(ts) = parse_datetime_to_ts(dt) {
                    if now_ts.saturating_sub(ts) >= retention_secs {
                        self.delete_note_file(&n.id).ok();
                        count += 1;
                    }
                }
            }
        }

        // Clean todos
        {
            let mut data = self.todos.lock().unwrap();
            let mut to_remove = Vec::new();
            for t in &data.todos {
                if let Some(ref dt) = t.deleted_at {
                    if let Ok(ts) = parse_datetime_to_ts(dt) {
                        if now_ts.saturating_sub(ts) >= retention_secs {
                            to_remove.push(t.id);
                        }
                    }
                }
            }
            data.todos.retain(|t| !to_remove.contains(&t.id));
            count += to_remove.len() as u64;
            drop(data);
            self.save_todos().ok();
        }

        count
    }

    /**
     * 将完成超过保留期的待办移入垃圾桶，返回转移数量。
     */
    pub fn move_expired_completed_todos_to_trash(&self, retention_days: u64) -> u64 {
        let now_ts = Self::timestamp_now();
        let retention_secs = retention_days.saturating_mul(86400);
        let now = Self::now();
        let mut data = self.todos.lock().unwrap();
        let mut count = 0u64;

        for todo in &mut data.todos {
            // 规则顺序：只处理活跃、未归档的完成待办；避免重复移入垃圾桶或覆盖原始删除时间。
            if !todo.completed || todo.deleted_at.is_some() || todo.is_archived {
                continue;
            }
            // 旧数据没有可信完成时刻时立即转移，避免历史完成项因无法计时而永久滞留。
            let is_expired = match todo.completed_at.as_deref() {
                Some(completed_at) => parse_datetime_to_ts(completed_at)
                    .map(|ts| now_ts.saturating_sub(ts) >= retention_secs)
                    .unwrap_or(true),
                None => true,
            };
            if is_expired {
                todo.deleted_at = Some(now.clone());
                todo.updated_at = now.clone();
                count += 1;
            }
        }
        drop(data);
        if count > 0 {
            self.save_todos().ok();
        }
        count
    }

    /**
     * 获取仍在完成保留期内的待办，支持搜索和分页。
     */
    pub fn get_completed_todos(&self, query: Option<&str>, page: u64, page_size: u64) -> (Vec<Todo>, u64) {
        let normalized_query = Self::normalize_query(query);
        let (page, page_size) = Self::normalize_pagination(page, page_size);
        let data = self.todos.lock().unwrap();
        let mut todos: Vec<Todo> = data.todos.iter()
            .filter(|todo| todo.completed && todo.deleted_at.is_none() && !todo.is_archived)
            .filter(|todo| match normalized_query.as_ref() {
                Some(query_text) => todo.title.to_lowercase().contains(query_text),
                None => true,
            })
            .cloned()
            .collect();
        drop(data);

        todos.sort_by(|left, right| {
            right.completed_at.as_deref().unwrap_or(&right.updated_at)
                .cmp(left.completed_at.as_deref().unwrap_or(&left.updated_at))
        });
        let total = todos.len() as u64;
        let start = ((page - 1) * page_size) as usize;
        let end = start + page_size as usize;
        let page_items = if start >= todos.len() {
            Vec::new()
        } else {
            todos[start..std::cmp::min(end, todos.len())].to_vec()
        };
        (page_items, total)
    }

    // ===== Combined "All" with pagination =====

    /**
     * 获取合并的笔记+待办列表：支持搜索关键字、分页，按星标和更新时间排序后截取。
     */
    pub fn get_all_items(&self, query: Option<&str>, page: u64, page_size: u64) -> (Vec<AllItem>, u64) {
        let normalized_query = Self::normalize_query(query);
        let (page, page_size) = Self::normalize_pagination(page, page_size);
        let mut items: Vec<AllItem> = Vec::new();

        let notes = self.list_notes_from_disk(false);
        for n in &notes {
            if let Some(ref query_text) = normalized_query {
                if !n.content.to_lowercase().contains(query_text) { continue; }
            }
            items.push(AllItem {
                item_type: "note".into(),
                id: n.id.clone(),
                content: n.content.clone(),
                pinned: n.pinned,
                completed: false,
                starred: n.starred,
                category: n.category.clone(),
                due_date: None,
                reminders: Vec::new(),
                repeat: None,
                is_archived: n.is_archived,
                deleted_at: n.deleted_at.clone(),
                created_at: n.created_at.clone(),
                updated_at: n.updated_at.clone(),
            });
        }

        let data = self.todos.lock().unwrap();
        for t in &data.todos {
            if t.deleted_at.is_some() || t.is_archived { continue; }
            if let Some(ref query_text) = normalized_query {
                if !t.title.to_lowercase().contains(query_text) { continue; }
            }
            items.push(AllItem {
                item_type: "todo".into(),
                id: t.id.to_string(),
                content: t.title.clone(),
                pinned: false,
                completed: t.completed,
                starred: t.starred,
                category: t.category.clone(),
                due_date: t.due_date.clone(),
                reminders: t.reminders.clone(),
                repeat: t.repeat.clone(),
                is_archived: false,
                deleted_at: None,
                created_at: t.created_at.clone(),
                updated_at: t.updated_at.clone(),
            });
        }
        drop(data);

        items.sort_by(|a, b| {
            b.starred.cmp(&a.starred)
                .then_with(|| b.updated_at.cmp(&a.updated_at))
        });

        let total = items.len() as u64;
        let start = ((page - 1) * page_size) as usize;
        let end = start + page_size as usize;
        let page_items = if start >= items.len() {
            Vec::new()
        } else {
            items[start..std::cmp::min(end, items.len())].to_vec()
        };

        (page_items, total)
    }

    /**
     * 获取已删除的笔记+待办列表（垃圾桶），支持搜索和分页。
     */
    pub fn get_trash_items(&self, query: Option<&str>, page: u64, page_size: u64) -> (Vec<AllItem>, u64) {
        let normalized_query = Self::normalize_query(query);
        let (page, page_size) = Self::normalize_pagination(page, page_size);
        let mut items: Vec<AllItem> = Vec::new();

        for n in &self.list_deleted_notes() {
            if let Some(ref query_text) = normalized_query {
                if !n.content.to_lowercase().contains(query_text) { continue; }
            }
            items.push(AllItem {
                item_type: "note".into(), id: n.id.clone(), content: n.content.clone(),
                pinned: n.pinned, completed: false, starred: n.starred,
                category: n.category.clone(), due_date: None, reminders: Vec::new(), repeat: None,
                is_archived: n.is_archived, deleted_at: n.deleted_at.clone(),
                created_at: n.created_at.clone(), updated_at: n.updated_at.clone(),
            });
        }

        {
            let data = self.todos.lock().unwrap();
            for t in &data.todos {
                if t.deleted_at.is_none() { continue; }
                if let Some(ref query_text) = normalized_query {
                    if !t.title.to_lowercase().contains(query_text) { continue; }
                }
                items.push(AllItem {
                    item_type: "todo".into(), id: t.id.to_string(), content: t.title.clone(),
                    pinned: false, completed: t.completed, starred: t.starred,
                    category: t.category.clone(), due_date: t.due_date.clone(), reminders: t.reminders.clone(),
                    repeat: t.repeat.clone(), is_archived: false,
                    deleted_at: t.deleted_at.clone(),
                    created_at: t.created_at.clone(), updated_at: t.updated_at.clone(),
                });
            }
        }

        items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        let total = items.len() as u64;
        let start = ((page - 1) * page_size) as usize;
        let end = start + page_size as usize;
        let page_items = if start >= items.len() { Vec::new() }
            else { items[start..std::cmp::min(end, items.len())].to_vec() };

        (page_items, total)
    }

    /**
     * 获取归档的笔记+待办列表，支持搜索和分页。
     */
    pub fn get_archive_items(&self, query: Option<&str>, page: u64, page_size: u64) -> (Vec<AllItem>, u64) {
        let normalized_query = Self::normalize_query(query);
        let (page, page_size) = Self::normalize_pagination(page, page_size);
        let mut items: Vec<AllItem> = Vec::new();

        let notes = self.list_notes_from_disk(true);
        for n in &notes {
            if let Some(ref query_text) = normalized_query {
                if !n.content.to_lowercase().contains(query_text) { continue; }
            }
            items.push(AllItem {
                item_type: "note".into(), id: n.id.clone(), content: n.content.clone(),
                pinned: n.pinned, completed: false, starred: n.starred,
                category: n.category.clone(), due_date: None, reminders: Vec::new(), repeat: None,
                is_archived: true, deleted_at: None,
                created_at: n.created_at.clone(), updated_at: n.updated_at.clone(),
            });
        }

        for t in &self.get_archived_todos() {
            if let Some(ref query_text) = normalized_query {
                if !t.title.to_lowercase().contains(query_text) { continue; }
            }
            items.push(AllItem {
                item_type: "todo".into(), id: t.id.to_string(), content: t.title.clone(),
                pinned: false, completed: t.completed, starred: t.starred,
                category: t.category.clone(), due_date: t.due_date.clone(), reminders: t.reminders.clone(),
                repeat: t.repeat.clone(), is_archived: true, deleted_at: None,
                created_at: t.created_at.clone(), updated_at: t.updated_at.clone(),
            });
        }

        items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

        let total = items.len() as u64;
        let start = ((page - 1) * page_size) as usize;
        let end = start + page_size as usize;
        let page_items = if start >= items.len() { Vec::new() }
            else { items[start..std::cmp::min(end, items.len())].to_vec() };

        (page_items, total)
    }

    // ===== Config =====

    /**
     * 读取配置，文件不存在时返回默认值。
     */
    pub fn get_config(&self) -> AppConfig {
        if !self.config_path.exists() {
            return AppConfig::default();
        }
        fs::read_to_string(&self.config_path)
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .map(|mut config: AppConfig| {
                config.notification_email = config.notification_email.trim().to_string();
                config.notification_phone = config.notification_phone.trim().to_string();
                config
            })
            .unwrap_or_default()
    }

    /**
    * 读取邮件系统配置；若新文件不存在，则回退读取旧版混合 config.json，确保历史配置可直接迁移使用。
     */
    pub fn get_mail_config(&self) -> MailConfig {
        if self.mail_config_path.exists() {
            return fs::read_to_string(&self.mail_config_path)
                .ok()
                .and_then(|text| serde_json::from_str(&text).ok())
                .map(normalize_mail_config)
                .unwrap_or_default();
        }

        if self.config_path.exists() {
            if let Some(legacy) = fs::read_to_string(&self.config_path)
                .ok()
                .and_then(|text| serde_json::from_str::<LegacyCombinedConfig>(&text).ok())
            {
                return normalize_mail_config(MailConfig {
                    email_reminder_enabled: legacy.email_reminder_enabled,
                    smtp_host: legacy.smtp_host,
                    smtp_port: legacy.smtp_port,
                    smtp_username: legacy.smtp_username,
                    smtp_password: legacy.smtp_password,
                    smtp_sender_email: legacy.smtp_sender_email,
                    smtp_sender_name: legacy.smtp_sender_name,
                    smtp_ssl: legacy.smtp_ssl,
                });
            }
        }

        MailConfig::default()
    }

    /**
     * 保存配置到 config.json。
     */
    pub fn set_config(&self, config: &AppConfig) -> io::Result<()> {
        let mut normalized = config.clone();
        normalized.notification_email = normalized.notification_email.trim().to_string();
        normalized.notification_phone = normalized.notification_phone.trim().to_string();
        let text = serde_json::to_string_pretty(&normalized).unwrap();
        fs::write(&self.config_path, text)
    }

    /**
    * 保存邮件系统配置到 sys-config.json。
     */
    pub fn set_mail_config(&self, config: &MailConfig) -> io::Result<()> {
        let normalized = normalize_mail_config(config.clone());
        let text = serde_json::to_string_pretty(&normalized).unwrap();
        fs::write(&self.mail_config_path, text)
    }
}

/**
 * 笔记元数据：仅持久化字段，与 .meta.json 一一对应，正文内容单独存为 .md。
 */
#[derive(Debug, Serialize, Deserialize)]
struct NoteMeta {
    id: String,
    is_archived: bool,
    pinned: bool,
    #[serde(default)]
    starred: bool,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    deleted_at: Option<String>,
    created_at: String,
    updated_at: String,
}

/**
 * 生成简易的 UUID v4 作为笔记标识，不依赖外部库。
 */
fn uuid_v4() -> String {
    let mut buf = [0u8; 16];
    for i in 0..16 {
        buf[i] = (std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .subsec_nanos()
            .wrapping_add(i as u32)
            .wrapping_mul(1103515245)
            .wrapping_add(12345)
            >> 16) as u8;
    }
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        buf[0], buf[1], buf[2], buf[3], buf[4], buf[5], buf[6], buf[7],
        buf[8], buf[9], buf[10], buf[11], buf[12], buf[13], buf[14], buf[15]
    )
}

fn normalize_mail_config(mut config: MailConfig) -> MailConfig {
    config.smtp_host = config.smtp_host.trim().to_string();
    config.smtp_username = config.smtp_username.trim().to_string();
    config.smtp_password = config.smtp_password.trim().to_string();
    config.smtp_sender_email = config.smtp_sender_email.trim().to_string();
    config.smtp_sender_name = config.smtp_sender_name.trim().to_string();
    if config.smtp_port == 0 {
        config.smtp_port = MailConfig::default().smtp_port;
    }
    config
}

fn legacy_contains_mail_fields(config: &LegacyCombinedConfig) -> bool {
    config.email_reminder_enabled
        || !config.smtp_host.trim().is_empty()
        || config.smtp_port > 0
        || !config.smtp_username.trim().is_empty()
        || !config.smtp_password.trim().is_empty()
        || !config.smtp_sender_email.trim().is_empty()
        || !config.smtp_sender_name.trim().is_empty()
        || config.smtp_ssl
}

fn normalize_image_extension(input: &str) -> Option<&'static str> {
    match input.trim().to_ascii_lowercase().as_str() {
        "png" => Some("png"),
        "jpg" | "jpeg" => Some("jpg"),
        "gif" => Some("gif"),
        "webp" => Some("webp"),
        "svg" => Some("svg"),
        "bmp" => Some("bmp"),
        _ => None,
    }
}

fn extract_image_filename(image_url: &str) -> Option<String> {
    let normalized = image_url.trim();
    let filename = if let Some(value) = normalized.strip_prefix("peckx://images/") {
        value
    } else if let Some(value) = normalized.strip_prefix("peckx://localhost/images/") {
        value
    } else {
        return None;
    };

    let ext = filename.rsplit('.').next()?;
    normalize_image_extension(ext)?;
    if filename.is_empty() || filename.contains('/') || filename.contains('\\') {
        return None;
    }
    Some(filename.to_string())
}

fn image_mime_from_filename(filename: &str) -> &'static str {
    match filename.rsplit('.').next().unwrap_or("") {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

#[derive(Default)]
struct ParsedRepeatRule {
    freq: String,
    interval: u32,
    by_days: Vec<Weekday>,
}

fn shift_reminders_to_next_due(
    reminders: Vec<ReminderSetting>,
    current_due_at: DateTime<Local>,
    next_due_at: DateTime<Local>,
) -> Vec<ReminderSetting> {
    reminders
        .into_iter()
        .map(|mut reminder| {
            if let Some(absolute_at) = parse_absolute_reminder_value(&reminder.value) {
                let offset = absolute_at.signed_duration_since(current_due_at);
                reminder.value = format_absolute_reminder_value(next_due_at + offset);
            }
            reminder
        })
        .collect()
}

fn next_due_from_repeat(base: DateTime<Local>, repeat: &RepeatRule) -> Option<DateTime<Local>> {
    let rule = parse_repeat_rule(&repeat.rrule)?;
    match rule.freq.as_str() {
        "DAILY" => Some(base + Duration::days(rule.interval as i64)),
        "WEEKLY" => next_weekly_due(base, rule.interval, &rule.by_days),
        "MONTHLY" => add_months_local(base, rule.interval),
        "YEARLY" => add_years_local(base, rule.interval),
        _ => None,
    }
}

fn parse_repeat_rule(rrule: &str) -> Option<ParsedRepeatRule> {
    let mut result = ParsedRepeatRule {
        interval: 1,
        ..ParsedRepeatRule::default()
    };

    for segment in rrule.split(';') {
        let (key, value) = segment.split_once('=')?;
        match key.trim().to_uppercase().as_str() {
            "FREQ" => result.freq = value.trim().to_uppercase(),
            "INTERVAL" => {
                result.interval = value.trim().parse::<u32>().ok().filter(|item| *item > 0).unwrap_or(1);
            }
            "BYDAY" => {
                result.by_days = value
                    .split(',')
                    .filter_map(parse_weekday_code)
                    .collect();
            }
            _ => {}
        }
    }

    if result.freq.is_empty() {
        return None;
    }
    Some(result)
}

fn next_weekly_due(base: DateTime<Local>, interval: u32, by_days: &[Weekday]) -> Option<DateTime<Local>> {
    if by_days.is_empty() {
        return Some(base + Duration::weeks(interval as i64));
    }

    let base_date = base.date_naive();
    let base_week_start = start_of_week(base_date);
    let max_scan_days = interval.max(1) as i64 * 7 + 7;

    for day_offset in 1..=max_scan_days {
        let candidate_date = base_date.checked_add_signed(Duration::days(day_offset))?;
        let candidate_week_start = start_of_week(candidate_date);
        let weeks_since_base = candidate_week_start.signed_duration_since(base_week_start).num_days() / 7;
        if weeks_since_base % interval.max(1) as i64 != 0 {
            continue;
        }
        if !by_days.contains(&candidate_date.weekday()) {
            continue;
        }
        let candidate = localize_datetime(
            candidate_date,
            base.hour(),
            base.minute(),
            base.second(),
        )?;
        if candidate > base {
            return Some(candidate);
        }
    }

    None
}

fn add_months_local(base: DateTime<Local>, months: u32) -> Option<DateTime<Local>> {
    let total_months = base.month0() + months;
    let year = base.year() + (total_months / 12) as i32;
    let month0 = total_months % 12;
    let month = month0 + 1;
    let day = base.day().min(last_day_of_month(year, month));
    localize_datetime(NaiveDate::from_ymd_opt(year, month, day)?, base.hour(), base.minute(), base.second())
}

fn add_years_local(base: DateTime<Local>, years: u32) -> Option<DateTime<Local>> {
    let year = base.year() + years as i32;
    let month = base.month();
    let day = base.day().min(last_day_of_month(year, month));
    localize_datetime(NaiveDate::from_ymd_opt(year, month, day)?, base.hour(), base.minute(), base.second())
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    for day in (28..=31).rev() {
        if NaiveDate::from_ymd_opt(year, month, day).is_some() {
            return day;
        }
    }
    28
}

fn start_of_week(date: NaiveDate) -> NaiveDate {
    date - Duration::days(date.weekday().num_days_from_monday() as i64)
}

fn parse_weekday_code(value: &str) -> Option<Weekday> {
    match value.trim().to_uppercase().as_str() {
        "MO" => Some(Weekday::Mon),
        "TU" => Some(Weekday::Tue),
        "WE" => Some(Weekday::Wed),
        "TH" => Some(Weekday::Thu),
        "FR" => Some(Weekday::Fri),
        "SA" => Some(Weekday::Sat),
        "SU" => Some(Weekday::Sun),
        _ => None,
    }
}

fn parse_due_datetime_local(value: &str) -> Option<DateTime<Local>> {
    for pattern in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(value, pattern) {
            return localize_naive_datetime(naive);
        }
    }
    None
}

fn parse_absolute_reminder_value(value: &str) -> Option<DateTime<Local>> {
    parse_due_datetime_local(value.trim().strip_prefix("定时@")?)
}

fn format_due_datetime_local(value: DateTime<Local>) -> String {
    value.format("%Y-%m-%dT%H:%M").to_string()
}

fn format_absolute_reminder_value(value: DateTime<Local>) -> String {
    format!("定时@{}", value.format("%Y-%m-%d %H:%M"))
}

fn localize_datetime(date: NaiveDate, hour: u32, minute: u32, second: u32) -> Option<DateTime<Local>> {
    localize_naive_datetime(date.and_hms_opt(hour, minute, second)?)
}

fn localize_naive_datetime(value: NaiveDateTime) -> Option<DateTime<Local>> {
    match Local.from_local_datetime(&value) {
        LocalResult::Single(date_time) => Some(date_time),
        LocalResult::Ambiguous(first, _) => Some(first),
        LocalResult::None => None,
    }
}

/**
 * 将 "YYYY-MM-DD HH:MM:SS" 格式的字符串（UTC+8）转为 Unix 时间戳，用于过期计算。
 */
fn parse_datetime_to_ts(dt: &str) -> Result<u64, ()> {
    // "YYYY-MM-DD HH:MM:SS" -> seconds since epoch (UTC+8 assumed)
    let parts: Vec<&str> = dt.split(' ').collect();
    if parts.len() != 2 { return Err(()); }
    let date_parts: Vec<&str> = parts[0].split('-').collect();
    let time_parts: Vec<&str> = parts[1].split(':').collect();
    if date_parts.len() != 3 || time_parts.len() != 3 { return Err(()); }
    let y: i64 = date_parts[0].parse().map_err(|_| ())?;
    let m: i64 = date_parts[1].parse().map_err(|_| ())?;
    let d: i64 = date_parts[2].parse().map_err(|_| ())?;
    let h: i64 = time_parts[0].parse::<i64>().map_err(|_| ())? - 8; // UTC+8 -> UTC
    let min: i64 = time_parts[1].parse().map_err(|_| ())?;
    let s: i64 = time_parts[2].parse().map_err(|_| ())?;

    let mut days = 0i64;
    for year in 1970..y {
        days += if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 { 366 } else { 365 };
    }
    let is_leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let month_days = if is_leap {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    for mo in 1..m {
        days += month_days[(mo - 1) as usize];
    }
    days += d - 1;
    Ok((days * 86400 + h * 3600 + min * 60 + s) as u64)
}
