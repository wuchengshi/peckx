import { api } from './api.js';
import { $, toggleClass } from './dom.js';
import { state } from './state.js';
import { formatViewContent, hydrateTrustedImages } from './renderers.js';
import { fullTime } from './utils.js';

/**
 * 初始化随记查看页，并绑定关闭逻辑。
 */
export function setupNoteView() {
  $('#note-view-back-btn')?.addEventListener('click', closeNoteView);
}

/**
 * 打开指定随记的只读查看页。
 */
export async function openNoteView(noteId) {
  const note = await api.getNote(noteId);
  state.noteViewer.returnView = state.activeView;
  state.noteViewer.noteId = note.id;
  // 查看页只渲染只读 HTML 展示，不复用编辑 textarea，避免编辑和展示再次混成同一表面。
  $('#note-view-content').innerHTML = formatViewContent(note.content);
  await hydrateTrustedImages($('#note-view-content'));
  $('#note-view-meta-time').textContent = `更新于 ${fullTime(note.updated_at || note.created_at)}`;
  renderCategory(note.category || null);
  $('#note-view-page').classList.add('visible');
  state.activeView = 'note-view';
}

/**
 * 关闭查看页并回到来源视图。
 */
export function closeNoteView() {
  $('#note-view-page').classList.remove('visible');
  state.activeView = state.noteViewer.returnView || 'home';
}

function renderCategory(category) {
  const value = $('#note-view-category-value');
  value.textContent = category || '未设置';
  toggleClass(value, 'set', Boolean(category));
}