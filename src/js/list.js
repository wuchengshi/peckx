import { api } from './api.js';
import { $ } from './dom.js';
import { state } from './state.js';
import { renderNoteItem, renderTodoItem, hydrateTrustedImages } from './renderers.js';
import { openEditPage } from './edit.js';
import { openNoteView } from './note-view.js';
import { openDrawer } from './drawer.js';
import { openItemDetail, openItemMoreMenu, runQuickAction } from './item-actions.js';
import { attachListItemInteractions, consumeJustDraggedFlag, resolveListItemZone } from './list-item-zones.js';

const DEFAULT_HOME_PREVIEW_LIMIT = 8;

let deps;

/**
 * 初始化首页列表模块，并绑定点击与双击事件委托。
 */
export function setupHome(options) {
  deps = options;
  $('#home-list')?.addEventListener('click', (event) => {
    void handleListClick(event);
  });
  $('#home-list')?.addEventListener('dblclick', (event) => {
    void handleListDoubleClick(event);
  });
}

/**
 * 加载当前模式对应的首页数据并渲染。
 */
export async function loadHome() {
  if (state.mode === 'note') {
    state.notes = await api.getNotes(false);
    renderHomeNotes();
    return;
  }
  const todos = await api.getTodos();
  // 完成条目已进入独立完成页；首页待办只保留未完成项，避免同一条目在两个页面重复出现。
  state.todos = sortTodos(todos.filter((item) => !item.completed && !item.deleted_at && !item.is_archived));
  renderHomeTodos();
}

/**
 * 渲染首页随记列表。
 */
function renderHomeNotes() {
  const host = $('#home-list');
  const empty = $('#home-empty');
  renderHomeItems(state.notes, renderNoteItem);
  empty.classList.toggle('visible', state.notes.length === 0);
}

/**
 * 渲染首页待办列表。
 */
function renderHomeTodos() {
  const host = $('#home-list');
  const empty = $('#home-empty');
  renderHomeItems(state.todos, renderTodoItem);
  empty.classList.toggle('visible', state.todos.length === 0);
}

/**
 * 首页只展示当前模式下的摘要条目，避免首页过长；完整数据统一进入“全部”页查看。
 */
function renderHomeItems(items, renderItem) {
  const host = $('#home-list');
  const moreButton = $('#btn-home-more');
  const previewLimit = getHomePreviewLimit();
  const previewItems = items.slice(0, previewLimit);
  host.innerHTML = previewItems.map(renderItem).join('');
  attachListItemInteractions(host, {
    disableTodoDoubleZone: state.mode === 'todo',
    hideTodoViewContextAction: state.mode === 'todo',
    openEditPage,
    openDrawer,
    refreshAfterAction,
  });
  void hydrateTrustedImages(host);
  $('#recent-count').textContent = String(items.length);
  if (moreButton) {
    moreButton.hidden = items.length <= previewLimit;
  }
}

/**
 * 首页摘要条数优先使用当前配置，缺失或异常时回退到默认值，避免配置损坏导致首页空白。
 */
function getHomePreviewLimit() {
  const count = Number(state.config?.home_preview_count);
  return Number.isInteger(count) && count > 0 ? count : DEFAULT_HOME_PREVIEW_LIMIT;
}

/**
 * 根据点击目标分发首页列表操作。
 */
async function handleListClick(event) {
  const itemElement = event.target.closest('.list-item');
  if (!itemElement) {
    return;
  }
  if (consumeJustDraggedFlag(itemElement)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  const actionTarget = event.target.closest('[data-action]');
  const itemType = itemElement.dataset.type;
  const itemId = itemElement.dataset.id;
  if (!actionTarget) {
    return;
  }
  const action = actionTarget.dataset.action;
  if (action === 'more') {
    openItemMoreMenu(actionTarget, itemType, itemId, {
      openEditPage,
      openNoteView,
      openDrawer,
      refreshAfterAction,
    });
    return;
  }
  await runQuickAction(itemType, itemId, action, {
    openNoteView,
    refreshAfterAction,
    shatterElement: itemElement,
  });
}

/**
 * 处理首页列表项双击打开详情的行为。
 */
async function handleListDoubleClick(event) {
  const itemElement = event.target.closest('.list-item');
  if (!itemElement || event.target.closest('[data-action]')) {
    return;
  }
  if (consumeJustDraggedFlag(itemElement)) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if (itemElement.dataset.type === 'note') {
    const readOnly = resolveListItemZone(itemElement, event.clientX) === 'left';
    if (readOnly) {
      await openNoteView(itemElement.dataset.id);
      return;
    }
    await openEditPage(itemElement.dataset.id, false);
    return;
  }
  await openDrawer(Number(itemElement.dataset.id), false);
}

/**
 * 刷新列表相关缓存和角标状态。
 */
async function refreshAfterAction() {
  await deps.refreshCategories();
  await deps.refreshHome();
  await deps.refreshBadges();
}

/**
 * 按最小规则对待办做前端排序，保证星标优先、未完成优先、最近更新优先。
 */
function sortTodos(items) {
  return [...items].sort((left, right) => {
    if (left.starred !== right.starred) {
      return Number(right.starred) - Number(left.starred);
    }
    if (left.completed !== right.completed) {
      return Number(left.completed) - Number(right.completed);
    }
    return String(right.updated_at || '').localeCompare(String(left.updated_at || ''));
  });
}
