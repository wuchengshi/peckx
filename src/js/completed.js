import { api } from './api.js';
import { $ } from './dom.js';
import { state } from './state.js';
import { debounce } from './utils.js';
import { renderCompletedTodo } from './renderers.js';

let deps;

/**
 * 初始化完成待办页，绑定搜索、返回和条目操作。
 */
export function setupCompleted(options) {
  deps = options;
  $('#completed-back-btn')?.addEventListener('click', closeCompleted);
  $('#completed-search')?.addEventListener('input', debounce(handleSearchChange, 200));
  $('#completed-list')?.addEventListener('click', (event) => {
    void handleItemClick(event);
  });
}

/**
 * 打开完成待办页并加载保留期内的条目。
 */
export async function openCompleted() {
  $('#completed-page').classList.add('visible');
  state.activeView = 'completed';
  await loadCompleted();
}

/**
 * 关闭完成待办页并返回首页。
 */
export function closeCompleted() {
  $('#completed-page').classList.remove('visible');
  state.activeView = 'home';
}

/**
 * 仅在完成页打开时刷新，避免配置保存时隐式加载不可见页面。
 */
export async function refreshCompleted() {
  if (state.activeView === 'completed') {
    await loadCompleted();
  }
}

/**
 * 加载当前搜索条件下的完成待办。
 */
async function loadCompleted() {
  const result = await api.getCompletedTodos(state.completed.query || null, 1, 5000);
  state.completed.items = result.items;
  $('#completed-list').innerHTML = state.completed.items.map(renderCompletedTodo).join('');
  $('#completed-list').style.display = state.completed.items.length === 0 ? 'none' : '';
  $('#completed-empty-state').style.display = state.completed.items.length === 0 ? 'flex' : 'none';
}

/**
 * 处理完成页搜索关键字变化。
 */
function handleSearchChange(event) {
  state.completed.query = event.target.value.trim();
  void loadCompleted();
}

/**
 * 处理恢复未完成和移入垃圾桶操作。
 */
async function handleItemClick(event) {
  const actionTarget = event.target.closest('[data-action]');
  const itemElement = event.target.closest('.completed-item');
  if (!actionTarget || !itemElement) {
    return;
  }
  const todoId = Number(itemElement.dataset.id);
  if (actionTarget.dataset.action === 'restore') {
    await api.toggleTodo(todoId);
  }
  if (actionTarget.dataset.action === 'delete') {
    await api.softDeleteTodo(todoId);
  }
  await deps.refreshCategories();
  await deps.refreshHome();
  await deps.refreshBadges();
  await loadCompleted();
}
