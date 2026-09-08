import { api } from './api.js';
import { attachImageInput } from './image-input.js';
import { $, toggleClass } from './dom.js';
import { state, resetComposerMeta } from './state.js';
import { chipLabel, dueState, normalizeReminderSettings, showToast } from './utils.js';
import { openCategoryPopover, openDueDatePopover, openReminderPopover, openRepeatPopover } from './popover.js';

const NOTE_MAX = 20000;
const TODO_MAX = 200;
const ESCAPE_CLEAR_ARM_MS = 2000;

let deps;
let escapeArmedUntil = 0;

/**
 * 初始化输入区模块，负责模式切换、快捷键、元数据编辑和提交。
 */
export function setupComposer(options) {
  deps = options;
  $('#input-field')?.addEventListener('input', handleInputChange);
  $('#input-field')?.addEventListener('keydown', handleInputKeydown);
  attachImageInput($('#input-field'), {
    isEnabled: () => state.mode === 'note',
    onValueChange: () => {
      normalizeFieldValue();
      updateCharCount();
      autoResize();
    },
  });
  $('#mode-btn-note')?.addEventListener('click', () => setMode('note'));
  $('#mode-btn-todo')?.addEventListener('click', () => setMode('todo'));
  $('#btn-expand')?.addEventListener('click', toggleExpanded);
  $('#chip-category')?.addEventListener('click', openCategorySelector);
  $('#chip-due')?.addEventListener('click', openDueSelector);
  $('#chip-reminder')?.addEventListener('click', openReminderSelector);
  $('#chip-repeat')?.addEventListener('click', openRepeatSelector);
  updateComposerUI();
  updateCharCount();
}

/**
 * 切换输入模式，并按原型规则清空内容和元数据。
 */
export function setMode(mode) {
  if (state.mode === mode) {
    return;
  }
  state.mode = mode;
  escapeArmedUntil = 0;
  $('#input-field').value = '';
  resetComposerMeta();
  updateComposerUI();
  updateCharCount();
  $('#input-field')?.focus();
  void deps.refreshHome();
}

/**
 * 更新输入区的视觉状态、标题和 chip 显示规则。
 */
function updateComposerUI() {
  const field = $('#input-field');
  const metadataBar = $('#metadata-bar');
  const title = $('#recent-title-text');
  const emptyText = $('#home-empty p');
  const expandButton = $('#btn-expand');
  const completedButton = $('#btn-completed-link');
  toggleClass($('#mode-btn-note'), 'active', state.mode === 'note');
  toggleClass($('#mode-btn-todo'), 'active', state.mode === 'todo');
  toggleClass(field, 'todo-mode', state.mode === 'todo');
  toggleClass(metadataBar, 'visible', !state.expanded);
  toggleClass($('#chip-due'), 'hidden', state.mode !== 'todo');
  toggleClass($('#chip-reminder'), 'hidden', state.mode !== 'todo');
  toggleClass($('#chip-repeat'), 'hidden', state.mode !== 'todo');
  if (completedButton) {
    completedButton.hidden = state.mode !== 'todo';
  }
  field.placeholder = state.mode === 'note' ? '写点什么...' : '添加一个待办...';
  title.textContent = state.mode === 'note' ? '当前 · 随记' : '当前 · 待办';
  if (emptyText) {
    emptyText.textContent = state.mode === 'note' ? '还没有随记，开始记录吧' : '还没有待办，添加一个吧';
  }
  if (expandButton) {
    expandButton.title = `${state.expanded ? '缩小' : '展开'}（Shift+Tab）`;
  }
  moveModeHint();
  refreshComposerChips();
  autoResize();
}

/**
 * 刷新四个元数据芯片的状态、文字和危险等级。
 */
function refreshComposerChips() {
  applyChip($('#chip-category'), 'category', state.composer.category);
  applyChip($('#chip-due'), 'due', state.composer.dueDate);
  applyChip($('#chip-reminder'), 'reminder', state.composer.reminders);
  applyChip($('#chip-repeat'), 'repeat', state.composer.repeat);
}

/**
 * 根据当前值更新单个芯片。
 */
function applyChip(element, type, value) {
  if (!element) {
    return;
  }
  const hasValue = Array.isArray(value) ? value.length > 0 : Boolean(value);
  element.querySelector('.chip-label').textContent = chipLabel(type, value);
  element.classList.toggle('set', hasValue);
  element.classList.remove('danger', 'danger-bold');
  if (type !== 'due' || !value) {
    return;
  }
  const currentDue = dueState(value);
  if (currentDue?.tone === 'urgent') {
    element.classList.add('danger');
  }
  if (currentDue?.tone === 'expired') {
    element.classList.add('danger-bold');
  }
}

/**
 * 处理输入框内容变化，并同步限制、字符统计与高度。
 */
function handleInputChange() {
  normalizeFieldValue();
  updateCharCount();
  autoResize();
}

/**
 * 处理输入区快捷键，包括模式切换、提交、拒绝换行和 Escape 双击。
 */
function handleInputKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    void handleEscapeKey();
    return;
  }
  if (event.key === 'Enter' && event.shiftKey && state.mode === 'todo') {
    event.preventDefault();
    shakeField('待办不支持换行');
    return;
  }
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void submitInput();
  }
}

/**
 * 处理 Escape 的两段式清空逻辑。
 */
function handleEscapeKey() {
  const field = $('#input-field');
  const now = Date.now();
  if (!field.value.trim()) {
    escapeArmedUntil = 0;
    return;
  }
  if (now > escapeArmedUntil) {
    escapeArmedUntil = now + ESCAPE_CLEAR_ARM_MS;
    showToast('再按一次 Esc 会清空输入内容');
    return;
  }
  field.value = '';
  escapeArmedUntil = 0;
  updateCharCount();
  autoResize();
  showToast('已清空输入内容');
}

/**
 * 按当前模式更新输入框字符统计和颜色状态。
 */
function updateCharCount() {
  const field = $('#input-field');
  const counter = $('#char-count');
  const max = getCurrentLimit();
  const length = field.value.length;
  counter.textContent = `${length}/${max}`;
  counter.classList.remove('warning', 'limit');
  if (length >= max) {
    counter.classList.add('limit');
    return;
  }
  if (length >= Math.floor(max * 0.9)) {
    counter.classList.add('warning');
  }
}

/**
 * 按当前模式调整输入框高度。
 */
function autoResize() {
  const field = $('#input-field');
  if (!field) {
    return;
  }
  if (state.expanded) {
    field.style.height = '100%';
    return;
  }
  field.style.height = 'auto';
  // 两种模式都允许按宽度软换行并随内容增高；143px 加工具栏约 37px，保持约 180px 总高度上限。
  field.style.height = `${Math.min(field.scrollHeight, 143)}px`;
}

/**
 * 切换输入区展开状态。
 */
export function toggleExpanded() {
  state.expanded = !state.expanded;
  $('#app').classList.toggle('has-expanded-input', state.expanded);
  $('#input-field').classList.toggle('expand-mode', state.expanded);
  updateComposerUI();
}

/**
 * 提交当前输入内容，并在成功后清空输入区。
 */
async function submitInput() {
  const field = $('#input-field');
  const content = field.value.trim();
  if (!content) {
    shakeField('请输入内容');
    return;
  }
  if (state.mode === 'note') {
    await api.createNote(content);
  } else {
    if (state.composer.reminders.length > 0 && !state.composer.dueDate) {
      showToast('请先设置截止时间，再设置提醒');
      return;
    }
    const todo = await api.createTodo(content);
    if (state.composer.category) {
      await api.setTodoCategory(todo.id, state.composer.category);
    }
    if (state.composer.dueDate) {
      await api.setTodoDueDate(todo.id, state.composer.dueDate);
    }
    if (state.composer.reminders.length > 0) {
      await api.setTodoReminders(todo.id, state.composer.reminders);
    }
    if (state.composer.repeat) {
      await api.setTodoRepeat(todo.id, state.composer.repeat);
    }
  }
  field.value = '';
  escapeArmedUntil = 0;
  resetComposerMeta();
  updateComposerUI();
  updateCharCount();
  field.focus();
  await deps.refreshCategories();
  await deps.refreshHome();
  await deps.refreshBadges();
}

/**
 * 通过抖动提示用户当前输入不符合规则。
 */
function shakeField(message) {
  const field = $('#input-field');
  const wrapper = field.closest('.input-wrapper');
  wrapper?.classList.add('shaking');
  showToast(message);
  window.setTimeout(() => wrapper?.classList.remove('shaking'), 220);
}

/**
 * 打开分类选择弹层。
 */
function openCategorySelector(event) {
  openCategoryPopover(event.currentTarget, state.composer.category, async (value) => {
    state.composer.category = value;
    refreshComposerChips();
    await deps.refreshCategories();
  });
}

/**
 * 打开截止时间选择弹层。
 */
function openDueSelector(event) {
  openDueDatePopover(event.currentTarget, state.composer.dueDate, (value) => {
    const hadReminders = state.composer.reminders.length > 0;
    state.composer.dueDate = value;
    if (!value && hadReminders) {
      state.composer.reminders = [];
      showToast('已清除截止时间，提醒已同步取消');
    }
    refreshComposerChips();
  });
}

/**
 * 打开提醒选择弹层。
 */
function openReminderSelector(event) {
  if (!state.composer.dueDate) {
    showToast('请先设置截止时间，再设置提醒');
    return;
  }
  openReminderPopover(event.currentTarget, state.composer.reminders, (value) => {
    state.composer.reminders = normalizeReminderSettings(value);
    refreshComposerChips();
  });
}

/**
 * 打开重复规则选择弹层。
 */
function openRepeatSelector(event) {
  openRepeatPopover(event.currentTarget, state.composer.repeat, (value) => {
    state.composer.repeat = value;
    refreshComposerChips();
  });
}

/**
 * 按当前模式规范输入内容，包括长度限制和待办硬换行限制。
 */
function normalizeFieldValue() {
  const field = $('#input-field');
  const max = getCurrentLimit();
  let nextValue = field.value;
  if (state.mode === 'todo') {
    // 只移除回车或粘贴产生的换行符；宽度不足时的视觉软换行由 textarea 正常保留。
    nextValue = nextValue.replace(/[\r\n]+/g, ' ');
  }
  if (nextValue.length > max) {
    nextValue = nextValue.slice(0, max);
  }
  if (nextValue !== field.value) {
    field.value = nextValue;
  }
}

/**
 * 返回当前模式允许的最大字符数。
 */
function getCurrentLimit() {
  return state.mode === 'note' ? NOTE_MAX : TODO_MAX;
}

/**
 * 让 Tab 提示始终跟在当前非激活按钮后面。
 */
function moveModeHint() {
  const footer = $('.input-footer-bar');
  const hint = $('#mode-hint');
  const inactiveButton = state.mode === 'note' ? $('#mode-btn-todo') : $('#mode-btn-note');
  if (!footer || !hint || !inactiveButton) {
    return;
  }
  footer.insertBefore(hint, inactiveButton.nextSibling);
}