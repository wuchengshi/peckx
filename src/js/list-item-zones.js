import { api } from './api.js';
import { $all } from './dom.js';
import { openCategoryPopover, openReminderPopover } from './popover.js';
import { state } from './state.js';
import { normalizeReminderSettings, showActionToast, showToast } from './utils.js';

const SWIPE_THRESHOLD = 40;
const SWIPE_DELETE_THRESHOLD = 100;
const SWIPE_MAX_DRAG = 140;
const DRAG_BLOCK_WINDOW_MS = 380;

const REVEAL_MARKUP = `
  <div class="swipe-reveal reveal-left" aria-hidden="true"></div>
  <div class="swipe-reveal reveal-right" aria-hidden="true"></div>
`;

const ZONE_MARKUP = `
  <div class="zone-overlay zone-overlay-left" aria-hidden="true"></div>
  <div class="zone-overlay zone-overlay-right" aria-hidden="true"></div>
  <div class="zone-divider" aria-hidden="true"></div>
  <div class="zone-tip zone-tip-left" aria-hidden="true">双击查看</div>
  <div class="zone-tip zone-tip-right" aria-hidden="true">双击编辑</div>
`;

let globalContextBindingsReady = false;

export function attachListItemInteractions(host, options = {}) {
  if (!host) {
    return;
  }
  ensureGlobalContextMenuBindings();
  $all('.list-item', host).forEach((itemElement) => {
    itemElement.__listInteractionOptions = options;
    ensureSwipeStructure(itemElement);
    ensureZoneChrome(itemElement);
    bindZoneHover(itemElement);
    bindSwipeGesture(itemElement);
    bindContextMenu(itemElement);
  });
}

function shouldDisableTodoDoubleZone(itemElement) {
  return itemElement?.dataset.type === 'todo' && itemElement.__listInteractionOptions?.disableTodoDoubleZone === true;
}

export function resolveListItemZone(itemElement, clientX) {
  // 规则固定为 50:50 平分，先判断左区再判断右区，避免整行双击时“查看/编辑”意图混杂。
  const rect = itemElement.getBoundingClientRect();
  const midpoint = rect.left + (rect.width / 2);
  return clientX < midpoint ? 'left' : 'right';
}

export function consumeJustDraggedFlag(itemElement) {
  if (itemElement?.dataset.justDragged !== 'true') {
    return false;
  }
  delete itemElement.dataset.justDragged;
  return true;
}

function ensureSwipeStructure(itemElement) {
  if (itemElement.querySelector('.swipe-content')) {
    return;
  }
  const content = document.createElement('div');
  content.className = 'swipe-content';
  while (itemElement.firstChild) {
    content.appendChild(itemElement.firstChild);
  }
  itemElement.appendChild(content);
  itemElement.insertAdjacentHTML('beforeend', REVEAL_MARKUP);
}

function ensureZoneChrome(itemElement) {
  if (shouldDisableTodoDoubleZone(itemElement)) {
    return;
  }
  const content = itemElement.querySelector('.swipe-content');
  if (!content || content.querySelector('.zone-overlay')) {
    return;
  }
  content.insertAdjacentHTML('beforeend', ZONE_MARKUP);
}

function bindZoneHover(itemElement) {
  if (shouldDisableTodoDoubleZone(itemElement)) {
    clearZoneState(itemElement);
    return;
  }
  if (itemElement.dataset.zoneBound === 'true') {
    return;
  }
  itemElement.dataset.zoneBound = 'true';
  itemElement.addEventListener('mouseenter', (event) => {
    if (isSwipeDragging(itemElement)) {
      return;
    }
    updateZoneState(itemElement, event.clientX);
  });
  itemElement.addEventListener('mousemove', (event) => {
    if (isSwipeDragging(itemElement)) {
      return;
    }
    updateZoneState(itemElement, event.clientX);
  });
  itemElement.addEventListener('mouseleave', () => {
    if (isSwipeDragging(itemElement)) {
      return;
    }
    clearZoneState(itemElement);
  });
}

function bindSwipeGesture(itemElement) {
  if (itemElement.dataset.swipeBound === 'true') {
    return;
  }
  itemElement.dataset.swipeBound = 'true';
  const content = itemElement.querySelector('.swipe-content');
  const revealLeft = itemElement.querySelector('.swipe-reveal.reveal-left');
  const revealRight = itemElement.querySelector('.swipe-reveal.reveal-right');
  if (!content || !revealLeft || !revealRight) {
    return;
  }

  let startX = 0;
  let currentX = 0;
  let dragging = false;
  let dragMoved = false;

  function isInteractiveTarget(event) {
    return Boolean(
      event.target.closest('[data-action]')
      || event.target.closest('.zone-tip')
      || event.target.closest('.item-action-btn')
    );
  }

  function onDown(event) {
    if (event.button !== 0 || isInteractiveTarget(event)) {
      return;
    }
    closeContextMenu();
    dragging = true;
    dragMoved = false;
    startX = event.clientX;
    currentX = 0;
    content.classList.add('dragging');
    content.classList.remove('sliding-out');
    clearZoneState(itemElement);
    hideReveal(revealLeft, revealRight);
    itemElement.classList.add('swiping');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function onMove(event) {
    if (!dragging) {
      return;
    }
    let deltaX = event.clientX - startX;
    if (Math.abs(deltaX) > 3) {
      dragMoved = true;
      event.preventDefault();
    }
    if (!dragMoved) {
      return;
    }
    deltaX = applyDragResistance(deltaX);
    currentX = deltaX;
    content.style.transform = `translateX(${deltaX}px)`;
    updateReveal(itemElement, deltaX, revealLeft, revealRight);
  }

  async function onUp() {
    if (!dragging) {
      return;
    }
    dragging = false;
    content.classList.remove('dragging');
    itemElement.classList.remove('swiping');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);

    if (!dragMoved) {
      resetPosition(content, revealLeft, revealRight);
      return;
    }

    itemElement.dataset.justDragged = 'true';
    window.setTimeout(() => {
      if (itemElement.dataset.justDragged === 'true') {
        delete itemElement.dataset.justDragged;
      }
    }, DRAG_BLOCK_WINDOW_MS);

    const snapshot = getCachedItemSnapshot(itemElement);
    if (!snapshot) {
      resetPosition(content, revealLeft, revealRight);
      return;
    }

    // 规则顺序：先判安全区，再判普通动作阈值，最后判删除阈值。
    // 原因：删除是最重动作，必须只在松手仍停留在删除区时才触发，避免“滑到过删除区”也被误删。
    if (currentX >= SWIPE_THRESHOLD) {
      resetPosition(content, revealLeft, revealRight);
      await toggleStar(snapshot, itemElement);
      return;
    }
    if (currentX <= -SWIPE_DELETE_THRESHOLD) {
      hideReveal(revealLeft, revealRight);
      content.classList.add('sliding-out');
      content.style.transform = 'translateX(-500px)';
      window.setTimeout(() => {
        void softDeleteWithUndo(snapshot, itemElement, {
          content,
          revealLeft,
          revealRight,
        });
      }, 250);
      return;
    }
    if (currentX <= -SWIPE_THRESHOLD) {
      resetPosition(content, revealLeft, revealRight);
      await toggleArchive(snapshot, itemElement);
      return;
    }
    resetPosition(content, revealLeft, revealRight);
  }

  itemElement.addEventListener('mousedown', onDown);
}

function bindContextMenu(itemElement) {
  if (itemElement.dataset.contextMenuBound === 'true') {
    return;
  }
  itemElement.dataset.contextMenuBound = 'true';
  itemElement.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    if (consumeJustDraggedFlag(itemElement) || isSwipeDragging(itemElement)) {
      return;
    }
    const snapshot = getCachedItemSnapshot(itemElement);
    if (!snapshot) {
      return;
    }
    showContextMenu(event.clientX, event.clientY, snapshot, itemElement);
  });
}

function isSwipeDragging(itemElement) {
  return itemElement.querySelector('.swipe-content')?.classList.contains('dragging');
}

function applyDragResistance(deltaX) {
  let nextX = deltaX;
  if (nextX > SWIPE_MAX_DRAG) {
    nextX = SWIPE_MAX_DRAG + ((nextX - SWIPE_MAX_DRAG) * 0.2);
  }
  if (nextX < -SWIPE_MAX_DRAG) {
    nextX = -SWIPE_MAX_DRAG + ((nextX + SWIPE_MAX_DRAG) * 0.2);
  }
  return Math.max(-(SWIPE_MAX_DRAG + 20), Math.min(SWIPE_MAX_DRAG + 20, nextX));
}

function resetPosition(content, revealLeft, revealRight) {
  content.classList.remove('sliding-out');
  content.style.transform = 'translateX(0)';
  window.setTimeout(() => {
    hideReveal(revealLeft, revealRight);
  }, 280);
}

function updateReveal(itemElement, deltaX, revealLeft, revealRight) {
  hideReveal(revealLeft, revealRight);
  const snapshot = getCachedItemSnapshot(itemElement);
  if (!snapshot) {
    return;
  }
  if (deltaX > 0) {
    revealLeft.className = 'swipe-reveal reveal-left star';
    revealLeft.innerHTML = `<span class="ricon">★</span><span>${snapshot.starred ? '取消收藏' : '收藏'}</span>`;
    if (deltaX >= SWIPE_THRESHOLD) {
      revealLeft.style.opacity = '1';
      revealLeft.classList.add('threshold-reached');
      return;
    }
    revealLeft.style.opacity = String((deltaX / SWIPE_THRESHOLD) * 0.5);
    return;
  }
  if (deltaX < 0) {
    const distance = Math.abs(deltaX);
    if (distance >= SWIPE_DELETE_THRESHOLD) {
      revealRight.className = 'swipe-reveal reveal-right delete';
      revealRight.innerHTML = '<span class="ricon">🗑</span><span>删除</span>';
      revealRight.style.opacity = '1';
      revealRight.classList.add('threshold-reached');
      return;
    }
    revealRight.className = 'swipe-reveal reveal-right archive';
    revealRight.innerHTML = `<span class="ricon">📦</span><span>${snapshot.archived ? '取消归档' : '归档'}</span>`;
    if (distance >= SWIPE_THRESHOLD) {
      revealRight.style.opacity = '1';
      revealRight.classList.add('threshold-reached');
      return;
    }
    revealRight.style.opacity = String((distance / SWIPE_THRESHOLD) * 0.5);
  }
}

function hideReveal(revealLeft, revealRight) {
  revealLeft.style.opacity = '0';
  revealRight.style.opacity = '0';
  revealLeft.classList.remove('threshold-reached');
  revealRight.classList.remove('threshold-reached');
}

function updateZoneState(itemElement, clientX) {
  const zone = resolveListItemZone(itemElement, clientX);
  itemElement.classList.add('zone-hover');
  itemElement.classList.toggle('zone-left', zone === 'left');
  itemElement.classList.toggle('zone-right', zone === 'right');
}

function clearZoneState(itemElement) {
  itemElement.classList.remove('zone-hover', 'zone-left', 'zone-right');
}

function getCachedItemSnapshot(itemElement) {
  const itemType = itemElement.dataset.type;
  const rawId = itemElement.dataset.id;
  if (!itemType || !rawId) {
    return null;
  }
  if (itemType === 'note') {
    const note = state.notes.find((item) => String(item.id) === rawId)
      || state.fullList.items.find((item) => item.item_type === 'note' && String(item.id) === rawId);
    return {
      itemType,
      itemId: rawId,
      starred: Boolean(note?.starred),
      archived: Boolean(note?.archived_at || note?.is_archived),
      category: note?.category || null,
      content: note?.content || '',
    };
  }
  const numericId = Number(rawId);
  const todo = state.todos.find((item) => item.id === numericId)
    || state.fullList.items.find((item) => item.item_type === 'todo' && Number(item.id) === numericId);
  return {
    itemType,
    itemId: numericId,
    starred: Boolean(todo?.starred),
    archived: Boolean(todo?.archived_at || todo?.is_archived),
    category: todo?.category || null,
    dueDate: todo?.due_date || null,
    reminders: todo?.reminders || [],
    title: todo?.title || todo?.content || '',
  };
}

async function resolveItemDetails(snapshot) {
  if (snapshot.itemType === 'note') {
    if (snapshot.content) {
      return snapshot;
    }
    const note = await api.getNote(snapshot.itemId);
    return {
      ...snapshot,
      starred: Boolean(note?.starred),
      category: note?.category || null,
      content: note?.content || '',
    };
  }
  if (snapshot.title || snapshot.category || snapshot.dueDate || (Array.isArray(snapshot.reminders) && snapshot.reminders.length > 0)) {
    return snapshot;
  }
  const todos = await api.getTodos();
  const todo = todos.find((item) => item.id === snapshot.itemId);
  return {
    ...snapshot,
    starred: Boolean(todo?.starred),
    category: todo?.category || null,
    dueDate: todo?.due_date || null,
    reminders: todo?.reminders || [],
    title: todo?.title || '',
  };
}

async function toggleStar(snapshot, itemElement) {
  try {
    if (snapshot.itemType === 'note') {
      await api.toggleStarNote(snapshot.itemId);
    } else {
      await api.toggleStarTodo(snapshot.itemId);
    }
    await itemElement.__listInteractionOptions?.refreshAfterAction?.();
  } catch (error) {
    console.error('toggle star failed', error);
    showToast('收藏状态更新失败');
  }
}

async function toggleArchive(snapshot, itemElement) {
  try {
    if (snapshot.itemType === 'note') {
      if (snapshot.archived) {
        await api.unarchiveNote(snapshot.itemId);
      } else {
        await api.archiveNote(snapshot.itemId);
      }
    } else if (snapshot.archived) {
      await api.unarchiveTodo(snapshot.itemId);
    } else {
      await api.archiveTodo(snapshot.itemId);
    }
    await itemElement.__listInteractionOptions?.refreshAfterAction?.();
  } catch (error) {
    console.error('toggle archive failed', error);
    showToast('归档状态更新失败');
  }
}

async function softDeleteWithUndo(snapshot, itemElement, ui) {
  try {
    if (snapshot.itemType === 'note') {
      await api.softDeleteNote(snapshot.itemId);
    } else {
      await api.softDeleteTodo(snapshot.itemId);
    }
    await itemElement.__listInteractionOptions?.refreshAfterAction?.();
    showActionToast('已移至回收站', '撤销', async () => {
      if (snapshot.itemType === 'note') {
        await api.restoreNote(snapshot.itemId);
      } else {
        await api.restoreTodo(snapshot.itemId);
      }
      await itemElement.__listInteractionOptions?.refreshAfterAction?.();
      showToast('已恢复');
    }, 5000);
  } catch (error) {
    console.error('soft delete failed', error);
    ui.content.classList.remove('sliding-out');
    ui.content.style.transform = 'translateX(0)';
    hideReveal(ui.revealLeft, ui.revealRight);
    showToast('删除失败');
  }
}

function ensureGlobalContextMenuBindings() {
  if (globalContextBindingsReady) {
    return;
  }
  globalContextBindingsReady = true;
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.context-menu')) {
      closeContextMenu();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeContextMenu();
    }
  });
  document.addEventListener('scroll', closeContextMenu, true);
  window.addEventListener('resize', closeContextMenu);
}

function showContextMenu(clientX, clientY, snapshot, itemElement) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  const isTodo = snapshot.itemType === 'todo';
  const hideTodoViewContextAction = isTodo && itemElement.__listInteractionOptions?.hideTodoViewContextAction === true;
  const menuItems = [];
  // 规则：待办列表统一移除查看入口，并把双击统一收口为编辑，避免待办继续暴露查看/编辑两套并行心智。
  // 原因：随记仍需要“查看 Markdown 渲染”和“编辑”两种表面，不能复用到待办上一起删掉。
  if (!hideTodoViewContextAction) {
    menuItems.push(createMenuAction('view', eyeIcon(), '查看'));
  }
  menuItems.push(createMenuAction('edit', editIcon(), '编辑'));
  menuItems.push({ divider: true });
  menuItems.push(createMenuAction('star', starIcon(), snapshot.starred ? '取消收藏' : '收藏'));
  menuItems.push(createMenuAction('archive', archiveIcon(), snapshot.archived ? '取消归档' : '归档'));
  if (isTodo) {
    menuItems.push({ divider: true });
    menuItems.push(createMenuAction('today', todayIcon(), '设为今日'));
    menuItems.push(createMenuAction('reminder', reminderIcon(), '设置提醒'));
  }
  menuItems.push({ divider: true });
  menuItems.push(createMenuAction('category', tagIcon(), '更改分类'));
  menuItems.push(createMenuAction('copy', copyIcon(), '复制内容'));
  menuItems.push({ divider: true });
  menuItems.push(createMenuAction('delete', trashIcon(), '删除', true));

  menuItems.forEach((item) => {
    if (item.divider) {
      const divider = document.createElement('div');
      divider.className = 'context-menu-divider';
      menu.appendChild(divider);
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `context-menu-item${item.danger ? ' danger' : ''}`;
    button.innerHTML = `${item.icon}<span>${item.label}</span>`;
    button.addEventListener('click', () => {
      void handleContextMenuAction(item.action, snapshot, itemElement, button);
    });
    menu.appendChild(button);
  });

  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const left = Math.min(clientX, window.innerWidth - rect.width - 8);
  const top = Math.min(clientY, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  requestAnimationFrame(() => {
    menu.classList.add('visible');
  });
}

async function handleContextMenuAction(action, snapshot, itemElement, buttonElement) {
  const options = itemElement.__listInteractionOptions || {};
  if (action === 'view') {
    closeContextMenu();
    await openItem(snapshot, true, options);
    return;
  }
  if (action === 'edit') {
    closeContextMenu();
    await openItem(snapshot, false, options);
    return;
  }
  if (action === 'star') {
    closeContextMenu();
    await toggleStar(snapshot, itemElement);
    return;
  }
  if (action === 'archive') {
    closeContextMenu();
    await toggleArchive(snapshot, itemElement);
    return;
  }
  if (action === 'today') {
    closeContextMenu();
    await api.setTodoDueDate(snapshot.itemId, endOfToday());
    await options.refreshAfterAction?.();
    showToast('已设为今日');
    return;
  }
  if (action === 'reminder') {
    const details = await resolveItemDetails(snapshot);
    if (!details.dueDate) {
      closeContextMenu();
      showToast('请先设置截止时间，再设置提醒');
      return;
    }
    const anchor = createVirtualAnchor(buttonElement.getBoundingClientRect());
    closeContextMenu();
    openReminderPopover(anchor, normalizeReminderSettings(details.reminders), async (value) => {
      await api.setTodoReminders(snapshot.itemId, value);
      await options.refreshAfterAction?.();
    });
    anchor.remove();
    return;
  }
  if (action === 'category') {
    const details = await resolveItemDetails(snapshot);
    const anchor = createVirtualAnchor(buttonElement.getBoundingClientRect());
    closeContextMenu();
    openCategoryPopover(anchor, details.category || null, async (value) => {
      if (snapshot.itemType === 'note') {
        await api.setNoteCategory(snapshot.itemId, value);
      } else {
        await api.setTodoCategory(snapshot.itemId, value);
      }
      await options.refreshAfterAction?.();
    });
    anchor.remove();
    return;
  }
  if (action === 'copy') {
    const details = await resolveItemDetails(snapshot);
    closeContextMenu();
    await copyItemText(snapshot.itemType === 'note' ? details.content : details.title);
    return;
  }
  if (action === 'delete') {
    closeContextMenu();
    await softDeleteWithUndo(snapshot, itemElement, {
      content: itemElement.querySelector('.swipe-content'),
      revealLeft: itemElement.querySelector('.swipe-reveal.reveal-left'),
      revealRight: itemElement.querySelector('.swipe-reveal.reveal-right'),
    });
  }
}

async function openItem(snapshot, readOnly, options) {
  if (snapshot.itemType === 'note') {
    await options.openEditPage?.(snapshot.itemId, readOnly);
    return;
  }
  await options.openDrawer?.(snapshot.itemId, readOnly);
}

function createVirtualAnchor(rect) {
  const anchor = document.createElement('div');
  anchor.style.position = 'fixed';
  anchor.style.left = `${rect.left}px`;
  anchor.style.top = `${rect.bottom}px`;
  anchor.style.width = '1px';
  anchor.style.height = '1px';
  anchor.style.pointerEvents = 'none';
  anchor.style.opacity = '0';
  document.body.appendChild(anchor);
  return anchor;
}

async function copyItemText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text || '');
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text || '';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  showToast('已复制内容');
}

function endOfToday() {
  const date = new Date();
  date.setHours(23, 59, 0, 0);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function closeContextMenu() {
  document.querySelector('.context-menu')?.remove();
}

function createMenuAction(action, icon, label, danger = false) {
  return { action, icon, label, danger };
}

function eyeIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M1 8C1 8 4 3 8 3C12 3 15 8 15 8C15 8 12 13 8 13C4 13 1 8 1 8Z"/><circle cx="8" cy="8" r="2"/></svg>';
}

function editIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M11 2L14 5L5 14L2 14L2 11L11 2Z" stroke-linejoin="round"/></svg>';
}

function starIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1L10 5.5L15 6L11.5 9.5L12.5 14.5L8 12L3.5 14.5L4.5 9.5L1 6L6 5.5L8 1Z" stroke-linejoin="round"/></svg>';
}

function archiveIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>';
}

function todayIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="11" rx="1.5"/><line x1="2" y1="6" x2="14" y2="6" stroke-linecap="round"/><line x1="5" y1="1.5" x2="5" y2="4" stroke-linecap="round"/><line x1="11" y1="1.5" x2="11" y2="4" stroke-linecap="round"/><circle cx="8" cy="10" r="1.5" fill="currentColor" stroke="none"/></svg>';
}

function reminderIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 6C3 3.5 5 2 8 2C11 2 13 3.5 13 6V9L14 11H2L3 9V6Z" stroke-linejoin="round"/><path d="M6 11C6 12 7 13 8 13C9 13 10 12 10 11" stroke-linecap="round"/></svg>';
}

function tagIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 3H8L13 8L8 13L3 8V3Z" stroke-linejoin="round"/><circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none"/></svg>';
}

function copyIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke-linejoin="round"/><path d="M3 11V3C3 2.5 3.5 2 4 2H10" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}

function trashIcon() {
  return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4.5H13M6.5 4.5V3.5C6.5 3 6.7 2.8 7.1 2.8H8.9C9.3 2.8 9.5 3 9.5 3.5V4.5M5 4.5L5.5 13C5.5 13.4 5.8 13.6 6.2 13.6H9.8C10.2 13.6 10.5 13.4 10.5 13L11 4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}