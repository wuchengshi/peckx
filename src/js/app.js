import { api } from './api.js';
import { state } from './state.js';
import { isTauri, showToast } from './utils.js';
import { setupPopover, closePopover, isPopoverVisible } from './popover.js';
import { setMode, setupComposer, toggleExpanded } from './input.js';
import { setupHome, loadHome } from './list.js';
import { setupFullList, openFullList, closeFullList } from './fulllist.js';
import { setupEditPage, closeEditPage } from './edit.js';
import { setupNoteView, closeNoteView } from './note-view.js';
import { setupDrawer, closeDrawer } from './drawer.js';
import { setupTrash, openTrash, closeTrash } from './trash.js';
import { setupArchive, openArchive, closeArchive } from './archive.js';
import { setupCompleted, openCompleted, closeCompleted, refreshCompleted } from './completed.js';
import { setupConfig, openConfig, closeConfig, loadRuntimeConfig } from './config.js';

document.addEventListener('DOMContentLoaded', () => {
  void bootstrap();
});

/**
 * 初始化应用并装配所有模块。
 */
async function bootstrap() {
  setupPopover();
  setupComposer({ refreshHome, refreshBadges, refreshCategories });
  setupHome({ refreshHome, refreshBadges, refreshCategories });
  setupFullList({ refreshHome, refreshBadges, refreshCategories });
  setupEditPage({ refreshHome, refreshBadges, refreshCategories });
  setupNoteView({ refreshHome, refreshBadges, refreshCategories });
  setupDrawer({ refreshHome, refreshBadges, refreshCategories });
  setupTrash({ refreshHome, refreshBadges, refreshCategories });
  setupArchive({ refreshHome, refreshBadges, refreshCategories });
  setupCompleted({ refreshHome, refreshBadges, refreshCategories });
  setupConfig({ refreshHome, refreshBadges, refreshCategories, refreshCompleted });
  setupNavigation();
  setupGlobalKeys();
  setupReminderBridge();

  if (!isTauri()) {
    showToast('当前是浏览器预览模式');
    return;
  }

  const config = await loadRuntimeConfig();
  await api.moveExpiredCompletedTodosToTrash(config.completed_retention_days).catch(() => {});
  await api.cleanExpiredTrash(config.trash_retention_days).catch(() => {});
  await refreshCategories();
  await syncActiveReminderTodos();
  await refreshHome();
  await refreshBadges();
}

/**
 * 刷新分类缓存。
 */
export async function refreshCategories() {
  state.categories = await api.getCategories().catch(() => []);
}

/**
 * 刷新首页列表。
 */
export async function refreshHome() {
  await loadHome();
}

/**
 * 刷新完成、归档与垃圾桶按钮角标状态。
 */
export async function refreshBadges() {
  const [trash, archive, completed] = await Promise.all([
    api.getTrashItems(null, 1, 1).catch(() => ({ total: 0 })),
    api.getArchiveItems(null, 1, 1).catch(() => ({ total: 0 })),
    api.getCompletedTodos(null, 1, 1).catch(() => ({ total: 0 })),
  ]);
  document.getElementById('btn-trash-link')?.classList.toggle('has-items', trash.total > 0);
  document.getElementById('btn-archive-link')?.classList.toggle('has-items', archive.total > 0);
  document.getElementById('btn-completed-link')?.classList.toggle('has-items', completed.total > 0);
}

/**
 * 绑定顶层页面导航按钮。
 */
function setupNavigation() {
  document.getElementById('btn-all-link')?.addEventListener('click', () => void openFullList());
  document.getElementById('btn-home-more')?.addEventListener('click', () => void openFullList());
  document.getElementById('btn-completed-link')?.addEventListener('click', () => void openCompleted());
  document.getElementById('btn-trash-link')?.addEventListener('click', () => void openTrash());
  document.getElementById('btn-archive-link')?.addEventListener('click', () => void openArchive());
}

/**
 * 暴露给 Rust 侧（托盘菜单"配置"）和全局调用。
 */
window.__openConfig = () => void openConfig();

/**
 * 绑定全局快捷键和关闭顺序。
 */
function setupGlobalKeys() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Tab' && event.shiftKey && state.activeView === 'home') {
      // Shift+Tab 优先控制输入框展开/缩小，避免被普通 Tab 的模式切换规则误处理。
      event.preventDefault();
      toggleExpanded();
      document.getElementById('input-field')?.focus();
      return;
    }
    if (event.key === 'Tab' && !event.shiftKey) {
      // Tab 是应用级模块切换键：窗口激活时即可使用，避免焦点离开输入框后无法切换模式。
      event.preventDefault();
      setMode(state.mode === 'note' ? 'todo' : 'note');
      return;
    }
    if (event.key === 'Escape') {
      if (isPopoverVisible()) {
        closePopover();
        return;
      }
      if (state.activeView === 'drawer') {
        closeDrawer();
        return;
      }
      if (state.activeView === 'full-list') {
        closeFullList();
        return;
      }
      if (state.activeView === 'edit') {
        closeEditPage();
        return;
      }
      if (state.activeView === 'note-view') {
        closeNoteView();
        return;
      }
      if (state.activeView === 'trash') {
        closeTrash();
        return;
      }
      if (state.activeView === 'archive') {
        closeArchive();
        return;
      }
      if (state.activeView === 'completed') {
        closeCompleted();
        return;
      }
      if (state.activeView === 'config') {
        closeConfig();
        return;
      }
    }
  });
}

/**
 * 暴露提醒窗需要的回调，并在主窗口重新获得焦点时补一次刷新，避免提醒动作后列表停留旧状态。
 */
function setupReminderBridge() {
  window.__refreshFromReminder = () => {
    void refreshFromReminder();
  };
  window.__openTodoFromReminder = (todoId) => {
    void openTodoFromReminder(todoId);
  };
  window.addEventListener('focus', () => {
    if (!isTauri()) {
      return;
    }
    void refreshFromReminder();
  });
}

async function refreshFromReminder() {
  await refreshCategories();
  await syncActiveReminderTodos();
  await refreshHome();
  await refreshBadges();
  // 刷新顺序：先更新列表缓存，再按当前打开的 drawer 重新取一次 todo，
  // 避免“稍后提醒”已写回后端，但抽屉仍停留旧 reminders 文案，误判为没有更新。
  if (state.activeView === 'drawer' && Number.isFinite(state.drawer.todoId)) {
    await openDrawer(state.drawer.todoId, state.drawer.readOnly);
  }
}

async function openTodoFromReminder(todoId) {
  const numericId = Number(todoId);
  if (!Number.isFinite(numericId)) {
    return;
  }
  closeReminderContext();
  setMode('todo');
  await refreshFromReminder();
  await openDrawer(numericId);
}

function closeReminderContext() {
  if (isPopoverVisible()) {
    closePopover();
  }
  if (state.activeView === 'drawer') {
    closeDrawer();
    return;
  }
  if (state.activeView === 'full-list') {
    closeFullList();
    return;
  }
  if (state.activeView === 'edit') {
    closeEditPage();
    return;
  }
  if (state.activeView === 'note-view') {
    closeNoteView();
    return;
  }
  if (state.activeView === 'trash') {
    closeTrash();
    return;
  }
  if (state.activeView === 'archive') {
    closeArchive();
    return;
  }
  if (state.activeView === 'config') {
    closeConfig();
  }
}

async function syncActiveReminderTodos() {
  if (!isTauri()) {
    state.reminder.activeTodoIds = [];
    return;
  }

  const slots = await api.getActiveReminders().catch(() => []);
  state.reminder.activeTodoIds = [...new Set(
    slots
      .map((payload) => Number(payload?.todo_id))
      .filter((todoId) => Number.isFinite(todoId) && todoId > 0),
  )];
}
