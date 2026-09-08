use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::Mutex;
use std::time::Duration;

use chrono::{DateTime, Datelike, Duration as ChronoDuration, Local, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Timelike, Weekday};
use lettre::message::Mailbox;
use lettre::transport::smtp::authentication::Credentials;
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{Message, SmtpTransport, Transport};
use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, Position, State, WebviewUrl, WebviewWindowBuilder};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::RECT;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETWORKAREA, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS};

use crate::store::{AppConfig, MailConfig, ReminderSetting, RepeatRule, Store, Todo};

const REMINDER_WINDOW_LABEL: &str = "reminder-window";
const REMINDER_VISIBLE_COUNT: usize = 3;
const REMINDER_WINDOW_WIDTH: i32 = 404;
const REMINDER_WINDOW_HEIGHT: i32 = 344;
const REMINDER_WINDOW_MARGIN_X: i32 = 16;
const REMINDER_WINDOW_MARGIN_Y: i32 = 16;
const EMAIL_RETRY_DELAYS_SECS: [i64; 3] = [60, 300, 900];

#[derive(Debug, Clone, Serialize)]
pub struct ReminderPayload {
    pub alert_id: String,
    pub todo_id: u64,
    pub title: String,
    pub category: String,
    pub due_date: String,
    pub due_label: String,
    pub reminder_value: String,
    pub trigger_label: String,
    pub missed_count: usize,
    pub extra_count: usize,
}

#[derive(Default)]
pub struct ReminderCenter {
    runtime: Mutex<ReminderRuntime>,
}

#[derive(Default)]
struct ReminderRuntime {
    visible: Vec<ReminderAlert>,
    queue: VecDeque<ReminderAlert>,
    entries: HashMap<String, ReminderEntryState>,
}

#[derive(Default)]
struct ReminderEntryState {
    last_base_trigger: Option<i64>,
    snoozed_until: Option<i64>,
    handled_marker: Option<i64>,
    email_retry_count: usize,
    email_retry_after: Option<i64>,
    email_retry_exhausted: bool,
}

#[derive(Debug, Clone)]
struct ReminderAlert {
    alert_id: String,
    entry_key: String,
    todo_id: u64,
    title: String,
    category: String,
    due_date: String,
    due_label: String,
    reminder_value: String,
    trigger_label: String,
    missed_count: usize,
    occurrence_marker: i64,
}

struct ReminderOccurrence {
    due_at: DateTime<Local>,
    trigger_at: DateTime<Local>,
    missed_count: usize,
}

#[derive(Default)]
struct ParsedRepeatRule {
    freq: String,
    interval: u32,
    by_days: Vec<Weekday>,
}

struct EmailDispatch {
    entry_key: String,
    todo_id: u64,
    reminder_value: String,
    base_marker: i64,
    title: String,
    category: String,
    due_label: String,
    trigger_label: String,
}

impl ReminderCenter {
    pub fn sync_due_reminders(&self, todos: &[Todo]) -> bool {
        let now_ms = Local::now().timestamp_millis();
        let mut runtime = self.runtime.lock().unwrap();
        let before = reminder_snapshot(&runtime);
        let mut active_keys = HashSet::new();
        let mut valid_alert_ids = HashSet::new();
        let queued_alert_ids: HashSet<String> = runtime.queue.iter().map(|item| item.alert_id.clone()).collect();
        let visible_alert_ids: HashSet<String> = runtime.visible.iter().map(|item| item.alert_id.clone()).collect();
        let mut new_alerts = Vec::new();

        // 规则顺序：先过滤不可提醒条目，再按当前 due/reminder 计算基准触发时间，最后套用 snooze/handled。
        // 这样能避免 due_date 或提醒规则变更后继续复用旧的暂缓状态，导致旧提醒被错误继承。
        for todo in todos {
            if todo.completed || todo.deleted_at.is_some() || todo.is_archived {
                continue;
            }
            for reminder in todo.reminders.iter().filter(reminder_supports_app) {
                let Some(occurrence) = resolve_due_occurrence(todo, reminder, now_ms) else {
                    continue;
                };
                let entry_key = build_entry_key(todo.id, &reminder.value);
                active_keys.insert(entry_key.clone());
                let entry = runtime.entries.entry(entry_key.clone()).or_default();
                let base_marker = occurrence.trigger_at.timestamp_millis();
                if entry.last_base_trigger != Some(base_marker) {
                    entry.last_base_trigger = Some(base_marker);
                    entry.snoozed_until = None;
                    entry.handled_marker = None;
                    entry.email_retry_count = 0;
                    entry.email_retry_after = None;
                    entry.email_retry_exhausted = false;
                }
                let occurrence_marker = entry.snoozed_until.unwrap_or(base_marker);
                if occurrence_marker > now_ms || entry.handled_marker == Some(occurrence_marker) {
                    continue;
                }
                let alert_id = build_alert_id(&entry_key, occurrence_marker);
                valid_alert_ids.insert(alert_id.clone());
                if visible_alert_ids.contains(&alert_id) || queued_alert_ids.contains(&alert_id) {
                    continue;
                }
                new_alerts.push(ReminderAlert {
                    alert_id,
                    entry_key,
                    todo_id: todo.id,
                    title: todo.title.clone(),
                    category: todo.category.clone().unwrap_or_else(|| "待办".to_string()),
                    due_date: occurrence.due_at.format("%Y-%m-%dT%H:%M").to_string(),
                    due_label: occurrence.due_at.format("%m-%d %H:%M").to_string(),
                    reminder_value: reminder.value.clone(),
                    trigger_label: timestamp_to_label(occurrence_marker),
                    missed_count: occurrence.missed_count,
                    occurrence_marker,
                });
            }
        }

        runtime.entries.retain(|key, _| active_keys.contains(key));
        runtime.visible.retain(|item| valid_alert_ids.contains(&item.alert_id));
        runtime.queue.retain(|item| valid_alert_ids.contains(&item.alert_id));
        new_alerts.sort_by(|left, right| {
            left.occurrence_marker
                .cmp(&right.occurrence_marker)
                .then_with(|| left.todo_id.cmp(&right.todo_id))
        });
        for alert in new_alerts {
            runtime.queue.push_back(alert);
        }
        ensure_visible_alerts(&mut runtime);
        let changed = reminder_snapshot(&runtime) != before;
        drop(runtime);
        changed
    }

    pub fn payload_for_slot(&self, slot_index: usize) -> Option<ReminderPayload> {
        let runtime = self.runtime.lock().unwrap();
        let extra_count = runtime.queue.len();
        runtime.visible.get(slot_index).map(|item| item.to_payload(if slot_index == 0 { extra_count } else { 0 }))
    }

    pub fn active_payloads(&self) -> Vec<ReminderPayload> {
        let runtime = self.runtime.lock().unwrap();
        let total = runtime.visible.len() + runtime.queue.len();
        // 顺序规则：先返回当前 visible，再返回 queue，保证前端导航顺序与后端触发顺序一致。
        // 这样可以避免卡片切换后 alert_id 和实际待处理提醒错位，导致操作落到错误条目上。
        runtime
            .visible
            .iter()
            .chain(runtime.queue.iter())
            .enumerate()
            .map(|(index, item)| item.to_payload(total.saturating_sub(index + 1)))
            .collect()
    }

    pub fn handle_action(&self, alert_id: &str, action: ReminderAction) -> Option<u64> {
        let mut runtime = self.runtime.lock().unwrap();
        let active = take_alert(&mut runtime, alert_id)?;
        let entry = runtime.entries.entry(active.entry_key.clone()).or_default();
        match action {
            ReminderAction::IgnoreCurrent => {
                entry.handled_marker = Some(active.occurrence_marker);
            }
            ReminderAction::Complete => {
                entry.snoozed_until = None;
                entry.handled_marker = Some(active.occurrence_marker);
            }
        }
        let todo_id = active.todo_id;
        ensure_visible_alerts(&mut runtime);
        Some(todo_id)
    }

    pub fn todo_id_for_alert(&self, alert_id: &str) -> Option<u64> {
        let runtime = self.runtime.lock().unwrap();
        find_alert(&runtime, alert_id).map(|item| item.todo_id)
    }

    fn alert_for_id(&self, alert_id: &str) -> Option<ReminderAlert> {
        let runtime = self.runtime.lock().unwrap();
        find_alert(&runtime, alert_id).cloned()
    }

    pub fn dispatch_due_emails(&self, store: &Store, todos: &[Todo]) {
        let user_config = store.get_config();
        let mail_config = store.get_mail_config();
        if !email_config_is_ready(&user_config, &mail_config) {
            return;
        }

        let now_ms = Local::now().timestamp_millis();
        let mut pending = Vec::new();
        {
            let mut runtime = self.runtime.lock().unwrap();
            for todo in todos {
                if todo.completed || todo.deleted_at.is_some() || todo.is_archived {
                    continue;
                }
                let Some(due_date) = todo.due_date.as_deref() else {
                    continue;
                };
                let Some(due_at) = parse_due_date(due_date) else {
                    continue;
                };
                for reminder in todo.reminders.iter().filter(reminder_supports_email) {
                    let Some(base_trigger) = compute_trigger_at(due_at, reminder) else {
                        continue;
                    };
                    let base_marker = base_trigger.timestamp_millis();
                    let entry_key = build_entry_key(todo.id, &reminder.value);
                    let entry = runtime.entries.entry(entry_key.clone()).or_default();
                    if entry.last_base_trigger != Some(base_marker) {
                        entry.last_base_trigger = Some(base_marker);
                        entry.email_retry_count = 0;
                        entry.email_retry_after = None;
                        entry.email_retry_exhausted = false;
                    }
                    if base_marker > now_ms || reminder.email_sent_marker == Some(base_marker) || entry.email_retry_exhausted {
                        continue;
                    }
                    if entry.email_retry_after.is_some_and(|retry_at| retry_at > now_ms) {
                        continue;
                    }
                    pending.push(EmailDispatch {
                        entry_key,
                        todo_id: todo.id,
                        reminder_value: reminder.value.clone(),
                        base_marker,
                        title: todo.title.clone(),
                        category: todo.category.clone().unwrap_or_else(|| "待办".to_string()),
                        due_label: due_at.format("%m-%d %H:%M").to_string(),
                        trigger_label: timestamp_to_label(base_marker),
                    });
                }
            }
        }

        for item in pending {
            match send_email_notification(&user_config, &mail_config, &item) {
                Ok(()) => {
                    if let Err(error) = store.mark_reminder_email_sent(item.todo_id, &item.reminder_value, item.base_marker) {
                        eprintln!("failed to persist email sent marker: {error}");
                    }
                    let mut runtime = self.runtime.lock().unwrap();
                    if let Some(entry) = runtime.entries.get_mut(&item.entry_key) {
                        entry.email_retry_count = 0;
                        entry.email_retry_after = None;
                        entry.email_retry_exhausted = false;
                    }
                }
                Err(error) => {
                    eprintln!("failed to send reminder email: {error}");
                    let mut runtime = self.runtime.lock().unwrap();
                    if let Some(entry) = runtime.entries.get_mut(&item.entry_key) {
                        schedule_email_retry(entry, item.base_marker, now_ms, is_permanent_email_error(&error));
                    }
                }
            }
        }
    }
}

impl ReminderAlert {
    fn to_payload(&self, extra_count: usize) -> ReminderPayload {
        ReminderPayload {
            alert_id: self.alert_id.clone(),
            todo_id: self.todo_id,
            title: self.title.clone(),
            category: self.category.clone(),
            due_date: self.due_date.clone(),
            due_label: self.due_label.clone(),
            reminder_value: self.reminder_value.clone(),
            trigger_label: self.trigger_label.clone(),
            missed_count: self.missed_count,
            extra_count,
        }
    }
}

pub enum ReminderAction {
    Complete,
    IgnoreCurrent,
}

pub fn start_scheduler(app: AppHandle) {
    std::thread::spawn(move || loop {
        if let Some(store) = app.try_state::<Store>() {
            if let Some(center) = app.try_state::<ReminderCenter>() {
                let todos = store.get_todos();
                let changed = center.sync_due_reminders(&todos);
                center.dispatch_due_emails(&store, &todos);
                if changed {
                    sync_reminder_window(&app);
                }
            }
        }
        std::thread::sleep(Duration::from_secs(15));
    });
}

#[tauri::command]
pub fn get_reminder_slot(center: State<ReminderCenter>, slot_index: usize) -> Option<ReminderPayload> {
    center.payload_for_slot(slot_index)
}

#[tauri::command]
pub fn get_active_reminders(center: State<ReminderCenter>) -> Vec<ReminderPayload> {
    center.active_payloads()
}

#[tauri::command]
pub fn send_test_email(store: State<Store>) -> Result<String, String> {
    let user_config = store.get_config();
    let mail_config = store.get_mail_config();
    validate_email_config(&user_config, &mail_config)?;
    let item = EmailDispatch {
        entry_key: "test-email".to_string(),
        todo_id: 0,
        reminder_value: "测试邮件".to_string(),
        base_marker: Local::now().timestamp_millis(),
        title: "peck-x 邮件通知服务测试".to_string(),
        category: "测试".to_string(),
        due_label: "用于验证".to_string(),
        trigger_label: Local::now().format("%m-%d %H:%M").to_string(),
    };
    send_test_email_notification(&user_config, &mail_config, &item)?;
    Ok(format!("测试邮件已发送到 {}", user_config.notification_email.trim()))
}

#[tauri::command]
pub fn handle_reminder_action(
    app: AppHandle,
    store: State<Store>,
    center: State<ReminderCenter>,
    alert_id: String,
    action: String,
    snooze_minutes: Option<u64>,
) -> Result<(), String> {
    let normalized_action = String::from(action.trim());
    let mut should_resync = false;
    let todo_id = match normalized_action.as_str() {
        "complete" => {
            let active = center.alert_for_id(&alert_id).ok_or_else(|| "当前没有活动提醒".to_string())?;
            store
                .complete_todo_with_repeat_occurrences(active.todo_id, active.missed_count.max(1) as u32)
                .map_err(|error| error.to_string())?;
            center.handle_action(&alert_id, ReminderAction::Complete);
            should_resync = true;
            Some(active.todo_id)
        }
        "ignore" => center.handle_action(&alert_id, ReminderAction::IgnoreCurrent),
        "snooze" => {
            let minutes = snooze_minutes.ok_or_else(|| "缺少稍后提醒时长".to_string())?;
            if minutes == 0 {
                return Err("稍后提醒时长必须大于 0".to_string());
            }
            let active = center.alert_for_id(&alert_id).ok_or_else(|| "当前没有活动提醒".to_string())?;
            let todo = store.get_todo(active.todo_id).map_err(|error| error.to_string())?;
            let next_trigger_at = Local::now() + chrono::Duration::minutes(minutes as i64);
            let updated_reminders = replace_active_reminder_value(
                todo.reminders,
                &active.reminder_value,
                format_absolute_reminder_value(next_trigger_at),
                Some(next_trigger_at.timestamp_millis()),
            );
            store
                .set_todo_reminders(active.todo_id, updated_reminders)
                .map_err(|error| error.to_string())?;
            center.handle_action(&alert_id, ReminderAction::IgnoreCurrent);
            should_resync = true;
            Some(active.todo_id)
        }
        _ => return Err("不支持的提醒操作".to_string()),
    };

    if should_resync {
        center.sync_due_reminders(&store.get_todos());
    }

    sync_reminder_window(&app);
    refresh_main_window(&app);
    let _ = todo_id;
    Ok(())
}

#[tauri::command]
pub fn open_active_reminder_target(app: AppHandle, center: State<ReminderCenter>, alert_id: String) -> Result<(), String> {
    let todo_id = center.todo_id_for_alert(&alert_id).ok_or_else(|| "当前没有活动提醒".to_string())?;
    focus_main_window_to_todo(&app, todo_id, true);
    Ok(())
}

fn ensure_visible_alerts(runtime: &mut ReminderRuntime) {
    while runtime.visible.len() < REMINDER_VISIBLE_COUNT {
        let Some(next_alert) = runtime.queue.pop_front() else {
            break;
        };
        runtime.visible.push(next_alert);
    }
}

fn sync_reminder_window(app: &AppHandle) {
    let Some(center) = app.try_state::<ReminderCenter>() else {
        return;
    };
    let payloads = center.active_payloads();
    if payloads.is_empty() {
        if let Some(window) = app.get_webview_window(REMINDER_WINDOW_LABEL) {
            let _ = window.hide();
        }
        return;
    }
    let window = ensure_reminder_window(app);
    let _ = position_reminder_window(&window);
    let _ = window.show();
    let _ = window.set_always_on_top(true);
    let payload_script = serde_json::to_string(&payloads).unwrap_or_else(|_| "[]".to_string());
    let _ = window.eval(&format!("window.__setReminderPayloads?.({payload_script});"));
}

fn ensure_reminder_window(app: &AppHandle) -> tauri::WebviewWindow {
    if let Some(window) = app.get_webview_window(REMINDER_WINDOW_LABEL) {
        return window;
    }
    WebviewWindowBuilder::new(app, REMINDER_WINDOW_LABEL, WebviewUrl::App("reminder.html".into()))
        .title("提醒")
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .visible(false)
        .inner_size(REMINDER_WINDOW_WIDTH as f64, REMINDER_WINDOW_HEIGHT as f64)
        .build()
        .expect("failed to build reminder window")
}

fn position_reminder_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    let (left, top, right, bottom) = primary_work_area(window)?;
    let x = right - REMINDER_WINDOW_WIDTH - REMINDER_WINDOW_MARGIN_X;
    let y = bottom - REMINDER_WINDOW_HEIGHT - REMINDER_WINDOW_MARGIN_Y;
    let x = x.max(left + REMINDER_WINDOW_MARGIN_X);
    let y = y.max(top + REMINDER_WINDOW_MARGIN_Y);
    window
        .set_position(Position::Physical(PhysicalPosition::new(x, y)))
        .map_err(|error| error.to_string())
}

fn focus_main_window_to_todo(app: &AppHandle, todo_id: u64, focus: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        if focus {
            let _ = window.set_focus();
        }
        let _ = window.eval(&format!("window.__openTodoFromReminder?.({todo_id});"));
    }
}

fn refresh_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.eval("window.__refreshFromReminder?.()");
    }
}

fn reminder_snapshot(runtime: &ReminderRuntime) -> (Vec<String>, usize) {
    (
        runtime.visible.iter().map(|item| item.alert_id.clone()).collect(),
        runtime.queue.len(),
    )
}

fn primary_work_area(window: &tauri::WebviewWindow) -> Result<(i32, i32, i32, i32), String> {
    #[cfg(target_os = "windows")]
    {
        let mut work_rect = RECT::default();
        let result = unsafe {
            SystemParametersInfoW(
                SPI_GETWORKAREA,
                0,
                Some((&mut work_rect as *mut RECT).cast()),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
        };
        if result.is_ok() {
            return Ok((work_rect.left, work_rect.top, work_rect.right, work_rect.bottom));
        }
    }

    let monitor = window
        .primary_monitor()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "无法获取主显示器信息".to_string())?;
    let size = monitor.size();
    let position = monitor.position();
    Ok((
        position.x,
        position.y,
        position.x + size.width as i32,
        position.y + size.height as i32,
    ))
}

fn reminder_supports_app(reminder: &&ReminderSetting) -> bool {
    if reminder.channels.is_empty() {
        return true;
    }
    reminder.channels.iter().any(|item| item.eq_ignore_ascii_case("app"))
}

fn reminder_supports_email(reminder: &&ReminderSetting) -> bool {
    reminder.channels.iter().any(|item| item.eq_ignore_ascii_case("email"))
}

fn build_entry_key(todo_id: u64, reminder_value: &str) -> String {
    format!("{}::{}", todo_id, reminder_value.trim())
}

fn build_alert_id(entry_key: &str, occurrence_marker: i64) -> String {
    format!("{}::{}", entry_key, occurrence_marker)
}

fn find_alert<'a>(runtime: &'a ReminderRuntime, alert_id: &str) -> Option<&'a ReminderAlert> {
    runtime
        .visible
        .iter()
        .chain(runtime.queue.iter())
        .find(|item| item.alert_id == alert_id)
}

fn take_alert(runtime: &mut ReminderRuntime, alert_id: &str) -> Option<ReminderAlert> {
    if let Some(index) = runtime.visible.iter().position(|item| item.alert_id == alert_id) {
        return Some(runtime.visible.remove(index));
    }
    if let Some(index) = runtime.queue.iter().position(|item| item.alert_id == alert_id) {
        return runtime.queue.remove(index);
    }
    None
}

fn compute_trigger_at(due_at: DateTime<Local>, reminder: &ReminderSetting) -> Option<DateTime<Local>> {
    let value = reminder.value.trim();
    if value == "到期时" {
        return Some(due_at);
    }
    if let Some(absolute_at) = parse_absolute_reminder(value) {
        return Some(absolute_at);
    }
    let delta = parse_reminder_offset_minutes(value)?;
    Some(due_at - ChronoDuration::minutes(delta))
}

fn resolve_due_occurrence(todo: &Todo, reminder: &ReminderSetting, now_ms: i64) -> Option<ReminderOccurrence> {
    let due_date = todo.due_date.as_deref()?;
    let initial_due_at = parse_due_date(due_date)?;
    let initial_trigger_at = compute_trigger_at(initial_due_at, reminder)?;

    let Some(repeat) = todo.repeat.as_ref() else {
        return Some(ReminderOccurrence {
            due_at: initial_due_at,
            trigger_at: initial_trigger_at,
            missed_count: 1,
        });
    };

    let mut latest_due_at = initial_due_at;
    let mut latest_trigger_at = initial_trigger_at;
    let mut missed_count = 1usize;

    // 规则：重复待办只保留“当前时刻之前最后一次应提醒的 occurrence”，并累计它之前错过的次数。
    // 原因：重启后应只弹一条提醒，但完成时仍要按遗漏次数一次性跨过 backlog。
    while latest_trigger_at.timestamp_millis() <= now_ms {
        let Some(next_due_at) = next_due_from_repeat(latest_due_at, repeat) else {
            break;
        };
        let Some(next_trigger_at) = compute_trigger_at(next_due_at, reminder) else {
            break;
        };
        if next_trigger_at.timestamp_millis() > now_ms {
            break;
        }
        latest_due_at = next_due_at;
        latest_trigger_at = next_trigger_at;
        missed_count += 1;
    }

    Some(ReminderOccurrence {
        due_at: latest_due_at,
        trigger_at: latest_trigger_at,
        missed_count,
    })
}

fn parse_absolute_reminder(value: &str) -> Option<DateTime<Local>> {
    parse_due_date(value.trim().strip_prefix("定时@")?)
}

fn parse_reminder_offset_minutes(value: &str) -> Option<i64> {
    let normalized = value.trim();
    let stripped = normalized.strip_prefix("提前")?;
    let mut digits = String::new();
    let mut unit = String::new();
    for ch in stripped.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
        } else {
            unit.push(ch);
        }
    }
    let amount = digits.parse::<i64>().ok()?;
    let minutes = match unit.as_str() {
        "分钟" => amount,
        "小时" => amount * 60,
        "天" => amount * 60 * 24,
        "周" => amount * 60 * 24 * 7,
        _ => return None,
    };
    Some(minutes)
}

fn parse_due_date(value: &str) -> Option<DateTime<Local>> {
    for pattern in ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(value, pattern) {
            return localize_naive(naive);
        }
    }
    None
}

fn localize_naive(value: NaiveDateTime) -> Option<DateTime<Local>> {
    match Local.from_local_datetime(&value) {
        LocalResult::Single(date_time) => Some(date_time),
        LocalResult::Ambiguous(first, _) => Some(first),
        LocalResult::None => None,
    }
}

fn timestamp_to_label(timestamp_ms: i64) -> String {
    Local
        .timestamp_millis_opt(timestamp_ms)
        .single()
        .map(|date_time| date_time.format("%m-%d %H:%M").to_string())
        .unwrap_or_default()
}

fn format_absolute_reminder_value(value: DateTime<Local>) -> String {
    format!("定时@{}", value.format("%Y-%m-%d %H:%M"))
}

fn email_config_is_ready(user_config: &AppConfig, mail_config: &MailConfig) -> bool {
    validate_email_config(user_config, mail_config).is_ok()
}

fn validate_email_config(user_config: &AppConfig, mail_config: &MailConfig) -> Result<(), String> {
    // 规则顺序：先校验开关与收件人，再校验 SMTP 连接参数。
    // 这样返回给前端的错误会优先指出缺失的业务前置条件，而不是笼统的发信失败。
    if !mail_config.email_reminder_enabled {
        return Err("邮件提醒未开启".to_string());
    }
    if user_config.notification_email.trim().is_empty() {
        return Err("请先在配置中填写提醒邮箱".to_string());
    }
    if !mail_config.smtp_ssl {
        return Err("当前仅支持 SSL 邮件连接，请开启 SMTP SSL".to_string());
    }
    if mail_config.smtp_host.trim().is_empty() {
        return Err("请先配置 SMTP 服务器地址".to_string());
    }
    if mail_config.smtp_port == 0 {
        return Err("请先配置 SMTP 端口".to_string());
    }
    if mail_config.smtp_username.trim().is_empty() {
        return Err("请先配置 SMTP 用户名".to_string());
    }
    if mail_config.smtp_password.trim().is_empty() {
        return Err("请先配置 SMTP 密码或授权码".to_string());
    }
    if mail_config.smtp_sender_email.trim().is_empty() {
        return Err("请先配置发件人邮箱".to_string());
    }
    Ok(())
}

fn send_email_notification(user_config: &AppConfig, mail_config: &MailConfig, item: &EmailDispatch) -> Result<(), String> {
    let from = Mailbox::new(
        if mail_config.smtp_sender_name.trim().is_empty() {
            None
        } else {
            Some(mail_config.smtp_sender_name.clone())
        },
        mail_config
            .smtp_sender_email
            .parse()
            .map_err(|error| normalize_email_error(&format!("invalid sender email: {error}")))?,
    );
    let to = Mailbox::new(
        None,
        user_config
            .notification_email
            .parse()
            .map_err(|error| normalize_email_error(&format!("invalid recipient email: {error}")))?,
    );
    let subject = format!("peck-x 提醒：{}", item.title.trim());
    let body = format!(
        "你有一条待办需要处理。\n\n标题：{}\n分类：{}\n截止时间：{}\n提醒时间：{}\n提醒方式：邮箱提醒\n\n请打开 peck-x 查看详情并处理。",
        item.title.trim(),
        item.category.trim(),
        item.due_label.trim(),
        item.trigger_label.trim()
    );
    let message = Message::builder()
        .from(from)
        .to(to)
        .subject(subject)
        .body(body)
        .map_err(|error| normalize_email_error(&format!("build email failed: {error}")))?;
    let credentials = Credentials::new(mail_config.smtp_username.clone(), mail_config.smtp_password.clone());
    let tls_parameters = TlsParameters::new(mail_config.smtp_host.clone())
        .map_err(|error| normalize_email_error(&format!("build tls parameters failed: {error}")))?;
    let mailer = SmtpTransport::builder_dangerous(&mail_config.smtp_host)
        .port(mail_config.smtp_port)
        .tls(Tls::Wrapper(tls_parameters))
        .credentials(credentials)
        .build();
    mailer
        .send(&message)
        .map_err(|error| normalize_email_error(&format!("smtp send failed: {error}")))?;
    Ok(())
}

fn send_test_email_notification(user_config: &AppConfig, mail_config: &MailConfig, item: &EmailDispatch) -> Result<(), String> {
    let from = Mailbox::new(
        if mail_config.smtp_sender_name.trim().is_empty() {
            None
        } else {
            Some(mail_config.smtp_sender_name.clone())
        },
        mail_config
            .smtp_sender_email
            .parse()
            .map_err(|error| normalize_email_error(&format!("invalid sender email: {error}")))?,
    );
    let to = Mailbox::new(
        None,
        user_config
            .notification_email
            .parse()
            .map_err(|error| normalize_email_error(&format!("invalid recipient email: {error}")))?,
    );
    let subject = item.title.trim().to_string();
    let body = format!(
        "您好，\n\n这是一封由 peck-x 自动发送的邮件通知服务测试邮件，用于确认当前邮箱可以正常接收系统发送的待办提醒通知。\n\n通知类型：邮件通知服务测试\n发送时间：{}\n接收邮箱：{}\n\n如您已成功收到本邮件，说明当前邮件通知配置与发送链路工作正常。\n\n此为系统测试邮件，无需进行其他操作。\n\npeck-x",
        item.trigger_label.trim(),
        user_config.notification_email.trim()
    );
    let message = Message::builder()
        .from(from)
        .to(to)
        .subject(subject)
        .body(body)
        .map_err(|error| normalize_email_error(&format!("build email failed: {error}")))?;
    let credentials = Credentials::new(mail_config.smtp_username.clone(), mail_config.smtp_password.clone());
    let tls_parameters = TlsParameters::new(mail_config.smtp_host.clone())
        .map_err(|error| normalize_email_error(&format!("build tls parameters failed: {error}")))?;
    let mailer = SmtpTransport::builder_dangerous(&mail_config.smtp_host)
        .port(mail_config.smtp_port)
        .tls(Tls::Wrapper(tls_parameters))
        .credentials(credentials)
        .build();
    mailer
        .send(&message)
        .map_err(|error| normalize_email_error(&format!("smtp send failed: {error}")))?;
    Ok(())
}

fn normalize_email_error(error: &str) -> String {
    let normalized = error.to_ascii_lowercase();
    if normalized.contains("invalid sender email") {
        return format!("发件人邮箱格式不正确：{error}");
    }
    if normalized.contains("invalid recipient email") {
        return format!("提醒邮箱格式不正确：{error}");
    }
    if normalized.contains("authentication") || normalized.contains("credentials") {
        return format!("SMTP 认证失败，请检查用户名和授权码：{error}");
    }
    if normalized.contains("550")
        && (error.contains("无权登录")
            || error.contains("无权登陆")
            || normalized.contains("auth")
            || normalized.contains("login")
            || normalized.contains("permanent error"))
    {
        return format!("SMTP 服务器拒绝登录，请检查邮箱是否已开启 SMTP，并确认填写的是授权码而不是登录密码：{error}");
    }
    if normalized.contains("connection closed") || normalized.contains("net_io_connectionclosed") || error.contains("无法从传输连接中读取数据") {
        return format!("SMTP 连接被服务器中断，请检查端口、SSL 设置或服务端策略：{error}");
    }
    if normalized.contains("tls") || normalized.contains("ssl") {
        return format!("SMTP SSL/TLS 握手失败，请检查端口和加密方式：{error}");
    }
    format!("邮件发送失败：{error}")
}

fn next_due_from_repeat(base: DateTime<Local>, repeat: &RepeatRule) -> Option<DateTime<Local>> {
    let rule = parse_repeat_rule(&repeat.rrule)?;
    match rule.freq.as_str() {
        "DAILY" => Some(base + ChronoDuration::days(rule.interval as i64)),
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
                result.by_days = value.split(',').filter_map(parse_weekday_code).collect();
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
        return Some(base + ChronoDuration::weeks(interval as i64));
    }

    let base_date = base.date_naive();
    let base_week_start = start_of_week(base_date);
    let max_scan_days = interval.max(1) as i64 * 7 + 7;

    for day_offset in 1..=max_scan_days {
        let candidate_date = base_date.checked_add_signed(ChronoDuration::days(day_offset))?;
        let candidate_week_start = start_of_week(candidate_date);
        let weeks_since_base = candidate_week_start.signed_duration_since(base_week_start).num_days() / 7;
        if weeks_since_base % interval.max(1) as i64 != 0 {
            continue;
        }
        if !by_days.contains(&candidate_date.weekday()) {
            continue;
        }
        let candidate = localize_datetime(candidate_date, base.hour(), base.minute(), base.second())?;
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
    date - ChronoDuration::days(date.weekday().num_days_from_monday() as i64)
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

fn localize_datetime(date: NaiveDate, hour: u32, minute: u32, second: u32) -> Option<DateTime<Local>> {
    localize_naive(date.and_hms_opt(hour, minute, second)?)
}

fn schedule_email_retry(entry: &mut ReminderEntryState, base_marker: i64, now_ms: i64, permanent_failure: bool) {
    if entry.last_base_trigger != Some(base_marker) {
        entry.last_base_trigger = Some(base_marker);
        entry.email_retry_count = 0;
        entry.email_retry_after = None;
        entry.email_retry_exhausted = false;
    }
    if permanent_failure {
        entry.email_retry_after = None;
        entry.email_retry_exhausted = true;
        return;
    }
    if let Some(delay_secs) = EMAIL_RETRY_DELAYS_SECS.get(entry.email_retry_count).copied() {
        entry.email_retry_count += 1;
        entry.email_retry_after = Some(now_ms + delay_secs * 1000);
        return;
    }
    entry.email_retry_after = None;
    entry.email_retry_exhausted = true;
}

fn is_permanent_email_error(error: &str) -> bool {
    let normalized = error.to_ascii_lowercase();
    normalized.contains("invalid sender email")
        || normalized.contains("invalid recipient email")
        || normalized.contains("authentication")
        || normalized.contains("credentials")
        || (normalized.contains("550")
            && (error.contains("无权登录")
                || error.contains("无权登陆")
                || normalized.contains("auth")
                || normalized.contains("login")
                || normalized.contains("permanent error")))
        || normalized.contains("5.1")
        || normalized.contains("5.7")
}

fn replace_active_reminder_value(
    reminders: Vec<ReminderSetting>,
    active_value: &str,
    next_value: String,
    next_email_sent_marker: Option<i64>,
) -> Vec<ReminderSetting> {
    let mut replaced = false;
    let mut result = Vec::with_capacity(reminders.len().max(1));

    for reminder in reminders {
        // 只替换当前触发的这一条提醒规则，避免把同一待办上的其他提醒一并覆盖，
        // 也避免在找不到原规则时重复插入多条“稍后”提醒。
        if !replaced && reminder.value.trim() == active_value.trim() {
            result.push(ReminderSetting {
                value: next_value.clone(),
                channels: reminder.channels,
                // 稍后提醒会改写成新的绝对触发点，但邮件规则仍是“同一条原始提醒只发一次”，
                // 所以这里直接把新触发点记为已发送，避免 snooze 后再次发邮件。
                email_sent_marker: next_email_sent_marker.or(reminder.email_sent_marker),
            });
            replaced = true;
            continue;
        }
        result.push(reminder);
    }

    if !replaced {
        result.push(ReminderSetting {
            value: next_value,
            channels: vec!["app".to_string()],
            email_sent_marker: next_email_sent_marker,
        });
    }

    result
}