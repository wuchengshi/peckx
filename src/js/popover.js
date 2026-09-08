import { $ } from './dom.js';
import { state } from './state.js';
import {
  buildReminderSetting,
  buildReminderValue,
  buildRepeatRule,
  chipLabel,
  dueState,
  escapeHtml,
  normalizeReminderChannels,
  normalizeReminderSettings,
  parseRepeatRule,
  reminderHasChannel,
  repeatWeekdayOptions,
  sortCategories,
  showToast,
} from './utils.js';

let popoverElement;
let backdropElement;

/**
 * 初始化弹层根节点与全局关闭事件。
 */
export function setupPopover() {
  popoverElement = $('#popover');
  backdropElement = $('#popover-backdrop');
  backdropElement?.addEventListener('click', closePopover);
}

/**
 * 返回当前是否有弹层处于显示状态。
 */
export function isPopoverVisible() {
  return state.popover.visible;
}

/**
 * 关闭当前弹层并执行清理逻辑。
 */
export function closePopover() {
  if (!popoverElement || !backdropElement) {
    return;
  }
  state.popover.visible = false;
  popoverElement.className = 'popover';
  popoverElement.classList.remove('visible');
  backdropElement.classList.remove('visible');
  popoverElement.innerHTML = '';
  if (typeof state.popover.cleanup === 'function') {
    state.popover.cleanup();
  }
  state.popover.cleanup = null;
}

/**
 * 打开通用弹层并自动计算位置。
 */
function openPopover(anchorElement, html, bindEvents, options = {}) {
  if (!popoverElement || !backdropElement || !anchorElement) {
    return;
  }
  if (state.popover.visible) {
    closePopover();
  }
  popoverElement.innerHTML = html;
  popoverElement.className = `popover ${options.className || ''}`.trim();
  positionPopover(anchorElement, options.width || 260, options.height || 320);
  backdropElement.classList.add('visible');
  popoverElement.classList.add('visible');
  state.popover.visible = true;
  state.popover.cleanup = bindEvents?.(popoverElement) || null;
}

/**
 * 打开分类弹层，并在选择后回调新值。
 */
export function openCategoryPopover(anchorElement, currentValue, onSelect) {
  const categories = sortCategories(state.categories);
  const items = categories.map((item) => `
    <div class="cat-item ${item === currentValue ? 'selected' : ''}" data-category="${escapeHtml(item)}">
      <span class="cat-dot" style="background:${colorByCategory(item)};"></span>
      <span class="cat-name">${escapeHtml(item)}</span>
    </div>
  `).join('');
  openPopover(anchorElement, `
    <div class="cat-popover">
      <div class="cat-input-wrap">
        <input class="cat-input" id="cat-input" type="text" value="" placeholder="输入新分类后回车">
        <button class="cat-clear-btn" id="cat-clear-btn" title="清除">×</button>
      </div>
      <div class="cat-list">${items || '<div class="popover-item">暂无分类，直接输入新分类</div>'}</div>
    </div>
  `, (root) => {
    root.querySelectorAll('.cat-item').forEach((element) => {
      element.addEventListener('click', () => {
        onSelect(element.dataset.category || null);
        closePopover();
      });
    });
    root.querySelector('#cat-clear-btn')?.addEventListener('click', () => {
      onSelect(null);
      closePopover();
    });
    root.querySelector('#cat-input')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      const value = event.currentTarget.value.trim();
      if (!value) {
        return;
      }
      onSelect(value);
      closePopover();
    });
  }, { className: 'cat-popover', width: 240, height: 280 });
}

/**
 * 打开截止时间弹层，并在选择后回调新值。
 */
export function openDueDatePopover(anchorElement, currentValue, onSelect) {
  const currentLabel = dueState(currentValue)?.label ?? chipLabel('due', currentValue);
  openPopover(anchorElement, `
    <div class="datetime-picker">
      <div class="popover-section dt-quick">
        <div class="popover-item" data-preset="today">今天结束前</div>
        <div class="popover-item" data-preset="tomorrow">明天结束前</div>
        <div class="popover-item" data-preset="this-week">本周结束前</div>
        <div class="popover-item" data-preset="next-week">下周结束前</div>
        <div class="popover-item" data-preset="clear">清除截止</div>
      </div>
      <div class="dt-custom">
        <label>自定义日期时间</label>
        <input id="due-input" type="datetime-local" value="${toDateTimeLocalValue(currentValue)}">
      </div>
      <div class="dt-actions">
        <button id="due-cancel">取消</button>
        <button class="primary" id="due-confirm">确定</button>
      </div>
      <div class="popover-section"><div class="popover-item selected">当前：${escapeHtml(currentLabel)}</div></div>
    </div>
  `, (root) => {
    root.querySelectorAll('[data-preset]').forEach((element) => {
      element.addEventListener('click', () => {
        onSelect(buildDuePreset(element.dataset.preset));
        closePopover();
      });
    });
    root.querySelector('#due-cancel')?.addEventListener('click', closePopover);
    root.querySelector('#due-confirm')?.addEventListener('click', () => {
      const value = root.querySelector('#due-input')?.value || null;
      onSelect(value || null);
      closePopover();
    });
  }, { className: 'datetime-picker', width: 260, height: 300 });
}

/**
 * 打开提醒弹层，并在选择后回调新值。
 */
export function openReminderPopover(anchorElement, currentValue, onSelect) {
  const normalizedCurrentValue = normalizeReminderSettings(currentValue);
  const presets = [
    { label: '不提醒', value: [] },
    { label: '到期时提醒', value: [buildReminderSetting('到期时', ['app'])] },
    { label: '提前 10 分钟', value: [buildReminderSetting('提前10分钟', ['app'])] },
    { label: '提前 30 分钟', value: [buildReminderSetting('提前30分钟', ['app'])] },
    { label: '提前 1 小时', value: [buildReminderSetting('提前1小时', ['app'])] },
    { label: '提前 1 天', value: [buildReminderSetting('提前1天', ['app'])] },
    { label: '提前 1 周', value: [buildReminderSetting('提前1周', ['app'])] },
  ];
  const currentReminder = normalizedCurrentValue[0] || null;
  const currentKey = reminderKey(normalizedCurrentValue);
  openPopover(anchorElement, `
    <div class="popover-section">
      ${presets.map((option) => `<div class="popover-item ${currentKey === reminderKey(option.value) ? 'selected' : ''}" data-reminder="${escapeHtml(JSON.stringify(option.value))}">${escapeHtml(option.label)}</div>`).join('')}
    </div>
    <div class="popover-section reminder-channel-section">
      <div class="reminder-channel-title">提醒方式</div>
      <div class="reminder-channel-row">
        <button class="reminder-channel-btn ${reminderHasChannel(currentReminder, 'email') ? 'active' : ''}" data-reminder-channel="email" type="button" title="邮件提醒">${emailIcon()}</button>
        <button class="reminder-channel-btn ${reminderHasChannel(currentReminder, 'sms') ? 'active' : ''}" data-reminder-channel="sms" type="button" title="短信提醒">${smsIcon()}</button>
        <button class="reminder-channel-btn active locked" data-reminder-channel="app" type="button" title="软件提醒">${appReminderIcon()}</button>
      </div>
    </div>
    <div class="popover-section">
      <div class="custom-reminder">
        <input id="reminder-amount" type="number" min="1" step="1" value="1">
        <select id="reminder-unit">
          <option value="分钟">分钟</option>
          <option value="小时">小时</option>
          <option value="天">天</option>
          <option value="周">周</option>
        </select>
        <button class="page-btn" id="reminder-confirm" type="button">确定</button>
      </div>
    </div>
  `, (root) => {
    let selectedChannels = normalizeReminderChannels(currentReminder?.channels || ['app']);

    function syncChannelButtons() {
      root.querySelectorAll('[data-reminder-channel]').forEach((element) => {
        const channel = element.dataset.reminderChannel;
        element.classList.toggle('active', selectedChannels.includes(channel));
      });
    }

    function applyChannels(reminders) {
      if (!Array.isArray(reminders) || reminders.length === 0) {
        return [];
      }
      return reminders.map((item) => buildReminderSetting(item?.value || item, selectedChannels)).filter(Boolean);
    }

    function ensureContactConfig(channels) {
      if (channels.includes('email') && !String(state.config.notification_email || '').trim()) {
        showToast('请先在配置中填写邮箱地址');
        return false;
      }
      if (channels.includes('sms') && !String(state.config.notification_phone || '').trim()) {
        showToast('请先在配置中填写手机号');
        return false;
      }
      return true;
    }

    root.querySelectorAll('[data-reminder]').forEach((element) => {
      element.addEventListener('click', () => {
        const value = applyChannels(normalizeReminderSettings(JSON.parse(element.dataset.reminder || '[]')));
        if (!ensureContactConfig(selectedChannels)) {
          return;
        }
        onSelect(value);
        closePopover();
      });
    });
    root.querySelectorAll('[data-reminder-channel]').forEach((element) => {
      element.addEventListener('click', () => {
        const channel = element.dataset.reminderChannel;
        if (channel === 'app') {
          return;
        }
        if (!selectedChannels.includes(channel) && !ensureContactConfig([channel])) {
          return;
        }
        if (selectedChannels.includes(channel)) {
          selectedChannels = selectedChannels.filter((item) => item !== channel);
        } else {
          selectedChannels = normalizeReminderChannels([...selectedChannels, channel]);
        }
        syncChannelButtons();
      });
    });
    root.querySelector('#reminder-confirm')?.addEventListener('click', () => {
      const amount = root.querySelector('#reminder-amount')?.value;
      const unit = root.querySelector('#reminder-unit')?.value;
      if (!ensureContactConfig(selectedChannels)) {
        return;
      }
      onSelect(applyChannels(buildReminderValue(amount, unit)));
      closePopover();
    });
    syncChannelButtons();
  }, { width: 240, height: 320 });
}

/**
 * 打开重复规则弹层，并在选择后回调新值。
 */
export function openRepeatPopover(anchorElement, currentValue, onSelect) {
  const currentRule = parseRepeatRule(currentValue) || { freq: 'DAILY', interval: 1, byWeekDays: [] };
  const presets = [
    { label: '不重复', value: null },
    { label: '每天', value: buildRepeatRule({ freq: 'DAILY', interval: 1 }) },
    { label: '每周', value: buildRepeatRule({ freq: 'WEEKLY', interval: 1 }) },
    { label: '每月', value: buildRepeatRule({ freq: 'MONTHLY', interval: 1 }) },
    { label: '每年', value: buildRepeatRule({ freq: 'YEARLY', interval: 1 }) },
  ];
  openPopover(anchorElement, `
    <div class="popover-section">
      ${presets.map((option) => `<div class="popover-item ${repeatPresetSelected(currentValue, option.value) ? 'selected' : ''}" data-repeat="${escapeHtml(JSON.stringify(option.value))}">${escapeHtml(option.label)}</div>`).join('')}
    </div>
    <div class="popover-section custom-repeat">
      <div class="cr-row">
        <span>每</span>
        <input id="repeat-interval" type="number" min="1" step="1" value="${currentRule.interval || 1}">
        <select id="repeat-freq">
          <option value="DAILY" ${currentRule.freq === 'DAILY' ? 'selected' : ''}>天</option>
          <option value="WEEKLY" ${currentRule.freq === 'WEEKLY' ? 'selected' : ''}>周</option>
          <option value="MONTHLY" ${currentRule.freq === 'MONTHLY' ? 'selected' : ''}>月</option>
          <option value="YEARLY" ${currentRule.freq === 'YEARLY' ? 'selected' : ''}>年</option>
        </select>
      </div>
      <div class="cr-row" id="repeat-weekdays-wrap" style="display:${currentRule.freq === 'WEEKLY' ? 'flex' : 'none'};">
        <div class="cr-weekdays">
          ${repeatWeekdayOptions().map((item) => `<button type="button" class="cr-weekday ${currentRule.byWeekDays.includes(item.code) ? 'selected' : ''}" data-weekday="${item.code}">${item.label}</button>`).join('')}
        </div>
      </div>
      <div class="dt-actions">
        <button id="repeat-cancel">取消</button>
        <button class="primary" id="repeat-confirm">确定</button>
      </div>
    </div>
  `, (root) => {
    const freqSelect = root.querySelector('#repeat-freq');
    const weekdaysWrap = root.querySelector('#repeat-weekdays-wrap');
    freqSelect?.addEventListener('change', () => {
      weekdaysWrap.style.display = freqSelect.value === 'WEEKLY' ? 'flex' : 'none';
    });
    root.querySelectorAll('[data-repeat]').forEach((element) => {
      element.addEventListener('click', () => {
        const value = JSON.parse(element.dataset.repeat || 'null');
        onSelect(value);
        closePopover();
      });
    });
    root.querySelectorAll('[data-weekday]').forEach((element) => {
      element.addEventListener('click', () => {
        element.classList.toggle('selected');
      });
    });
    root.querySelector('#repeat-cancel')?.addEventListener('click', closePopover);
    root.querySelector('#repeat-confirm')?.addEventListener('click', () => {
      const freq = root.querySelector('#repeat-freq')?.value || 'DAILY';
      const interval = root.querySelector('#repeat-interval')?.value || '1';
      const byWeekDays = [...root.querySelectorAll('[data-weekday].selected')].map((element) => element.dataset.weekday);
      onSelect(buildRepeatRule({ freq, interval, byWeekDays }));
      closePopover();
    });
  }, { width: 280, height: 340 });
}

/**
 * 打开横向图标式更多菜单。
 */
export function openMoreMenuPopover(anchorElement, onSelect) {
  openPopover(anchorElement, `
    <div class="more-menu">
      <button class="more-menu-item" data-menu-action="edit" title="编辑">${editIcon()}</button>
      <button class="more-menu-item" data-menu-action="category" title="分类">${tagIcon()}</button>
      <button class="more-menu-item" data-menu-action="copy" title="复制">${copyIcon()}</button>
      <button class="more-menu-item" data-menu-action="archive" title="归档">${archiveIcon()}</button>
      <button class="more-menu-item danger" data-menu-action="delete" title="删除">${trashIcon()}</button>
    </div>
  `, (root) => {
    root.querySelectorAll('[data-menu-action]').forEach((element) => {
      element.addEventListener('click', async () => {
        closePopover();
        await onSelect(element.dataset.menuAction);
      });
    });
  }, { className: 'more-menu', width: 220, height: 60 });
}

/**
 * 打开删除确认弹层。
 */
export function openDeleteConfirmPopover(anchorElement, onConfirm) {
  openPopover(anchorElement, `
    <div class="delete-confirm">
      <div class="delete-confirm-text">确认删除？</div>
      <div class="delete-confirm-actions">
        <button class="dc-cancel" id="delete-cancel">取消</button>
        <button class="dc-delete" id="delete-confirm">删除</button>
      </div>
    </div>
  `, (root) => {
    root.querySelector('#delete-cancel')?.addEventListener('click', closePopover);
    root.querySelector('#delete-confirm')?.addEventListener('click', async () => {
      closePopover();
      await onConfirm();
    });
  }, { width: 200, height: 120 });
}

/**
 * 计算弹层位置，默认向下展开，空间不足时翻转到上方。
 */
function positionPopover(anchorElement, width, height) {
  const rect = anchorElement.getBoundingClientRect();
  const left = Math.min(window.innerWidth - width - 12, Math.max(12, rect.left));
  const preferredTop = rect.bottom + 8;
  const flippedTop = rect.top - height - 8;
  const top = preferredTop + height > window.innerHeight
    ? Math.max(12, flippedTop)
    : preferredTop;
  popoverElement.style.left = `${left}px`;
  popoverElement.style.top = `${top}px`;
}

/**
 * 将分类转换为用于点缀的颜色。
 */
function colorByCategory(name) {
  const colors = ['#d7827e', '#56949f', '#ea9d34', '#b4637a', '#797593'];
  let total = 0;
  for (let index = 0; index < name.length; index += 1) {
    total += name.charCodeAt(index);
  }
  return colors[Math.abs(total) % colors.length];
}

/**
 * 根据预设快捷项生成截止日期。
 */
function buildDuePreset(type) {
  if (type === 'clear') {
    return null;
  }
  const date = new Date();
  if (type === 'today') {
    date.setHours(23, 59, 0, 0);
    return toIsoWithoutSeconds(date);
  }
  if (type === 'tomorrow') {
    date.setDate(date.getDate() + 1);
    date.setHours(23, 59, 0, 0);
    return toIsoWithoutSeconds(date);
  }
  if (type === 'this-week') {
    date.setDate(date.getDate() + (7 - date.getDay() || 7));
    date.setHours(23, 59, 0, 0);
    return toIsoWithoutSeconds(date);
  }
  if (type === 'next-week') {
    const currentDay = date.getDay() || 7;
    date.setDate(date.getDate() + (14 - currentDay));
    date.setHours(23, 59, 0, 0);
    return toIsoWithoutSeconds(date);
  }
  return null;
}

/**
 * 将时间值转换为 datetime-local 可读格式。
 */
function toDateTimeLocalValue(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * 输出不带秒的 ISO 本地时间字符串。
 */
function toIsoWithoutSeconds(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

/**
 * 比较提醒值是否为同一组预设。
 */
function reminderKey(reminders) {
  return JSON.stringify(normalizeReminderSettings(reminders || []).map((item) => item.value));
}

function emailIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16v12H4z"></path><path d="m4 7 8 6 8-6"></path></svg>';
}

function smsIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 6h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"></path></svg>';
}

function appReminderIcon() {
  return '<img src="assets/icon-transparent.png" alt="软件提醒图标">';
}

/**
 * 判断当前重复值是否命中某个预设。
 */
function repeatPresetSelected(currentValue, presetValue) {
  if (!currentValue && !presetValue) {
    return true;
  }
  if (!currentValue || !presetValue) {
    return false;
  }
  return currentValue.rrule === presetValue.rrule;
}

/**
 * 返回编辑图标。
 */
function editIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path></svg>';
}

/**
 * 返回标签图标。
 */
function tagIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41 11 3H4v7l9.59 9.59a2 2 0 0 0 2.82 0l4.18-4.18a2 2 0 0 0 0-2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';
}

/**
 * 返回复制图标。
 */
function copyIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
}

/**
 * 返回归档图标。
 */
function archiveIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>';
}

/**
 * 返回删除图标。
 */
function trashIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
}
