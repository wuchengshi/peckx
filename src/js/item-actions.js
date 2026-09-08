import { api } from './api.js';
import { state } from './state.js';
import { showToast } from './utils.js';
import { openCategoryPopover, openDeleteConfirmPopover, openMoreMenuPopover } from './popover.js';

/**
 * 打开条目的更多菜单，并把操作回调统一收口到共享模块。
 */
export function openItemMoreMenu(anchorElement, itemType, itemId, options) {
  openMoreMenuPopover(anchorElement, async (action) => {
    if (action === 'edit') {
      await openItemEditor(itemType, itemId, options);
      return;
    }
    if (action === 'category') {
      await openCategoryEditor(anchorElement, itemType, itemId, options);
      return;
    }
    if (action === 'copy') {
      await copyItemText(itemType, itemId);
      return;
    }
    if (action === 'archive') {
      await archiveItem(itemType, itemId);
      await options.refreshAfterAction?.();
      return;
    }
    if (action === 'delete') {
      openDeleteConfirmPopover(anchorElement, async () => {
        await deleteItem(itemType, itemId);
        await options.refreshAfterAction?.();
      });
    }
  });
}

/**
 * 根据条目类型打开编辑页或抽屉。
 */
export async function openItemDetail(itemType, itemId, options) {
  if (itemType === 'note') {
    await options.openNoteView(itemId);
    return;
  }
  await options.openDrawer(Number(itemId));
}

/**
 * 根据条目类型打开编辑入口。随记进入编辑页，待办继续进入详情抽屉。
 */
async function openItemEditor(itemType, itemId, options) {
  if (itemType === 'note') {
    await options.openEditPage(itemId);
    return;
  }
  await options.openDrawer(Number(itemId));
}

/**
 * 执行列表上的直接动作，例如星标和完成切换。
 */
export async function runQuickAction(itemType, itemId, action, options) {
  if (itemType === 'note') {
    if (action === 'view') {
      await options.openNoteView(itemId);
      return;
    }
    if (action === 'toggle-star') {
      await api.toggleStarNote(itemId);
    }
    if (action === 'more') {
      return;
    }
  }
  if (itemType === 'todo') {
    const todoId = Number(itemId);
    if (action === 'toggle') {
      const todo = await resolveItem('todo', todoId);
      await api.toggleTodo(todoId);
      if (!todo.completed && options.shatterElement) {
        // 顺序：确认后端写入成功后才启动动画，并等待飞散结束再重绘，避免列表刷新中断视觉反馈。
        await playShatterAnimation(options.shatterElement);
      }
    }
    if (action === 'toggle-star') {
      await api.toggleStarTodo(todoId);
    }
    if (action === 'more') {
      return;
    }
  }
  await options.refreshAfterAction?.();
}

/**
 * 将当前条目内容裁切为四块副本，播放完成后的碎片飞散效果。
 */
async function playShatterAnimation(itemElement) {
  if (itemElement.classList.contains('deleting')) {
    return;
  }
  const content = itemElement.querySelector('.item-content');
  if (!content) {
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const position of ['tl', 'tr', 'bl', 'br']) {
    const shard = document.createElement('div');
    shard.className = `shard shard-${position}`;
    const shardContent = document.createElement('div');
    shardContent.className = 'shard-content';
    shardContent.innerHTML = content.innerHTML;
    shard.appendChild(shardContent);
    fragment.appendChild(shard);
  }
  itemElement.classList.add('shatter-item');
  itemElement.appendChild(fragment);
  itemElement.classList.add('deleting');
  await new Promise((resolve) => window.setTimeout(resolve, 500));
}

/**
 * 打开分类编辑弹层并保存到后端。
 */
async function openCategoryEditor(anchorElement, itemType, itemId, options) {
  const item = await resolveItem(itemType, itemId);
  openCategoryPopover(anchorElement, item.category || null, async (value) => {
    if (itemType === 'note') {
      await api.setNoteCategory(itemId, value);
    }
    if (itemType === 'todo') {
      await api.setTodoCategory(Number(itemId), value);
    }
    await options.refreshAfterAction?.();
  });
}

/**
 * 复制条目文本到剪贴板。
 */
async function copyItemText(itemType, itemId) {
  const item = await resolveItem(itemType, itemId);
  const text = itemType === 'note' ? item.content : item.title;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }
  showToast('已复制内容');
}

/**
 * 将条目移入归档。
 */
async function archiveItem(itemType, itemId) {
  if (itemType === 'note') {
    await api.archiveNote(itemId);
    return;
  }
  await api.archiveTodo(Number(itemId));
}

/**
 * 将条目移入垃圾桶。
 */
async function deleteItem(itemType, itemId) {
  if (itemType === 'note') {
    await api.softDeleteNote(itemId);
    return;
  }
  await api.softDeleteTodo(Number(itemId));
}

/**
 * 尝试从当前缓存中解析条目，不存在时再请求后端。
 */
async function resolveItem(itemType, itemId) {
  if (itemType === 'note') {
    const localNote = state.notes.find((item) => item.id === itemId)
      || state.fullList.items.find((item) => item.item_type === 'note' && item.id === itemId);
    if (localNote?.content) {
      return localNote;
    }
    return api.getNote(itemId);
  }
  const numericId = Number(itemId);
  const localTodo = state.todos.find((item) => item.id === numericId)
    || state.fullList.items.find((item) => item.item_type === 'todo' && Number(item.id) === numericId);
  if (localTodo?.title) {
    return localTodo;
  }
  const todos = await api.getTodos();
  return todos.find((item) => item.id === numericId);
}