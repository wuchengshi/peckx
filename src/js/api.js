/**
 * 判断当前环境是否存在 Tauri 调用能力。
 */
function canInvoke() {
  return Boolean(window.__TAURI_INTERNALS__ && typeof window.__TAURI_INTERNALS__.invoke === 'function');
}

/**
 * 统一包装 invoke，浏览器预览时给出明确错误。
 */
async function invoke(command, payload) {
  if (!canInvoke()) {
    throw new Error(`Tauri API 不可用，无法调用命令：${command}`);
  }
  return window.__TAURI_INTERNALS__.invoke(command, payload);
}

/**
 * 导出前端使用的最小后端接口集合。
 */
export const api = {
  createNote(content) { return invoke('create_note', { content }); },
  updateNote(id, content) { return invoke('update_note', { id, content }); },
  // Tauri 2 的 JavaScript invoke 参数默认使用 camelCase；这里必须与生成命令包装器的 dataBase64/imageUrl 对齐。
  // 若传 Rust 侧的 snake_case 名称，命令会在进入 save_image/load_image_data_url 前就报缺少参数，表现为保存和查看同时失败。
  saveImage(dataBase64, ext) { return invoke('save_image', { dataBase64, ext }); },
  loadImageDataUrl(imageUrl) { return invoke('load_image_data_url', { imageUrl }); },
  archiveNote(id) { return invoke('archive_note', { id }); },
  unarchiveNote(id) { return invoke('unarchive_note', { id }); },
  togglePin(id) { return invoke('toggle_pin', { id }); },
  getNotes(archived) { return invoke('get_notes', { archived }); },
  getNote(id) { return invoke('get_note', { id }); },
  toggleStarNote(id) { return invoke('toggle_star_note', { id }); },
  setNoteCategory(id, category) { return invoke('set_note_category', { id, category }); },
  softDeleteNote(id) { return invoke('soft_delete_note', { id }); },
  restoreNote(id) { return invoke('restore_note', { id }); },
  permanentlyDeleteNote(id) { return invoke('permanently_delete_note', { id }); },
  createTodo(title) { return invoke('create_todo', { title }); },
  getTodos() { return invoke('get_todos'); },
  toggleTodo(id) { return invoke('toggle_todo', { id }); },
  updateTodo(id, title) { return invoke('update_todo', { id, title }); },
  toggleStarTodo(id) { return invoke('toggle_star_todo', { id }); },
  setTodoCategory(id, category) { return invoke('set_todo_category', { id, category }); },
  setTodoDueDate(id, dueDate) { return invoke('set_todo_due_date', { id, dueDate }); },
  setTodoReminders(id, reminders) { return invoke('set_todo_reminders', { id, reminders }); },
  setTodoRepeat(id, repeat) { return invoke('set_todo_repeat', { id, repeat }); },
  setTodoNote(id, note) { return invoke('set_todo_note', { id, note }); },
  archiveTodo(id) { return invoke('archive_todo', { id }); },
  unarchiveTodo(id) { return invoke('unarchive_todo', { id }); },
  softDeleteTodo(id) { return invoke('soft_delete_todo', { id }); },
  restoreTodo(id) { return invoke('restore_todo', { id }); },
  permanentlyDeleteTodo(id) { return invoke('permanently_delete_todo', { id }); },
  getAllItems(query, page, pageSize) { return invoke('get_all_items', { query, page, pageSize }); },
  getTrashItems(query, page, pageSize) { return invoke('get_trash_items', { query, page, pageSize }); },
  getArchiveItems(query, page, pageSize) { return invoke('get_archive_items', { query, page, pageSize }); },
  getCompletedTodos(query, page, pageSize) { return invoke('get_completed_todos', { query, page, pageSize }); },
  getCategories() { return invoke('get_categories'); },
  cleanExpiredTrash(retentionDays) { return invoke('clean_expired_trash', { retentionDays }); },
  moveExpiredCompletedTodosToTrash(retentionDays) { return invoke('move_expired_completed_todos_to_trash', { retentionDays }); },
  getConfig() { return invoke('get_config'); },
  setConfig(config) { return invoke('set_config', { config }); },
  sendTestEmail() { return invoke('send_test_email'); },
  getAutoStartEnabled() { return invoke('get_auto_start_enabled'); },
  setAutoStartEnabled(enabled) { return invoke('set_auto_start_enabled', { enabled }); },
  setShortcutToggle(shortcut) { return invoke('set_shortcut_toggle', { shortcut }); },
  getActiveReminders() { return invoke('get_active_reminders'); },
  getReminderSlot(slotIndex) { return invoke('get_reminder_slot', { slotIndex }); },
  handleReminderAction(alertId, action, snoozeMinutes) { return invoke('handle_reminder_action', { alertId, action, snoozeMinutes }); },
  openActiveReminderTarget(alertId) { return invoke('open_active_reminder_target', { alertId }); },
};
