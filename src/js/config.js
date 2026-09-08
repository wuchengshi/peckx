import { api } from './api.js';
import { $ } from './dom.js';
import { state } from './state.js';
import { refreshTrashView } from './trash.js';
import { isTauri, showToast } from './utils.js';

let currentConfig = null;
let deps = {};
let testingEmail = false;

const DEFAULT_CONFIG = Object.freeze({
  auto_start: false,
  shortcut_toggle: 'Alt+X',
  completed_retention_days: 7,
  trash_retention_days: 7,
  home_preview_count: 8,
  notification_email: '',
  notification_phone: '',
});

/**
 * 初始化配置页模块，绑定返回按钮和所有设置项的事件。
 */
export function setupConfig(options = {}) {
  deps = options;
  $('#config-back-btn')?.addEventListener('click', closeConfig);
  $('#cfg-auto-start')?.addEventListener('change', toggleAutoStart);
  $('#cfg-shortcut-save-btn')?.addEventListener('click', () => {
    void handleShortcutSave();
  });
  $('#cfg-shortcut-input')?.addEventListener('keydown', (event) => {
    handleShortcutKeydown(event);
  });
  $('#cfg-retention')?.addEventListener('change', handleRetentionChange);
  $('#cfg-completed-retention')?.addEventListener('change', handleCompletedRetentionChange);
  $('#cfg-preview-count')?.addEventListener('change', handlePreviewCountChange);
  $('#cfg-email')?.addEventListener('change', handleEmailChange);
  $('#cfg-phone')?.addEventListener('change', handlePhoneChange);
  $('#cfg-email-test-btn')?.addEventListener('click', () => {
    void handleTestEmail();
  });
}

/**
 * 加载运行时配置，并把依赖配置的界面同步到最新状态。
 */
export async function loadRuntimeConfig() {
  currentConfig = normalizeConfig(await api.getConfig().catch(() => DEFAULT_CONFIG));
  const actualAutoStart = await resolveAutoStartState(currentConfig.auto_start);
  const autoStartChanged = actualAutoStart !== currentConfig.auto_start;
  currentConfig.auto_start = actualAutoStart;
  syncConfigState();
  applyConfigControls();
  applyConfigDependentUi();
  if (autoStartChanged) {
    await saveConfig();
  }
  await loadAppVersion();
  return currentConfig;
}

/**
 * 打开配置页，加载当前配置。
 */
export async function openConfig() {
  state.activeView = 'config';
  $('#config-page').classList.add('visible');
  await loadRuntimeConfig();
}

/**
 * 关闭配置页。
 */
export function closeConfig() {
  $('#config-page').classList.remove('visible');
  state.activeView = 'home';
}

/**
 * 从后端加载配置并填充 UI。
 */
function applyConfigControls() {
  $('#cfg-auto-start').checked = Boolean(currentConfig.auto_start);
  setShortcutInputValue(currentConfig.shortcut_toggle || DEFAULT_CONFIG.shortcut_toggle);
  $('#cfg-completed-retention').value = String(currentConfig.completed_retention_days);
  $('#cfg-retention').value = String(currentConfig.trash_retention_days);
  $('#cfg-preview-count').value = String(currentConfig.home_preview_count);
  $('#cfg-email').value = currentConfig.notification_email || '';
  $('#cfg-phone').value = currentConfig.notification_phone || '';
}

/**
 * 切换开机自启动。
 */
async function toggleAutoStart() {
  const enabled = $('#cfg-auto-start').checked;
  try {
    currentConfig.auto_start = await api.setAutoStartEnabled(enabled);
    syncConfigState();
    await saveConfig();
    applyConfigControls();
    showToast(currentConfig.auto_start ? '已开启开机自启动' : '已关闭开机自启动');
  } catch (err) {
    // 失败时回退到已知配置状态，避免界面显示和真实状态漂移。
    applyConfigControls();
    showToast(`开机自启动设置失败：${formatErrorMessage(err)}`);
  }
}

/**
 * 保存新的全局快捷键配置，并立即让桌面端重注册。
 */
async function handleShortcutSave() {
  const input = $('#cfg-shortcut-input');
  const nextShortcut = String(input?.dataset.shortcutValue || '').trim();
  if (!nextShortcut) {
    showToast('请输入快捷键，例如 Alt+X');
    applyConfigControls();
    return;
  }

  try {
    currentConfig = normalizeConfig(await api.setShortcutToggle(nextShortcut));
    syncConfigState();
    applyConfigControls();
    showToast(`快捷键已更新为 ${currentConfig.shortcut_toggle}`);
  } catch (err) {
    applyConfigControls();
    showToast(`快捷键保存失败：${formatErrorMessage(err)}`);
  }
}

/**
 * 垃圾桶保留天数变更后立即落盘并刷新相关界面。
 */
async function handleRetentionChange() {
  const days = Number($('#cfg-retention').value);
  if (days >= 1) {
    currentConfig.trash_retention_days = days;
    syncConfigState();
    applyConfigDependentUi();
    await saveConfig();
    await api.cleanExpiredTrash(days).catch(() => {});
    await deps.refreshBadges?.();
    await deps.refreshHome?.();
    if (state.activeView === 'trash') {
      await refreshTrashView();
    }
  }
}

/**
 * 完成待办保留天数变更后立即落盘并转移已到期条目。
 */
async function handleCompletedRetentionChange() {
  const days = Number($('#cfg-completed-retention').value);
  if (days >= 1) {
    currentConfig.completed_retention_days = days;
    syncConfigState();
    await saveConfig();
    await api.moveExpiredCompletedTodosToTrash(days).catch(() => {});
    await deps.refreshCategories?.();
    await deps.refreshBadges?.();
    await deps.refreshHome?.();
    await deps.refreshCompleted?.();
  }
}

/**
 * 处理首页显示条数变更。
 */
async function handlePreviewCountChange() {
  const count = Number($('#cfg-preview-count').value);
  if (count >= 1) {
    currentConfig.home_preview_count = count;
    syncConfigState();
    await saveConfig();
    await deps.refreshHome?.();
  }
}

/**
 * 保存配置到后端。
 */
async function saveConfig() {
  await api.setConfig(currentConfig);
}

/**
 * 合并默认值并修正异常配置，保证老配置文件或损坏配置仍能安全运行。
 */
function normalizeConfig(config) {
  const nextConfig = { ...DEFAULT_CONFIG, ...(config || {}) };
  nextConfig.shortcut_toggle = String(nextConfig.shortcut_toggle || DEFAULT_CONFIG.shortcut_toggle).trim() || DEFAULT_CONFIG.shortcut_toggle;
  nextConfig.completed_retention_days = normalizePositiveInteger(nextConfig.completed_retention_days, DEFAULT_CONFIG.completed_retention_days);
  nextConfig.trash_retention_days = normalizePositiveInteger(nextConfig.trash_retention_days, DEFAULT_CONFIG.trash_retention_days);
  nextConfig.home_preview_count = normalizePositiveInteger(nextConfig.home_preview_count, DEFAULT_CONFIG.home_preview_count);
  nextConfig.auto_start = Boolean(nextConfig.auto_start);
  nextConfig.notification_email = String(nextConfig.notification_email || '').trim();
  nextConfig.notification_phone = String(nextConfig.notification_phone || '').trim();
  return nextConfig;
}

async function handleEmailChange() {
  const email = String($('#cfg-email').value || '').trim();
  if (email && !isValidEmail(email)) {
    showToast('邮箱格式不正确');
    applyConfigControls();
    return;
  }
  currentConfig.notification_email = email;
  syncConfigState();
  await saveConfig();
}

async function handlePhoneChange() {
  const phone = String($('#cfg-phone').value || '').trim();
  if (phone && !isValidPhone(phone)) {
    showToast('手机号格式不正确');
    applyConfigControls();
    return;
  }
  currentConfig.notification_phone = phone;
  syncConfigState();
  await saveConfig();
}

async function handleTestEmail() {
  if (testingEmail) {
    return;
  }
  testingEmail = true;
  updateTestEmailButton();
  try {
    const message = await api.sendTestEmail();
    showToast(message || '测试邮件已发送，请检查邮箱');
  } catch (err) {
    showToast(`测试邮件发送失败：${formatErrorMessage(err)}`);
  } finally {
    testingEmail = false;
    updateTestEmailButton();
  }
}

/**
 * 同步运行时配置缓存，确保首页摘要、垃圾桶说明等依赖配置的界面读取的是同一份状态。
 */
function syncConfigState() {
  state.config = { ...currentConfig };
}

/**
 * 更新依赖配置的界面文案，避免“配置已保存但界面仍显示旧值”。
 */
function applyConfigDependentUi() {
  const retentionText = $('#trash-retention-text');
  if (retentionText) {
    retentionText.textContent = `垃圾桶 · ${currentConfig.trash_retention_days}天后自动清理`;
  }
  updateTestEmailButton();
}

function updateTestEmailButton() {
  const button = $('#cfg-email-test-btn');
  if (!button) {
    return;
  }
  button.disabled = testingEmail;
  button.textContent = testingEmail ? '发送中...' : '发送测试邮件';
}

/**
 * 优先读取插件返回的开机自启动真实状态；插件不可用时回退到本地配置，避免浏览器预览或插件异常导致配置页不可用。
 */
async function resolveAutoStartState(fallbackValue) {
  try {
    return await api.getAutoStartEnabled();
  } catch (err) {
    return Boolean(fallbackValue);
  }
}

/**
 * 加载桌面端版本号，失败时保留静态占位文本。
 */
async function loadAppVersion() {
  const versionNode = $('#cfg-app-version');
  if (!versionNode || !window.__TAURI_INTERNALS__) {
    return;
  }
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    versionNode.textContent = `v${await getVersion()}`;
  } catch (err) {
    // 保留 HTML 中的默认版本文本
  }
}

/**
 * 把配置项归一化为正整数，防止配置损坏后影响运行。
 */
function normalizePositiveInteger(value, fallbackValue) {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
}

/**
 * 在输入框中以可读格式展示快捷键，同时保留后端保存所需的规范格式。
 */
function setShortcutInputValue(shortcut) {
  const input = $('#cfg-shortcut-input');
  if (!input) {
    return;
  }
  const normalizedShortcut = normalizeShortcutValue(shortcut);
  input.dataset.shortcutValue = normalizedShortcut;
  input.value = formatShortcutDisplay(normalizedShortcut);
}

/**
 * 聚焦输入框后直接捕获按键组合；先收集修饰键，再在用户按下主键时一次性生成快捷键。
 */
function handleShortcutKeydown(event) {
  event.preventDefault();
  event.stopPropagation();

  if (event.key === 'Enter') {
    void handleShortcutSave();
    return;
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    setShortcutInputValue(DEFAULT_CONFIG.shortcut_toggle);
    return;
  }

  const shortcut = buildShortcutFromEvent(event);
  if (!shortcut) {
    return;
  }
  setShortcutInputValue(shortcut);
}

/**
 * 把键盘事件转换为插件可识别的快捷键字符串。
 */
function buildShortcutFromEvent(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Meta');

  const mainKey = normalizeMainKey(event.key);
  if (!mainKey) {
    if (modifiers.length === 0) {
      return null;
    }
    return modifiers.join('+');
  }

  return [...modifiers, mainKey].join('+');
}

/**
 * 过滤纯修饰键，并把主键名归一化到后端和插件通用的格式。
 */
function normalizeMainKey(key) {
  const text = String(key || '').trim();
  if (!text) {
    return null;
  }

  const upperText = text.toUpperCase();
  if (['CONTROL', 'CTRL', 'SHIFT', 'ALT', 'META'].includes(upperText)) {
    return null;
  }
  if (upperText === ' ') {
    return 'Space';
  }
  if (upperText === 'ESCAPE') {
    return 'Esc';
  }
  if (upperText === 'ARROWUP') return 'Up';
  if (upperText === 'ARROWDOWN') return 'Down';
  if (upperText === 'ARROWLEFT') return 'Left';
  if (upperText === 'ARROWRIGHT') return 'Right';
  if (upperText === 'BACKSPACE') return 'Backspace';
  if (upperText === 'DELETE') return 'Delete';
  if (upperText === 'ENTER') return 'Enter';
  if (upperText === 'TAB') return 'Tab';

  if (/^[A-Z0-9]$/.test(upperText)) {
    return upperText;
  }
  if (/^F\d{1,2}$/.test(upperText)) {
    return upperText;
  }

  return text.length === 1 ? upperText : text[0].toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * 统一快捷键字符串格式，避免输入框显示和后端保存出现两套拼写。
 */
function normalizeShortcutValue(shortcut) {
  return String(shortcut || DEFAULT_CONFIG.shortcut_toggle)
    .split('+')
    .map((part) => normalizeShortcutPart(part))
    .filter(Boolean)
    .join('+') || DEFAULT_CONFIG.shortcut_toggle;
}

/**
 * 把快捷键片段归一化为插件常用拼写。
 */
function normalizeShortcutPart(part) {
  const text = String(part || '').trim();
  if (!text) {
    return '';
  }
  const upperText = text.toUpperCase();
  if (upperText === 'CTRL' || upperText === 'CONTROL') return 'Ctrl';
  if (upperText === 'ALT') return 'Alt';
  if (upperText === 'SHIFT') return 'Shift';
  if (upperText === 'META' || upperText === 'CMD' || upperText === 'COMMAND') return 'Meta';
  if (upperText === 'ESC' || upperText === 'ESCAPE') return 'Esc';
  if (upperText === 'SPACE') return 'Space';
  if (/^[A-Z0-9]$/.test(upperText) || /^F\d{1,2}$/.test(upperText)) {
    return upperText;
  }
  return text[0].toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * 配置页里用大写加空格展示快捷键，让它看起来更像真实热键组合。
 */
function formatShortcutDisplay(shortcut) {
  return normalizeShortcutValue(shortcut)
    .split('+')
    .map((part) => part.toUpperCase())
    .join(' + ');
}

/**
 * 统一提取错误文本，避免 toast 里只看到 [object Object]。
 */
function formatErrorMessage(error) {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string' && error.message.trim()) {
      return error.message;
    }
    if (typeof error.toString === 'function') {
      const text = error.toString();
      if (text && text !== '[object Object]') {
        return text;
      }
    }
  }
  return '未知错误';
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone);
}
