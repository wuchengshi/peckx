import { api } from './api.js';
import { attachImageInput } from './image-input.js';
import { $, toggleClass } from './dom.js';
import { state } from './state.js';
import { fullTime, showToast } from './utils.js';
import { openCategoryPopover } from './popover.js';

let deps;

/**
 * 初始化编辑页模块，并绑定保存与分类选择逻辑。
 */
export function setupEditPage(options) {
  deps = options;
  $('#edit-back-btn')?.addEventListener('click', closeEditPage);
  $('#edit-save-btn')?.addEventListener('click', () => {
    if (state.editor.readOnly) {
      return;
    }
    void saveEditPage();
  });
  $('#edit-category-btn')?.addEventListener('click', (event) => {
    if (state.editor.readOnly) {
      return;
    }
    openCategoryPopover(event.currentTarget, state.editor.category, (value) => {
      state.editor.category = value;
      renderCategoryButton();
    });
  });
  $('#edit-textarea')?.addEventListener('keydown', (event) => {
    if (state.editor.readOnly) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveEditPage();
    }
  });
  attachImageInput($('#edit-textarea'), {
    isEnabled: () => !state.editor.readOnly,
  });
}

/**
 * 打开指定随记的编辑页。
 */
export async function openEditPage(noteId, readOnly = false) {
  const note = await api.getNote(noteId);
  state.editor.returnView = state.activeView;
  state.editor.noteId = note.id;
  state.editor.category = note.category || null;
  state.editor.readOnly = readOnly;
  const textarea = $('#edit-textarea');
  const saveButton = $('#edit-save-btn');
  const categoryButton = $('#edit-category-btn');
  const title = document.querySelector('.edit-header-title');
  textarea.value = note.content;
  textarea.readOnly = readOnly;
  saveButton.hidden = readOnly;
  categoryButton.disabled = readOnly;
  title.textContent = readOnly ? '查看随记' : '编辑随记';
  $('#edit-meta-time').textContent = `更新于 ${fullTime(note.updated_at || note.created_at)}`;
  renderCategoryButton();
  $('#edit-page').classList.add('visible');
  state.activeView = 'edit';
  if (!readOnly) {
    textarea?.focus();
  }
}

/**
 * 关闭编辑页并回到来源视图。
 */
export function closeEditPage() {
  $('#edit-page').classList.remove('visible');
  state.editor.readOnly = false;
  state.activeView = state.editor.returnView || 'home';
}

/**
 * 保存编辑页中的随记内容和分类。
 */
async function saveEditPage() {
  if (state.editor.readOnly) {
    return;
  }
  const content = $('#edit-textarea').value.trim();
  if (!content) {
    showToast('内容不能为空');
    return;
  }
  await api.updateNote(state.editor.noteId, content);
  await api.setNoteCategory(state.editor.noteId, state.editor.category);
  await deps.refreshCategories();
  await deps.refreshHome();
  await deps.refreshBadges();
  closeEditPage();
}

/**
 * 根据当前分类值刷新编辑页分类按钮。
 */
function renderCategoryButton() {
  const button = $('#edit-category-btn');
  button.textContent = state.editor.category || '未设置';
  toggleClass(button, 'set', Boolean(state.editor.category));
}
