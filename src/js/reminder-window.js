import { api } from './api.js';
import { categoryStyle, escapeHtml } from './utils.js';

const elements = {
  stage: document.getElementById('card-stage'),
  dots: document.getElementById('card-dots'),
  counter: document.getElementById('popup-counter'),
  pulse: document.getElementById('popup-pulse'),
  empty: document.getElementById('empty-state'),
};

const state = {
  reminders: [],
  topIndex: 0,
  snoozeAlertId: null,
  isAnimating: false,
};

document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  void loadReminders();
  window.setInterval(() => renderReminder(), 60000);
});

window.__setReminderPayloads = (payloads) => {
  setReminders(payloads);
};

function bindEvents() {
  elements.stage?.addEventListener('click', async (event) => {
    const actionButton = event.target.closest('[data-action]');
    if (actionButton) {
      await handleAction(actionButton);
      return;
    }
    const snoozeOption = event.target.closest('[data-snooze]');
    if (snoozeOption) {
      await handleSnooze(snoozeOption);
      return;
    }
    const navButton = event.target.closest('[data-nav]');
    if (navButton) {
      const direction = navButton.dataset.nav;
      jumpTo(direction === 'prev' ? state.topIndex - 1 : state.topIndex + 1);
      return;
    }
    const card = event.target.closest('.reminder-stack-card');
    if (!card) {
      return;
    }
    const index = Number(card.dataset.index);
    if (!Number.isFinite(index)) {
      return;
    }
    if (index !== state.topIndex) {
      jumpTo(index);
      return;
    }
    const payload = state.reminders[index];
    if (payload?.alert_id) {
      await api.openActiveReminderTarget(payload.alert_id);
    }
  });

  elements.dots?.addEventListener('click', (event) => {
    const dot = event.target.closest('[data-dot]');
    if (!dot) {
      return;
    }
    jumpTo(Number(dot.dataset.dot));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      jumpTo(state.topIndex - 1);
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      jumpTo(state.topIndex + 1);
    }
  });
}

async function loadReminders() {
  const previousAlertId = state.reminders[state.topIndex]?.alert_id || null;
  const payloads = await api.getActiveReminders().catch(() => []);
  setReminders(payloads, previousAlertId);
}

function setReminders(payloads, preferredAlertId = null) {
  state.reminders = Array.isArray(payloads) ? payloads : [];
  if (preferredAlertId) {
    const nextIndex = state.reminders.findIndex((item) => item?.alert_id === preferredAlertId);
    if (nextIndex >= 0) {
      state.topIndex = nextIndex;
    }
  }
  if (state.topIndex >= state.reminders.length) {
    state.topIndex = Math.max(0, state.reminders.length - 1);
  }
  if (!state.reminders.some((item) => item?.alert_id === state.snoozeAlertId)) {
    state.snoozeAlertId = null;
  }
  renderReminder();
}

function renderReminder() {
  const total = state.reminders.length;
  const isEmpty = total === 0;
  document.body.classList.toggle('reminder-window-empty', isEmpty);
  elements.empty.hidden = !isEmpty;
  elements.stage.hidden = isEmpty;
  elements.dots.hidden = isEmpty;
  elements.pulse.style.display = isEmpty ? 'none' : 'inline-flex';
  elements.counter.textContent = isEmpty ? '0 / 0' : `${state.topIndex + 1} / ${total}`;
  if (isEmpty) {
    elements.stage.innerHTML = '';
    elements.dots.innerHTML = '';
    return;
  }

  const cards = state.reminders.map((payload, index) => renderCard(payload, index)).join('');
  const hasPrev = state.topIndex > 0;
  const hasNext = state.topIndex < total - 1;
  elements.stage.classList.toggle('no-prev', !hasPrev);
  elements.stage.classList.toggle('no-next', !hasNext);
  elements.stage.innerHTML = `${cards}
    <button class="nav-arrow prev" type="button" data-nav="prev" aria-label="上一条提醒">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 6 8 12l6 6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button class="nav-arrow next" type="button" data-nav="next" aria-label="下一条提醒">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m10 6 6 6-6 6" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>`;
  elements.dots.innerHTML = state.reminders
    .map((payload, index) => `<button class="card-dot${index === state.topIndex ? ' active' : ''}" type="button" data-dot="${index}" aria-label="查看第 ${index + 1} 条提醒"></button>`)
    .join('');
}

function renderCard(payload, index) {
  const urgency = resolveUrgency(payload?.due_date);
  const dueLine = buildDueLine(payload);
  const categoryName = String(payload?.category || '待办');
  const style = categoryStyle(categoryName);
  const isTop = index === state.topIndex;
  const stackClass = resolveStackClass(index);
  const badgeText = urgency === 'high' ? '已逾期' : urgency === 'medium' ? '即将到期' : '正常';
  const triggerLabel = payload?.triggerLabel ? `<span class="card-trigger">提醒于 ${escapeHtml(payload.triggerLabel)}</span>` : '';
  const reminderLabel = payload?.reminderValue ? `<span class="card-reminder-text">${escapeHtml(normalizeReminderText(payload.reminderValue))}</span>` : '';
  const missedLabel = Number(payload?.missed_count) > 1
    ? `<span class="card-trigger">已错过 ${Number(payload.missed_count)} 次</span>`
    : '';
  const snoozeOpen = isTop && payload?.alert_id && state.snoozeAlertId === payload.alert_id;
  return `<article class="reminder-stack-card urgency-${urgency} ${stackClass}" data-index="${index}" data-alert-id="${escapeHtml(payload?.alert_id || '')}">
    <div class="card-top">
      <span class="card-badge">${badgeText}</span>
      <span class="card-category" style="--card-category:${style.color};">${escapeHtml(categoryName)}</span>
    </div>
    <h2 class="card-title">${escapeHtml(payload?.title || '待处理提醒')}</h2>
    <div class="card-time">${escapeHtml(dueLine)}</div>
    <div class="card-meta">${triggerLabel}${missedLabel}${reminderLabel}</div>
    <div class="card-actions" data-stop>
      <button class="card-btn primary" type="button" data-action="complete" data-alert-id="${escapeHtml(payload?.alert_id || '')}">完成</button>
      <button class="card-btn ghost" type="button" data-action="ignore" data-alert-id="${escapeHtml(payload?.alert_id || '')}">忽略</button>
      <button class="card-btn subtle" type="button" data-action="toggle-snooze" data-alert-id="${escapeHtml(payload?.alert_id || '')}">稍后</button>
    </div>
    <div class="card-snooze-panel${snoozeOpen ? ' visible' : ''}" data-stop>
      <button class="card-snooze-option" type="button" data-snooze="10" data-alert-id="${escapeHtml(payload?.alert_id || '')}">10 分钟后</button>
      <button class="card-snooze-option" type="button" data-snooze="30" data-alert-id="${escapeHtml(payload?.alert_id || '')}">30 分钟后</button>
      <button class="card-snooze-option" type="button" data-snooze="tomorrow-9" data-alert-id="${escapeHtml(payload?.alert_id || '')}">明天 09:00</button>
    </div>
  </article>`;
}

async function handleAction(button) {
  const action = button.dataset.action;
  const alertId = button.dataset.alertId;
  if (!alertId) {
    return;
  }
  if (action === 'toggle-snooze') {
    state.snoozeAlertId = state.snoozeAlertId === alertId ? null : alertId;
    renderReminder();
    return;
  }
  if (action !== 'complete' && action !== 'ignore') {
    return;
  }
  if (state.isAnimating) {
    return;
  }
  const card = button.closest('.reminder-stack-card');
  const animationClass = action === 'complete' ? 'completing' : 'removing';
  const animationDuration = action === 'complete' ? 440 : 380;
  state.isAnimating = true;
  card?.classList.add(animationClass);
  await wait(animationDuration);
  await api.handleReminderAction(alertId, action);
  state.snoozeAlertId = null;
  state.isAnimating = false;
  await loadReminders();
}

async function handleSnooze(button) {
  const alertId = button.dataset.alertId;
  const minutes = resolveSnoozeMinutes(button.dataset.snooze);
  if (!alertId || !minutes || minutes <= 0 || state.isAnimating) {
    return;
  }
  state.isAnimating = true;
  await api.handleReminderAction(alertId, 'snooze', minutes);
  state.snoozeAlertId = null;
  state.isAnimating = false;
  await loadReminders();
}

function jumpTo(index) {
  if (!Number.isFinite(index)) {
    return;
  }
  state.topIndex = Math.max(0, Math.min(state.reminders.length - 1, index));
  state.snoozeAlertId = null;
  renderReminder();
}

function resolveStackClass(index) {
  if (index === state.topIndex) {
    return 'stack-pos-0';
  }
  if (index === state.topIndex + 1) {
    return 'stack-pos-1';
  }
  if (index === state.topIndex + 2) {
    return 'stack-pos-2';
  }
  return 'stack-hidden';
}

function resolveUrgency(value) {
  const date = parseDateValue(value);
  if (!date) {
    return 'low';
  }
  const diff = date.getTime() - Date.now();
  if (diff < 0) {
    return 'high';
  }
  if (diff <= 30 * 60 * 1000) {
    return 'medium';
  }
  return 'low';
}

function buildDueLine(payload) {
  const date = parseDateValue(payload?.due_date);
  const dueText = payload?.dueLabel || (date ? formatDueTime(date) : '未设置截止时间');
  if (!date) {
    return `截止 ${dueText}`;
  }
  return `截止 ${dueText} · ${formatCountdown(date.getTime() - Date.now())}`;
}

function formatDueTime(date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatCountdown(diffMs) {
  if (Math.abs(diffMs) < 60000) {
    return diffMs >= 0 ? '刚刚' : '刚刚逾期';
  }
  const absMinutes = Math.round(Math.abs(diffMs) / 60000);
  const days = Math.floor(absMinutes / 1440);
  const hours = Math.floor((absMinutes % 1440) / 60);
  const minutes = absMinutes % 60;
  const parts = [];
  if (days > 0) {
    parts.push(`${days} 天`);
  }
  if (hours > 0) {
    parts.push(`${hours} 小时`);
  }
  if (minutes > 0 && days === 0) {
    parts.push(`${minutes} 分钟`);
  }
  if (parts.length === 0) {
    parts.push('1 分钟');
  }
  return diffMs >= 0 ? `还有 ${parts.join(' ')}` : `已逾期 ${parts.join(' ')}`;
}

function parseDateValue(value) {
  if (!value) {
    return null;
  }
  const normalized = String(value).includes('T') ? String(value) : String(value).replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeReminderText(value) {
  return String(value || '')
    .replace(/^定时@(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?$/u, '$1 $2 提醒')
    .replace(/^提前(\d+)(分钟|小时|天|周)$/u, '提前 $1 $2')
    .replace(/^到期时$/u, '到期时提醒');
}

function resolveSnoozeMinutes(value) {
  if (value === '10' || value === '30') {
    return Number(value);
  }
  if (value !== 'tomorrow-9') {
    return 0;
  }
  const now = new Date();
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(9, 0, 0, 0);
  return Math.max(1, Math.round((next.getTime() - now.getTime()) / 60000));
}

function wait(duration) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, duration);
  });
}