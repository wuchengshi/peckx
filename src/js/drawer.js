import { api } from './api.js';
import { $ } from './dom.js';
import { state } from './state.js';
import { chipLabel, dueState, fullTime, normalizeReminderSettings, showToast } from './utils.js';
import {
  openCategoryPopover,
  openDeleteConfirmPopover,
  openDueDatePopover,
  openReminderPopover,
  openRepeatPopover,
} from './popover.js';

let deps;

/**
 * 初始化待办详情抽屉，并绑定关闭动作。
 */
export function setupDrawer(options) {
  deps = options;
  $('#drawer-close')?.addEventListener('click', closeDrawer);
  $('#drawer-backdrop')?.addEventListener('click', closeDrawer);
}

/**
 * 打开指定待办的详情抽屉。
 */
export async function openDrawer(todoId, readOnly = false) {
  state.drawer.returnView = state.activeView;
  state.drawer.todoId = todoId;
  state.drawer.readOnly = readOnly;
  const todo = await findTodo(todoId);
  renderDrawer(todo);
  $('#drawer').classList.add('visible');
  $('#drawer-backdrop').classList.add('visible');
  state.activeView = 'drawer';
}

/**
 * 关闭待办详情抽屉。
 */
export function closeDrawer() {
  $('#drawer').classList.remove('visible');
  $('#drawer-backdrop').classList.remove('visible');
  state.drawer.readOnly = false;
  state.activeView = state.drawer.returnView || 'home';
}

/**
 * 重新渲染抽屉内容并绑定每个字段的编辑行为。
 */
function renderDrawer(todo) {
  const due = dueState(todo.due_date);
  const readOnly = state.drawer.readOnly;
  const categoryField = readOnly
    ? `<div class="drawer-static-value">${chipLabel('category', todo.category)}</div>`
    : `<button class="drawer-value" id="drawer-category-btn">${chipLabel('category', todo.category)}</button>`;
  const dueField = readOnly
    ? `<div class="drawer-static-value ${due?.tone || ''}">${chipLabel('due', todo.due_date)}</div>`
    : `<button class="drawer-value ${due?.tone || ''}" id="drawer-due-btn">${chipLabel('due', todo.due_date)}</button>`;
  const reminderField = readOnly
    ? `<div class="drawer-static-value">${chipLabel('reminder', todo.reminders)}</div>`
    : `<button class="drawer-value" id="drawer-reminder-btn">${chipLabel('reminder', todo.reminders)}</button>`;
  const repeatField = readOnly
    ? `<div class="drawer-static-value">${chipLabel('repeat', todo.repeat)}</div>`
    : `<button class="drawer-value" id="drawer-repeat-btn">${chipLabel('repeat', todo.repeat)}</button>`;
  const titleField = readOnly
    ? `<div class="drawer-static-text">${escapeText(todo.title)}</div>`
    : `<input class="drawer-text-input" id="drawer-title-input" value="${escapeAttribute(todo.title)}">`;
  const noteField = readOnly
    ? `<div class="drawer-static-text drawer-static-note">${escapeText(todo.note || '未设置')}</div>`
    : `<textarea class="drawer-input" id="drawer-note-input">${escapeText(todo.note || '')}</textarea>`;
  $('#drawer-body').innerHTML = `
    <div class="drawer-field">
      <div class="drawer-label">标题</div>
      ${titleField}
    </div>
    <div class="drawer-meta-strip">
      <span>创建于 ${escapeText(fullTime(todo.created_at))}</span>
      <span>更新于 ${escapeText(fullTime(todo.updated_at || todo.created_at))}</span>
    </div>
    <div class="drawer-field">
      <div class="drawer-label">分类</div>
      ${categoryField}
    </div>
    <div class="drawer-field">
      <div class="drawer-label">截止</div>
      ${dueField}
    </div>
    <div class="drawer-field">
      <div class="drawer-label">提醒</div>
      ${reminderField}
    </div>
    <div class="drawer-field">
      <div class="drawer-label">重复</div>
      ${repeatField}
    </div>
    <div class="drawer-field">
      <div class="drawer-label">备注</div>
      ${noteField}
    </div>
    ${readOnly ? '' : `
      <div class="drawer-actions">
        <button class="drawer-action-btn" id="drawer-star-btn">${todo.starred ? '取消星标' : '设为星标'}</button>
        <button class="drawer-action-btn" id="drawer-archive-btn">归档</button>
        <button class="drawer-action-btn danger" id="drawer-delete-btn">删除</button>
      </div>
    `}
  `;
  $('.drawer-title').textContent = readOnly ? '查看详情' : '待办详情';
  bindDrawerEvents(todo);
}

/**
 * 绑定抽屉内的字段编辑与动作按钮。
 */
function bindDrawerEvents(todo) {
  if (state.drawer.readOnly) {
    return;
  }
  $('#drawer-title-input')?.addEventListener('blur', async (event) => {
    const value = event.target.value.trim();
    if (!value) {
      event.target.value = todo.title;
      showToast('标题不能为空');
      return;
    }
    if (value !== todo.title) {
      await api.updateTodo(todo.id, value);
      await refreshAfterChange(todo.id);
    }
  });
  $('#drawer-note-input')?.addEventListener('blur', async (event) => {
    await api.setTodoNote(todo.id, event.target.value);
    await refreshAfterChange(todo.id);
  });
  $('#drawer-category-btn')?.addEventListener('click', (event) => {
    openCategoryPopover(event.currentTarget, todo.category, async (value) => {
      await api.setTodoCategory(todo.id, value);
      await refreshAfterChange(todo.id);
    });
  });
  $('#drawer-due-btn')?.addEventListener('click', (event) => {
    openDueDatePopover(event.currentTarget, todo.due_date, async (value) => {
      const hadReminders = Array.isArray(todo.reminders) && todo.reminders.length > 0;
      await api.setTodoDueDate(todo.id, value);
      if (!value && hadReminders) {
        showToast('已清除截止时间，提醒已同步取消');
      }
      await refreshAfterChange(todo.id);
    });
  });
  $('#drawer-reminder-btn')?.addEventListener('click', (event) => {
    if (!todo.due_date) {
      showToast('请先设置截止时间，再设置提醒');
      return;
    }
    openReminderPopover(event.currentTarget, todo.reminders, async (value) => {
      await api.setTodoReminders(todo.id, normalizeReminderSettings(value));
      await refreshAfterChange(todo.id);
    });
  });
  $('#drawer-repeat-btn')?.addEventListener('click', (event) => {
    openRepeatPopover(event.currentTarget, todo.repeat, async (value) => {
      await api.setTodoRepeat(todo.id, value);
      await refreshAfterChange(todo.id);
    });
  });
  $('#drawer-star-btn')?.addEventListener('click', async () => {
    await api.toggleStarTodo(todo.id);
    await refreshAfterChange(todo.id);
  });
  $('#drawer-archive-btn')?.addEventListener('click', async () => {
    await api.archiveTodo(todo.id);
    closeDrawer();
    await deps.refreshCategories();
    await deps.refreshHome();
    await deps.refreshBadges();
  });
  $('#drawer-delete-btn')?.addEventListener('click', (event) => {
    openDeleteConfirmPopover(event.currentTarget, async () => {
      await api.softDeleteTodo(todo.id);
      closeDrawer();
      await deps.refreshCategories();
      await deps.refreshHome();
      await deps.refreshBadges();
    });
  });
}

/**
 * 在抽屉字段保存后重新加载当前待办并刷新关联页面。
 */
async function refreshAfterChange(todoId) {
  await deps.refreshCategories();
  await deps.refreshHome();
  await deps.refreshBadges();
  const updated = await findTodo(todoId);
  renderDrawer(updated);
}

/**
 * 从缓存或后端查找指定待办。
 */
async function findTodo(todoId) {
  const localTodo = state.todos.find((item) => item.id === todoId);
  if (localTodo) {
    return localTodo;
  }
  const todos = await api.getTodos();
  return todos.find((item) => item.id === todoId);
}

/**
 * 转义属性值，避免标题回填到 input 时破坏结构。
 */
function escapeAttribute(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/**
 * 转义 textarea 文本，避免备注回填时破坏结构。
 */
function escapeText(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
}
