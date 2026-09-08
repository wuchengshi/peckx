/**
 * 转义 HTML，避免文本直接插入节点时破坏结构。
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 计算分类颜色索引，确保同名分类颜色稳定。
 */
export function hashCategory(name) {
  const text = String(name ?? '');
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * 返回分类展示所需的前景色、背景色和边框色。
 */
export function categoryStyle(name) {
  const palette = [
    { bg: 'rgba(215, 130, 126, 0.12)', border: 'rgba(215, 130, 126, 0.24)', color: '#d7827e' },
    { bg: 'rgba(86, 148, 159, 0.12)', border: 'rgba(86, 148, 159, 0.24)', color: '#56949f' },
    { bg: 'rgba(234, 157, 52, 0.12)', border: 'rgba(234, 157, 52, 0.24)', color: '#ea9d34' },
    { bg: 'rgba(180, 99, 122, 0.12)', border: 'rgba(180, 99, 122, 0.24)', color: '#b4637a' },
    { bg: 'rgba(121, 117, 147, 0.12)', border: 'rgba(121, 117, 147, 0.24)', color: '#797593' },
  ];
  return palette[hashCategory(name) % palette.length];
}

/**
 * 生成分类徽章 HTML。
 */
export function categoryBadgeHTML(name) {
  if (!name) {
    return '';
  }
  const style = categoryStyle(name);
  return `<span class="item-category-badge" style="background:${style.bg};border-color:${style.border};color:${style.color};">${escapeHtml(name)}</span>`;
}

/**
 * 将分类列表去重并按中文顺序排序，避免弹层里出现重复或跳序。
 */
export function sortCategories(categories) {
  return [...new Set((categories || []).map((item) => String(item || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

/**
 * 将时间字符串格式化为列表场景更紧凑的显示文本。
 */
export function smartTime(value) {
  if (!value) {
    return '';
  }
  const date = parseDateValue(value);
  if (!date) {
    return String(value);
  }
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  if (sameYear) {
    return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

/**
 * 将时间格式化为完整时间文本。
 */
export function fullTime(value) {
  if (!value) {
    return '';
  }
  const date = parseDateValue(value);
  if (!date) {
    return String(value);
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

/**
 * 计算截止时间对应的显示状态和文本，统一首页、抽屉和输入区的危险态规则。
 * 规则：已过期最重，其次 24 小时内，再次 3 天内，避免不同视图对同一截止时间显示不一致。
 */
export function dueState(value) {
  if (!value) {
    return null;
  }
  const date = parseDateValue(value);
  if (!date) {
    return { tone: 'normal', label: String(value) };
  }
  const diff = date.getTime() - Date.now();
  const days = diff / (24 * 60 * 60 * 1000);
  let tone = 'normal';
  if (diff < 0) {
    tone = 'expired';
  } else if (days <= 1) {
    tone = 'urgent';
  } else if (days <= 3) {
    tone = 'soon';
  }
  return {
    tone,
    label: date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }),
  };
}

/**
 * 生成提醒芯片或字段的中文显示文本。
 */
export function reminderLabel(reminders) {
  if (!Array.isArray(reminders) || reminders.length === 0) {
    return '提醒';
  }
  if (reminders.length === 1) {
    return normalizeReminderText(reminders[0]?.value || reminders[0]);
  }
  return `${reminders.length} 个提醒`;
}

/**
 * 按当前值返回重复规则显示文案。
 */
export function repeatLabel(repeat) {
  if (!repeat) {
    return '重复';
  }
  return repeat.label || parseRepeatRule(repeat)?.label || '重复';
}

/**
 * 返回待办元数据在芯片中的显示文案。
 */
export function chipLabel(type, value) {
  if (!value || (Array.isArray(value) && value.length === 0)) {
    if (type === 'category') return '分类';
    if (type === 'due') return '截止';
    if (type === 'reminder') return '提醒';
    return '重复';
  }
  if (type === 'category') return String(value);
  if (type === 'due') return dueState(value)?.label ?? '截止';
  if (type === 'reminder') return reminderLabel(value);
  return repeatLabel(value);
}

/**
 * 把自定义提醒输入组合成后端保存的最小字符串列表。
 */
export function buildReminderValue(amount, unit) {
  const count = Number(amount);
  if (!Number.isFinite(count) || count <= 0) {
    return [];
  }
  const normalizedUnit = unit === '分钟' || unit === '小时' || unit === '天' || unit === '周' ? unit : '分钟';
  return [{ value: `提前${count}${normalizedUnit}`, channels: ['app'] }];
}

/**
 * 生成标准提醒项，统一使用 app/email/sms 渠道编码，避免弹层与后端保存格式不一致。
 */
export function buildReminderSetting(value, channels) {
  const normalizedValue = String(value || '').trim();
  if (!normalizedValue) {
    return null;
  }
  return {
    value: normalizedValue,
    channels: normalizeReminderChannels(channels),
  };
}

/**
 * 把旧字符串提醒和新结构提醒统一转换为稳定结构，保证旧数据能继续回填。
 */
export function normalizeReminderSettings(reminders) {
  if (!Array.isArray(reminders)) {
    return [];
  }
  const result = [];
  for (const item of reminders) {
    if (typeof item === 'string') {
      const normalizedItem = buildReminderSetting(item, ['app']);
      if (normalizedItem) {
        result.push(normalizedItem);
      }
      continue;
    }
    const normalizedItem = buildReminderSetting(item?.value, item?.channels);
    if (normalizedItem) {
      result.push(normalizedItem);
    }
  }
  result.sort((left, right) => String(left.value).localeCompare(String(right.value), 'zh-CN'));
  return result.filter((item, index, items) => {
    const previousItem = items[index - 1];
    return !previousItem || previousItem.value !== item.value || previousItem.channels.join('|') !== item.channels.join('|');
  });
}

/**
 * 软件提醒固定开启且排在最前，邮箱/短信按固定顺序补齐，避免点击顺序不同导致落盘值不稳定。
 */
export function normalizeReminderChannels(channels) {
  const source = Array.isArray(channels) ? channels : [];
  const result = ['app'];
  for (const item of source) {
    const normalizedItem = String(item || '').trim().toLowerCase();
    if (['email', 'sms'].includes(normalizedItem) && !result.includes(normalizedItem)) {
      result.push(normalizedItem);
    }
  }
  return result;
}

/**
 * 返回提醒项是否启用了指定渠道。
 */
export function reminderHasChannel(reminder, channel) {
  return normalizeReminderChannels(reminder?.channels).includes(String(channel || '').trim().toLowerCase());
}

/**
 * 把重复规则配置组装成后端可直接存储的 label 与 RRULE。
 * 规则顺序：先确定频率，再写间隔，最后补周频多选星期，避免生成歧义字符串。
 */
export function buildRepeatRule(config) {
  if (!config || !config.freq) {
    return null;
  }
  const interval = Math.max(1, Number(config.interval) || 1);
  const freq = String(config.freq).toUpperCase();
  const parts = [`FREQ=${freq}`];
  if (interval > 1) {
    parts.push(`INTERVAL=${interval}`);
  }
  let label = interval > 1 ? `每 ${interval} ${repeatUnitLabel(freq)}` : defaultRepeatLabel(freq);
  // 周频率需要稳定排序，避免同一选择因点击顺序不同生成不同 RRULE 与标签。
   if (freq === 'WEEKLY' && Array.isArray(config.byWeekDays) && config.byWeekDays.length > 0) {
     const dayCodes = normalizeWeekdays(config.byWeekDays);
     parts.push(`BYDAY=${dayCodes.join(',')}`);
     label = interval > 1
       ? `每 ${interval} 周 · ${dayCodes.map(weekdayCodeToLabel).join('、')}`
       : `每周 · ${dayCodes.map(weekdayCodeToLabel).join('、')}`;
   }
  return {
    label,
    rrule: parts.join(';'),
  };
}

/**
 * 解析现有重复规则，供弹层回填自定义输入。
 */
export function parseRepeatRule(repeat) {
  if (!repeat?.rrule) {
    return null;
  }
  const result = {
    freq: 'DAILY',
    interval: 1,
    byWeekDays: [],
    label: repeat.label || '',
  };
  repeat.rrule.split(';').forEach((segment) => {
    const [key, rawValue] = segment.split('=');
    if (!key || !rawValue) {
      return;
    }
    if (key === 'FREQ') {
      result.freq = rawValue;
    }
    if (key === 'INTERVAL') {
      result.interval = Math.max(1, Number(rawValue) || 1);
    }
    if (key === 'BYDAY') {
      result.byWeekDays = normalizeWeekdays(rawValue.split(','));
    }
  });
  if (!result.label) {
    result.label = buildRepeatRule(result)?.label || defaultRepeatLabel(result.freq);
  }
  return result;
}

/**
 * 返回重复规则可用的星期选项。
 */
export function repeatWeekdayOptions() {
  return [
    { code: 'MO', label: '一' },
    { code: 'TU', label: '二' },
    { code: 'WE', label: '三' },
    { code: 'TH', label: '四' },
    { code: 'FR', label: '五' },
    { code: 'SA', label: '六' },
    { code: 'SU', label: '日' },
  ];
}

/**
 * 展示短提示，减少模块重复写提示逻辑。
 */
export function showToast(message) {
  const host = document.getElementById('toast-container');
  if (!host) {
    return;
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  window.setTimeout(() => {
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), 220);
  }, 1600);
}

/**
 * 展示带动作按钮的提示条，供删除后的限时撤销等场景复用。
 */
export function showActionToast(message, actionLabel, onAction, duration = 5000) {
  const host = document.getElementById('toast-container');
  if (!host) {
    return;
  }
  const toast = document.createElement('div');
  toast.className = 'toast actionable';
  toast.innerHTML = `
    <span class="toast-message">${message}</span>
    <button class="toast-action" type="button">${actionLabel}</button>
  `;
  const actionButton = toast.querySelector('.toast-action');
  let closed = false;

  function closeToast() {
    if (closed) {
      return;
    }
    closed = true;
    toast.classList.remove('visible');
    window.setTimeout(() => toast.remove(), 220);
  }

  actionButton?.addEventListener('click', async () => {
    try {
      await onAction?.();
    } finally {
      closeToast();
    }
  });

  host.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  window.setTimeout(closeToast, duration);
}

/**
 * 生成防抖函数，避免搜索输入频繁触发刷新。
 */
export function debounce(callback, delay) {
  let timer = 0;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => callback(...args), delay);
  };
}

/**
 * 返回当前环境是否运行在 Tauri 中。
 */
export function isTauri() {
  return Boolean(window.__TAURI_INTERNALS__);
}

/**
 * 计算垃圾桶条目的删除时间与剩余天数，供列表统一展示。
 */
export function trashMeta(value, retentionDays = 7) {
  const date = parseDateValue(value);
  if (!date) {
    return null;
  }
  const deletedLabel = fullTime(value);
  const end = date.getTime() + retentionDays * 24 * 60 * 60 * 1000;
  const remainDays = Math.ceil((end - Date.now()) / (24 * 60 * 60 * 1000));
  let tone = 'normal';
  if (remainDays <= 1) {
    tone = 'urgent';
  } else if (remainDays <= 3) {
    tone = 'soon';
  }
  return {
    deletedLabel,
    remainDays,
    remainLabel: remainDays > 0 ? `${remainDays} 天后清理` : '即将清理',
    tone,
  };
}

/**
 * 生成归档条目的时间说明。
 */
export function archiveMeta(updatedAt, createdAt) {
  const source = updatedAt || createdAt;
  if (!source) {
    return '';
  }
  return `归档于 ${fullTime(source)}`;
}

/**
 * 将可能的日期字符串统一解析为 Date。
 */
function parseDateValue(value) {
  const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T');
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

/**
 * 统一提醒文本的空格与文案格式。
 */
function normalizeReminderText(value) {
  return String(value || '')
    .replace(/^定时@(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/u, '$1 $2 提醒')
    .replace(/^提前(\d+)(分钟|小时|天|周)$/u, '提前 $1 $2')
    .replace(/^到期时$/u, '到期时提醒');
}

/**
 * 将周频星期编码做去重和固定顺序，避免相同规则被误判为不同值。
 */
function normalizeWeekdays(days) {
  const order = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
  return [...new Set((days || []).map((item) => String(item).toUpperCase()).filter((item) => order.includes(item)))]
    .sort((left, right) => order.indexOf(left) - order.indexOf(right));
}

/**
 * 将 RRULE 星期编码转成中文。
 */
function weekdayCodeToLabel(code) {
  const mapping = {
    MO: '周一',
    TU: '周二',
    WE: '周三',
    TH: '周四',
    FR: '周五',
    SA: '周六',
    SU: '周日',
  };
  return mapping[code] || code;
}

/**
 * 返回重复频率默认中文文案。
 */
function defaultRepeatLabel(freq) {
  if (freq === 'DAILY') return '每天';
  if (freq === 'WEEKLY') return '每周';
  if (freq === 'MONTHLY') return '每月';
  if (freq === 'YEARLY') return '每年';
  return '重复';
}

/**
 * 返回间隔型重复规则的中文单位。
 */
function repeatUnitLabel(freq) {
  if (freq === 'DAILY') return '天';
  if (freq === 'WEEKLY') return '周';
  if (freq === 'MONTHLY') return '个月';
  if (freq === 'YEARLY') return '年';
  return '次';
}
