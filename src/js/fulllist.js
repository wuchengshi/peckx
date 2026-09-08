import { api } from './api.js';
import { $, $all } from './dom.js';
import { state } from './state.js';
import { debounce, sortCategories } from './utils.js';
import { renderAllItem, renderPagination, hydrateTrustedImages } from './renderers.js';
import { openEditPage } from './edit.js';
import { openNoteView } from './note-view.js';
import { openDrawer } from './drawer.js';
import { openItemDetail, openItemMoreMenu, runQuickAction } from './item-actions.js';
import { attachListItemInteractions, consumeJustDraggedFlag, resolveListItemZone } from './list-item-zones.js';

let deps;

/**
 * 初始化全列表模块，并绑定搜索、筛选、点击和双击事件。
 */
export function setupFullList(options) {
  deps = options;
  $('#flp-back-btn')?.addEventListener('click', closeFullList);
  $('#flp-search')?.addEventListener('input', debounce(handleSearchChange, 200));
  $('#flp-cat-more-btn')?.addEventListener('click', toggleCategoryDropdown);
  $('#flp-list')?.addEventListener('click', (event) => {
    void handleItemClick(event);
  });
  $('#flp-list')?.addEventListener('dblclick', (event) => {
    void handleItemDoubleClick(event);
  });
  $('#flp-pagination')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button) {
      return;
    }
    state.fullList.page = Number(button.dataset.page);
    renderFullList();
  });
}

/**
 * 打开全列表页面并加载数据。
 */
export async function openFullList() {
  state.activeView = 'full-list';
  $('#full-list-page').classList.add('visible');
  updateFullListTitle();
  await loadFullList();
  window.addEventListener('resize', scheduleCategoryLayout);
}

/**
 * 关闭全列表页面。
 */
export function closeFullList() {
  state.activeView = 'home';
  $('#full-list-page').classList.remove('visible');
  closeCategoryDropdown();
  window.removeEventListener('resize', scheduleCategoryLayout);
}

/**
 * 加载全列表数据，并在前端执行分类过滤和分页。
 */
async function loadFullList() {
  const result = await api.getAllItems(state.fullList.query || null, 1, 5000);
  const modeItems = filterByMode(result.items);
  state.fullList.items = filterByCategory(modeItems, state.fullList.category);
  state.fullList.total = state.fullList.items.length;
  renderCategoryBar();
  renderFullList();
}

/**
 * 渲染全列表当前页。
 */
function renderFullList() {
  const pageSize = state.fullList.pageSize;
  const totalPages = Math.max(1, Math.ceil(state.fullList.total / pageSize));
  if (state.fullList.page > totalPages) {
    state.fullList.page = totalPages;
  }
  const start = (state.fullList.page - 1) * pageSize;
  const end = start + pageSize;
  const current = state.fullList.items.slice(start, end);
  const itemLabel = currentModeLabel();
  $('#flp-list').innerHTML = current.map(renderAllItem).join('');
  attachListItemInteractions($('#flp-list'), {
    disableTodoDoubleZone: state.mode === 'todo',
    hideTodoViewContextAction: state.mode === 'todo',
    openEditPage,
    openDrawer,
    refreshAfterAction,
  });
  void hydrateTrustedImages($('#flp-list'));
  $('#flp-list').style.display = current.length === 0 ? 'none' : '';
  $('#flp-empty').style.display = current.length === 0 ? 'flex' : 'none';
  $('#flp-empty p').textContent = state.fullList.query
    ? `没有找到“${state.fullList.query}”相关${itemLabel}`
    : `暂无${itemLabel}`;
  $('#flp-pagination').innerHTML = renderPagination(state.fullList.page, totalPages);
}

/**
 * 根据当前输入模式更新全列表标题，避免“全部”页和首页模式不一致。
 */
function updateFullListTitle() {
  const title = $('.flp-title span');
  if (!title) {
    return;
  }
  title.textContent = state.mode === 'todo' ? '当前待办' : '当前随记';
}

/**
 * 返回当前全列表对应的中文类型名。
 */
function currentModeLabel() {
  return state.mode === 'todo' ? '待办' : '随记';
}

/**
 * 渲染全列表分类筛选条。
 */
function renderCategoryBar() {
  const categories = [''].concat(sortCategories(state.categories));
  $('#flp-category-bar').innerHTML = categories.map((item) => `
    <span class="flp-category-chip ${state.fullList.category === item ? 'active' : ''}" data-category="${item}">${item || '全部'}</span>
  `).join('');
  $('#flp-cat-dropdown').innerHTML = categories.map((item) => `
    <div class="flp-drop-item ${state.fullList.category === item ? 'active' : ''}" data-category="${item}">${item || '全部'}</div>
  `).join('');
  bindCategorySelection('.flp-category-chip', $('#flp-category-bar'));
  bindCategorySelection('.flp-drop-item', $('#flp-cat-dropdown'));
  scheduleCategoryLayout();
}

/**
 * 绑定分类点击事件，统一筛选栏与下拉面板的行为。
 */
function bindCategorySelection(selector, host) {
  $all(selector, host).forEach((element) => {
    element.addEventListener('click', () => {
      state.fullList.category = element.dataset.category || '';
      state.fullList.page = 1;
      closeCategoryDropdown();
      loadFullList().catch(() => {});
    });
  });
}

/**
 * 根据容器宽度决定可见分类和溢出分类，模拟原型的 V 折叠方案。
 */
function scheduleCategoryLayout() {
  window.requestAnimationFrame(applyCategoryLayout);
}

/**
 * 测量分类条宽度，并把放不下的项移入下拉面板。
 */
function applyCategoryLayout() {
  const bar = $('#flp-category-bar');
  const moreButton = $('#flp-cat-more-btn');
  const dropdown = $('#flp-cat-dropdown');
  if (!bar || !moreButton || !dropdown) {
    return;
  }
  const chips = $all('.flp-category-chip', bar);
  chips.forEach((chip) => {
    chip.style.display = 'inline-flex';
  });
  const availableWidth = bar.clientWidth - 36;
  let usedWidth = 0;
  let hasOverflow = false;
  chips.forEach((chip, index) => {
    usedWidth += chip.offsetWidth + (index > 0 ? 6 : 0);
    const mustKeep = chip.classList.contains('active') || index === 0;
    if (!mustKeep && usedWidth > availableWidth) {
      chip.style.display = 'none';
      hasOverflow = true;
    }
  });
  moreButton.classList.toggle('visible', hasOverflow);
  if (!hasOverflow) {
    closeCategoryDropdown();
  }
}

/**
 * 切换分类溢出下拉面板。
 */
function toggleCategoryDropdown() {
  const button = $('#flp-cat-more-btn');
  const dropdown = $('#flp-cat-dropdown');
  const willOpen = !dropdown.classList.contains('open');
  button.classList.toggle('open', willOpen);
  dropdown.classList.toggle('open', willOpen);
}

/**
 * 关闭分类溢出下拉面板。
 */
function closeCategoryDropdown() {
  $('#flp-cat-more-btn')?.classList.remove('open');
  $('#flp-cat-dropdown')?.classList.remove('open');
}

/**
 * 处理全列表搜索关键字变化。
 */
function handleSearchChange(event) {
  state.fullList.query = event.target.value.trim();
  state.fullList.page = 1;
  void loadFullList();
}

/**
 * 处理全列表中的卡片点击与快捷操作。
 */
async function handleItemClick(event) {
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
  if (!actionTarget) {
    return;
  }
  const itemType = itemElement.dataset.type;
  const itemId = itemElement.dataset.id;
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
 * 处理全列表条目的双击打开行为。
 */
async function handleItemDoubleClick(event) {
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
 * 刷新全列表依赖的数据和角标状态。
 */
async function refreshAfterAction() {
  await deps.refreshCategories();
  await deps.refreshHome();
  await deps.refreshBadges();
  await loadFullList();
}

/**
 * 由于后端没有分类筛选接口，这里先获取完整结果再在前端做最小过滤。
 */
function filterByCategory(items, category) {
  if (!category) {
    return items;
  }
  return items.filter((item) => item.category === category);
}

/**
 * “全部”页仍跟随首页当前输入模式，不做 note/todo 混合，避免入口模式和列表结果不一致。
 */
function filterByMode(items) {
  const currentType = state.mode === 'todo' ? 'todo' : 'note';
  return items.filter((item) => item.item_type === currentType);
}
