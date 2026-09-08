import { api } from './api.js';
import { $ } from './dom.js';
import { state } from './state.js';
import { debounce } from './utils.js';
import { renderArchiveItem, hydrateTrustedImages } from './renderers.js';

let deps;

/**
 * 初始化归档模块，并绑定搜索、返回和条目操作。
 */
export function setupArchive(options) {
  deps = options;
  $('#archive-back-btn')?.addEventListener('click', closeArchive);
  $('#archive-search')?.addEventListener('input', debounce(handleSearchChange, 200));
  $('#archive-list')?.addEventListener('click', (event) => {
    void handleItemClick(event);
  });
}

/**
 * 打开归档页面并加载列表。
 */
export async function openArchive() {
  // 入口规则：归档页默认跟随当前模式，减少待办/随记之间的管理串场。
  state.archive.type = state.mode === 'note' ? 'note' : 'todo';
  $('#archive-page').classList.add('visible');
  state.activeView = 'archive';
  await loadArchive();
}

/**
 * 关闭归档页面。
 */
export function closeArchive() {
  $('#archive-page').classList.remove('visible');
  state.activeView = 'home';
}

/**
 * 加载归档列表。
 */
async function loadArchive() {
  const result = await api.getArchiveItems(state.archive.query || null, 1, 5000);
  state.archive.items = result.items;
  applyTypeUI();
  const visibleItems = state.archive.items.filter((item) => item.item_type === state.archive.type);
  $('#archive-list').innerHTML = visibleItems.map(renderArchiveItem).join('');
  void hydrateTrustedImages($('#archive-list'));
  $('#archive-list').style.display = visibleItems.length === 0 ? 'none' : '';
  $('#archive-empty-state').style.display = visibleItems.length === 0 ? 'flex' : 'none';
}

/**
 * 处理归档页搜索关键字变化。
 */
function handleSearchChange(event) {
  state.archive.query = event.target.value.trim();
  void loadArchive();
}

function applyTypeUI() {
  const isTodo = state.archive.type === 'todo';
  const titleText = isTodo ? '待办归档' : '随记归档';
  const emptyText = isTodo ? '待办归档为空' : '随记归档为空';
  const searchPlaceholder = isTodo ? '搜索待办归档...' : '搜索随记归档...';

  $('#archive-title-text').textContent = titleText;
  $('#archive-empty-text').textContent = emptyText;
  $('#archive-search').placeholder = searchPlaceholder;
}

/**
 * 处理归档页中的取消归档和删除操作。
 */
async function handleItemClick(event) {
  const actionTarget = event.target.closest('[data-action]');
  const itemElement = event.target.closest('.archive-item');
  if (!actionTarget || !itemElement) {
    return;
  }
  const itemType = itemElement.dataset.type;
  const itemId = itemElement.dataset.id;
  if (actionTarget.dataset.action === 'restore') {
    if (itemType === 'note') await api.unarchiveNote(itemId);
    if (itemType === 'todo') await api.unarchiveTodo(Number(itemId));
  }
  if (actionTarget.dataset.action === 'delete') {
    if (itemType === 'note') await api.softDeleteNote(itemId);
    if (itemType === 'todo') await api.softDeleteTodo(Number(itemId));
  }
  await deps.refreshCategories();
  await deps.refreshHome();
  await deps.refreshBadges();
  await loadArchive();
}
