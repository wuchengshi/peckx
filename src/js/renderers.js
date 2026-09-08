import { api } from './api.js';
import { state } from './state.js';
import { archiveMeta, categoryBadgeHTML, dueState, escapeHtml, reminderHasChannel, smartTime, trashMeta } from './utils.js';

const IMAGE_MARKDOWN_RE = /!\[([^\]]*)\]\((peckx:\/\/(?:localhost\/)?images\/[A-Za-z0-9_-]+\.(?:png|jpe?g|gif|webp|svg|bmp))\)/gi;
const CODE_FENCE_RE = /^```([A-Za-z0-9_-]+)?\s*$/;
const HORIZONTAL_RULE_RE = /^\s*(?:---|\*\*\*|___)\s*$/;
const VIEW_IMAGE_TOKEN_PREFIX = '__PECKX_IMAGE_TOKEN_';
const resolvedImageCache = new Map();

/**
 * 返回统一使用的勾选图标。
 */
function checkIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
}

/**
 * 返回统一使用的星标图标。
 */
function starIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>';
}

/**
 * 返回统一使用的图钉图标。
 */
function pinIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v6l3 3v4H9v-4l3-3V3z"></path><line x1="4" y1="21" x2="20" y2="21"></line></svg>';
}

/**
 * 返回统一使用的归档图标。
 */
function archiveIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>';
}

/**
 * 返回统一使用的删除图标。
 */
function trashIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';
}

/**
 * 返回统一使用的更多菜单图标。
 */
function moreIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>';
}

/**
 * 返回统一使用的恢复图标。
 */
function restoreIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 .49-9.36L1 10"></path></svg>';
}

/**
 * 返回统一使用的便签图标。
 */
function noteIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>';
}

/**
 * 返回统一使用的查看图标。
 */
function viewIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
}

/**
 * 返回统一使用的邮箱图标。
 */
function emailIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></svg>';
}

/**
 * 返回统一使用的短信图标。
 */
function smsIcon() {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>';
}

/**
 * 返回统一使用的待办图标容器。
 */
function todoCheckbox(completed) {
  return `<button class="checkbox ${completed ? 'checked' : ''}" data-action="toggle">${completed ? checkIcon() : ''}</button>`;
}

/**
 * 将文本渲染为列表中可显示的内容片段。
 */
// 列表默认只显示前 150 个字符，超出统一补 ...，避免不同列表的预览长度不一致。
function truncateListText(text) {
  const normalized = String(text ?? '');
  let preview = '';
  let lastIndex = 0;
  let visibleLength = 0;
  let truncated = false;
  IMAGE_MARKDOWN_RE.lastIndex = 0;

  for (const match of normalized.matchAll(IMAGE_MARKDOWN_RE)) {
    const plainText = normalized.slice(lastIndex, match.index);
    const remaining = 150 - visibleLength;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (plainText.length > remaining) {
      preview += plainText.slice(0, remaining);
      truncated = true;
      break;
    }
    preview += plainText;
    visibleLength += plainText.length;
    if (visibleLength >= 150) {
      truncated = true;
      break;
    }
    preview += match[0];
    visibleLength += 1;
    lastIndex = match.index + match[0].length;
  }

  if (!truncated) {
    const tail = normalized.slice(lastIndex);
    const remaining = 150 - visibleLength;
    if (tail.length > remaining) {
      preview += tail.slice(0, remaining);
      truncated = true;
    } else {
      preview += tail;
    }
  }

  return truncated ? `${preview}...` : preview;
}

/**
 * 将文本渲染为列表中可显示的内容片段。
 */
export function formatContent(text) {
  // 先转义全文，再只放行受限协议和扩展名的本地图片标记，避免把任意 HTML 或外部 URL 误渲染为可信内容。
  return escapeHtml(text)
    .replace(IMAGE_MARKDOWN_RE, (_, altText, imageUrl) => buildTrustedImageTag(imageUrl, altText))
    .replace(/\n/g, '<br>');
}

/**
 * 查看页使用完整 Markdown 渲染，但仍坚持先收紧可信内容边界再输出 HTML。
 * 顺序：先转义原文，再提取本地图片占位，随后只解析受控 Markdown 子集，最后恢复图片。
 * 原因：避免任意 HTML、外链脚本或不可信 URL 在“整体渲染”时被误当作安全内容插入页面。
 */
export function formatViewContent(text) {
  const normalized = String(text ?? '').replace(/\r\n?/g, '\n');
  const escaped = escapeHtml(normalized);
  const { safeText, imageTokens } = extractTrustedImages(escaped);
  return renderMarkdownBlocks(safeText, imageTokens);
}

function extractTrustedImages(text) {
  const imageTokens = [];
  const safeText = text.replace(IMAGE_MARKDOWN_RE, (_, altText, imageUrl) => {
    const token = `${VIEW_IMAGE_TOKEN_PREFIX}${imageTokens.length}__`;
    imageTokens.push(buildTrustedImageTag(imageUrl, altText));
    return token;
  });
  return { safeText, imageTokens };
}

function buildTrustedImageTag(imageUrl, altText) {
  const normalizedUrl = normalizeTrustedImageUrl(imageUrl);
  return `<img class="note-inline-image" data-peckx-src="${normalizedUrl}" alt="${altText || '图片'}" loading="lazy">`;
}

function normalizeTrustedImageUrl(imageUrl) {
  const normalized = String(imageUrl || '');
  // 规则：展示层统一把历史的 localhost 形态规范为 peckx://images/... 再交给 img。
  // 原因：旧笔记内容仍会保存 localhost URL，而当前展示只需要稳定读取本地图片，不应继续把历史 URL 形态差异暴露给 WebView 协议层。
  return normalized.replace(/^peckx:\/\/localhost\/images\//i, 'peckx://images/');
}

function renderMarkdownBlocks(text, imageTokens) {
  const lines = text.split('\n');
  const blocks = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const codeFenceMatch = line.match(CODE_FENCE_RE);
    if (codeFenceMatch) {
      const language = codeFenceMatch[1] ? escapeHtml(codeFenceMatch[1]) : '';
      const codeLines = [];
      index += 1;
      while (index < lines.length && !CODE_FENCE_RE.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      const languageAttr = language ? ` data-lang="${language}"` : '';
      blocks.push(`<pre class="markdown-code-block"><code${languageAttr}>${restoreImageTokens(codeLines.join('\n'), imageTokens)}</code></pre>`);
      continue;
    }

    if (HORIZONTAL_RULE_RE.test(line)) {
      blocks.push('<hr class="markdown-divider">');
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(headingMatch[2], imageTokens)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push(`<blockquote>${quoteLines.map((item) => renderInlineMarkdown(item, imageTokens)).join('<br>')}</blockquote>`);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      const pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/;
      while (index < lines.length && pattern.test(lines[index])) {
        items.push(lines[index].replace(pattern, ''));
        index += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      blocks.push(`<${tag}>${items.map((item) => `<li>${renderInlineMarkdown(item, imageTokens)}</li>`).join('')}</${tag}>`);
      continue;
    }

    const paragraphLines = [line];
    index += 1;
    while (index < lines.length) {
      const nextLine = lines[index];
      const nextTrimmed = nextLine.trim();
      if (!nextTrimmed || CODE_FENCE_RE.test(nextLine) || HORIZONTAL_RULE_RE.test(nextLine) || /^(#{1,6})\s+/.test(nextLine) || /^\s*>\s?/.test(nextLine) || /^\s*[-*+]\s+/.test(nextLine) || /^\s*\d+\.\s+/.test(nextLine)) {
        break;
      }
      paragraphLines.push(nextLine);
      index += 1;
    }
    blocks.push(`<p>${paragraphLines.map((item) => renderInlineMarkdown(item, imageTokens)).join('<br>')}</p>`);
  }

  return blocks.join('');
}

function renderInlineMarkdown(text, imageTokens) {
  let html = restoreImageTokens(String(text ?? ''), imageTokens);
  const codeTokens = [];

  html = html.replace(/`([^`]+)`/g, (_, code) => {
    const token = `__PECKX_INLINE_CODE_${codeTokens.length}__`;
    codeTokens.push(`<code>${code}</code>`);
    return token;
  });

  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/_([^_]+)_/g, '<em>$1</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => renderSafeLink(label, url));

  return html.replace(/__PECKX_INLINE_CODE_(\d+)__/g, (_, index) => codeTokens[Number(index)] || '');
}

function renderSafeLink(label, url) {
  const normalizedUrl = String(url || '').trim();
  if (!/^(https?:\/\/|mailto:)/i.test(normalizedUrl)) {
    return `[${label}](${url})`;
  }
  return `<a href="${normalizedUrl}" target="_blank" rel="noreferrer">${label}</a>`;
}

function restoreImageTokens(text, imageTokens) {
  return String(text ?? '').replace(/__PECKX_IMAGE_TOKEN_(\d+)__/g, (_, index) => imageTokens[Number(index)] || '');
}

/**
 * 渲染后统一为受信本地图片补 data URL：先查缓存，再请求后端。
 * 规则：同一图片 URL 只发起一次读取，请求中的 Promise 也会被复用。
 * 原因：列表、查看页、归档页可能同时出现同一张图，避免重复读取和交错回填导致的闪烁或无效请求。
 */
export async function hydrateTrustedImages(root) {
  const host = root instanceof Element ? root : null;
  if (!host) {
    return;
  }
  const images = Array.from(host.querySelectorAll('img.note-inline-image[data-peckx-src]'));
  await Promise.all(images.map((image) => hydrateSingleTrustedImage(image)));
}

async function hydrateSingleTrustedImage(image) {
  const imageUrl = image.dataset.peckxSrc;
  if (!imageUrl) {
    return;
  }
  try {
    let pending = resolvedImageCache.get(imageUrl);
    if (!pending) {
      pending = api.loadImageDataUrl(imageUrl);
      resolvedImageCache.set(imageUrl, pending);
    }
    const dataUrl = await pending;
    if (typeof dataUrl === 'string' && dataUrl) {
      image.src = dataUrl;
    }
  } catch (error) {
    resolvedImageCache.delete(imageUrl);
    console.error('hydrate trusted image failed', imageUrl, error);
  }
}

/**
 * 生成随记列表卡片 HTML。
 */
export function renderNoteItem(note) {
  return `
    <div class="list-item ${note.starred ? 'is-starred' : ''}" data-id="${escapeHtml(note.id)}" data-type="note">
      <div class="item-icon">${noteIcon()}</div>
      <div class="item-content">
        <div class="item-title">${formatContent(truncateListText(note.content))}</div>
        <div class="item-meta-row">
          <div class="item-meta">
            ${categoryBadgeHTML(note.category)}
            <span class="item-time">${smartTime(note.updated_at || note.created_at)}</span>
          </div>
          <div class="item-actions">
            <button class="item-action-btn" data-action="view" title="查看">${viewIcon()}</button>
            <button class="item-action-btn ${note.starred ? 'starred' : ''}" data-action="toggle-star" title="星标">${starIcon()}</button>
            <button class="item-action-btn" data-action="more" title="更多">${moreIcon()}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 生成待办列表卡片 HTML。
 */
export function renderTodoItem(todo) {
  const due = dueState(todo.due_date);
  const reminderIcons = renderReminderChannelIcons(todo.reminders);
  const isReminding = state.reminder.activeTodoIds.includes(todo.id);
  return `
    <div class="list-item ${todo.completed ? 'completed' : ''} ${todo.starred ? 'is-starred' : ''} ${isReminding ? 'is-reminding' : ''}" data-id="${todo.id}" data-type="todo">
      <div class="item-icon">${todoCheckbox(todo.completed)}</div>
      <div class="item-content">
        <div class="item-title">${formatContent(truncateListText(todo.title))}</div>
        <div class="item-meta-row">
          <div class="item-meta">
            ${categoryBadgeHTML(todo.category)}
            ${due ? `<span class="item-due ${due.tone}">${escapeHtml(due.label)}</span>` : ''}
            ${todo.repeat?.label ? `<span class="item-repeat">${escapeHtml(todo.repeat.label)}</span>` : ''}
            <span class="item-time">${smartTime(todo.updated_at || todo.created_at)}</span>
            ${reminderIcons}
          </div>
          <div class="item-actions">
            <button class="item-action-btn ${todo.starred ? 'starred' : ''}" data-action="toggle-star" title="星标">${starIcon()}</button>
            <button class="item-action-btn" data-action="more" title="更多">${moreIcon()}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

/**
 * 生成联合列表卡片 HTML。
 */
export function renderAllItem(item) {
  if (item.item_type === 'note') {
    return renderNoteItem({
      id: item.id,
      content: item.content,
      category: item.category,
      starred: item.starred,
      pinned: item.pinned,
      updated_at: item.updated_at,
      created_at: item.created_at,
    });
  }
  return renderTodoItem({
    id: Number(item.id),
    title: item.content,
    category: item.category,
    starred: item.starred,
    completed: item.completed,
    due_date: item.due_date,
    reminders: item.reminders,
    repeat: item.repeat,
    updated_at: item.updated_at,
    created_at: item.created_at,
  });
}

/**
 * 条目列表只展示用户额外选择的提醒渠道，避免默认软件提醒在每条待办上重复占位。
 */
function renderReminderChannelIcons(reminders) {
  const hasEmail = Array.isArray(reminders) && reminders.some((item) => reminderHasChannel(item, 'email'));
  const hasSms = Array.isArray(reminders) && reminders.some((item) => reminderHasChannel(item, 'sms'));
  if (!hasEmail && !hasSms) {
    return '';
  }
  return `<span class="item-reminder-icons" aria-label="提醒渠道">${hasEmail ? `<span class="item-reminder-icon" title="邮箱提醒">${emailIcon()}</span>` : ''}${hasSms ? `<span class="item-reminder-icon" title="短信提醒">${smsIcon()}</span>` : ''}</span>`;
}

/**
 * 生成垃圾桶条目 HTML。
 */
export function renderTrashItem(item) {
  const meta = trashMeta(item.deleted_at || item.updated_at);
  return `
    <div class="trash-item" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.item_type)}">
      <div class="trash-item-icon">${item.item_type === 'note' ? noteIcon() : checkIcon()}</div>
      <div class="trash-item-content">
        <div class="trash-item-title">${formatContent(item.content)}</div>
        <div class="trash-item-meta">
          <span class="trash-type-badge">${item.item_type === 'note' ? '随记' : '待办'}</span>
          <span>删除于 ${escapeHtml(meta?.deletedLabel || smartTime(item.deleted_at || item.updated_at))}</span>
          <span class="trash-retain ${meta?.tone || 'normal'}">${escapeHtml(meta?.remainLabel || '')}</span>
        </div>
      </div>
      <div class="trash-item-actions">
        <button class="trash-action-btn restore-btn" data-action="restore" title="恢复">${restoreIcon()}</button>
        <button class="trash-action-btn delete-btn" data-action="delete" title="彻底删除">${trashIcon()}</button>
      </div>
    </div>
  `;
}

/**
 * 生成归档条目 HTML。
 */
export function renderArchiveItem(item) {
  return `
    <div class="archive-item" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.item_type)}">
      <div class="archive-item-icon">${item.item_type === 'note' ? noteIcon() : checkIcon()}</div>
      <div class="archive-item-content">
        <div class="archive-item-title">${formatContent(item.content)}</div>
        <div class="archive-item-meta">
          <span class="archive-type-badge">${item.item_type === 'note' ? '随记' : '待办'}</span>
          <span>${escapeHtml(archiveMeta(item.updated_at, item.created_at) || smartTime(item.updated_at))}</span>
        </div>
      </div>
      <div class="archive-item-actions">
        <button class="archive-action-btn unarchive-btn" data-action="restore" title="取消归档">${restoreIcon()}</button>
        <button class="archive-action-btn delete-btn" data-action="delete" title="删除">${trashIcon()}</button>
      </div>
    </div>
  `;
}

/**
 * 生成分页按钮 HTML。
 */
export function renderPagination(page, totalPages) {
  if (totalPages <= 1) {
    return '';
  }
  const buttons = [];
  buttons.push(`<button class="page-btn" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>上一页</button>`);
  for (const token of buildPageTokens(page, totalPages)) {
    if (token === '...') {
      buttons.push('<button class="page-btn ellipsis" disabled>...</button>');
      continue;
    }
    buttons.push(`<button class="page-btn ${token === page ? 'active' : ''}" data-page="${token}">${token}</button>`);
  }
  buttons.push(`<button class="page-btn" data-page="${page + 1}" ${page >= totalPages ? 'disabled' : ''}>下一页</button>`);
  return buttons.join('');
}

/**
 * 生成带省略号的页码序列，避免分页很多时把底栏撑爆。
 */
function buildPageTokens(page, totalPages) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const tokens = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(totalPages - 1, page + 1);
  if (start > 2) {
    tokens.push('...');
  }
  for (let index = start; index <= end; index += 1) {
    tokens.push(index);
  }
  if (end < totalPages - 1) {
    tokens.push('...');
  }
  tokens.push(totalPages);
  return tokens;
}

/**
 * 生成完成待办条目，恢复操作会重新回到活跃待办列表。
 */
export function renderCompletedTodo(todo) {
  const completedTime = todo.completed_at || todo.updated_at || todo.created_at;
  return `
    <div class="completed-item" data-id="${todo.id}">
      <div class="completed-item-icon">${checkIcon()}</div>
      <div class="completed-item-content">
        <div class="completed-item-title">${formatContent(todo.title)}</div>
        <div class="completed-item-meta">
          ${categoryBadgeHTML(todo.category)}
          <span>完成于 ${escapeHtml(smartTime(completedTime))}</span>
        </div>
      </div>
      <div class="completed-item-actions">
        <button class="completed-action-btn restore-btn" data-action="restore" title="恢复为未完成">${restoreIcon()}</button>
        <button class="completed-action-btn delete-btn" data-action="delete" title="移入垃圾桶">${trashIcon()}</button>
      </div>
    </div>
  `;
}