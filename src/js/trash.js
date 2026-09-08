import { api } from './api.js';
import { $ } from './dom.js';
import { state } from './state.js';
import { debounce } from './utils.js';
import { renderTrashItem, hydrateTrustedImages } from './renderers.js';

let deps;

/**
 * 初始化垃圾桶模块，并绑定搜索、清空和条目操作。
 */
export function setupTrash(options) {
  deps = options;
  $('#trash-back-btn')?.addEventListener('click', closeTrash);
  $('#trash-search')?.addEventListener('input', debounce(handleSearchChange, 200));
  $('#trash-empty-btn')?.addEventListener('click', () => {
    void emptyTrash();
  });
  $('#trash-list')?.addEventListener('click', (event) => {
    void handleItemClick(event);
  });
}

/**
 * 打开垃圾桶页面并加载列表。
 */
export async function openTrash() {
  $('#trash-page').classList.add('visible');
  state.activeView = 'trash';
  await loadTrash();
}

/**
 * 关闭垃圾桶页面。
 */
export function closeTrash() {
  $('#trash-page').classList.remove('visible');
  state.activeView = 'home';
}

/**
 * 加载垃圾桶列表。
 */
async function loadTrash() {
  const result = await api.getTrashItems(state.trash.query || null, 1, 5000);
  state.trash.items = result.items;
  $('#trash-list').innerHTML = state.trash.items.map(renderTrashItem).join('');
  void hydrateTrustedImages($('#trash-list'));
  $('#trash-list').style.display = state.trash.items.length === 0 ? 'none' : '';
  $('#trash-empty-state').style.display = state.trash.items.length === 0 ? 'flex' : 'none';
}

/**
 * 对外暴露垃圾桶刷新入口，供配置变更后立即同步当前页面。
 */
export async function refreshTrashView() {
  await loadTrash();
}

/**
 * 处理垃圾桶搜索关键字变化。
 */
function handleSearchChange(event) {
  state.trash.query = event.target.value.trim();
  void loadTrash();
}

/**
 * 处理垃圾桶中的恢复和彻底删除操作。
 */
async function handleItemClick(event) {
  const actionTarget = event.target.closest('[data-action]');
  const itemElement = event.target.closest('.trash-item');
  if (!actionTarget || !itemElement) {
    return;
  }
  const itemType = itemElement.dataset.type;
  const itemId = itemElement.dataset.id;
  if (actionTarget.dataset.action === 'restore') {
    if (itemType === 'note') await api.restoreNote(itemId);
    if (itemType === 'todo') await api.restoreTodo(Number(itemId));
  }
  if (actionTarget.dataset.action === 'delete') {
    if (itemType === 'note') await api.permanentlyDeleteNote(itemId);
    if (itemType === 'todo') await api.permanentlyDeleteTodo(Number(itemId));
  }
  await deps.refreshCategories();
  await deps.refreshHome();
  await deps.refreshBadges();
  await loadTrash();
}

/**
 * 逐项清空垃圾桶内容，避免额外引入新的后端批量接口。
 */
async function emptyTrash() {
  for (const item of state.trash.items) {
    if (item.item_type === 'note') {
      await api.permanentlyDeleteNote(item.id);
    }
    if (item.item_type === 'todo') {
      await api.permanentlyDeleteTodo(Number(item.id));
    }
  }
  await deps.refreshCategories();
  await deps.refreshHome();
  await deps.refreshBadges();
  await loadTrash();
}
