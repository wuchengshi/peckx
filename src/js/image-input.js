import { api } from './api.js';
import { showToast } from './utils.js';

const IMAGE_MARKDOWN_ALT = '图片';
const MAX_IMAGE_SIZE_BYTES = 8 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['image/bmp', 'bmp'],
]);

const dragDepthMap = new WeakMap();
let uploadQueue = Promise.resolve();

/**
 * 为 textarea 挂载图片粘贴与拖放能力。
 */
export function attachImageInput(textarea, options = {}) {
  if (!textarea) {
    return;
  }

  const config = {
    onValueChange: typeof options.onValueChange === 'function' ? options.onValueChange : null,
    isEnabled: typeof options.isEnabled === 'function' ? options.isEnabled : () => true,
  };

  textarea.addEventListener('paste', (event) => {
    if (!config.isEnabled()) {
      return;
    }
    const files = extractClipboardImages(event.clipboardData);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    void queueImageInsertion(textarea, files, config);
  });

  textarea.addEventListener('dragenter', (event) => {
    if (!config.isEnabled() || !hasImageFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    setDragActive(textarea, 1);
  });

  textarea.addEventListener('dragover', (event) => {
    if (!config.isEnabled() || !hasImageFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    setDragActive(textarea, 1);
  });

  textarea.addEventListener('dragleave', () => {
    if (!config.isEnabled()) {
      clearDragActive(textarea);
      return;
    }
    setDragActive(textarea, -1);
  });

  textarea.addEventListener('drop', (event) => {
    clearDragActive(textarea);
    if (!config.isEnabled()) {
      return;
    }
    const files = extractDroppedImages(event.dataTransfer);
    if (files.length === 0) {
      return;
    }
    event.preventDefault();
    void queueImageInsertion(textarea, files, config);
  });
}

/**
 * 限制拖放高亮只在真实图片拖入期间存在，避免嵌套节点反复触发 leave 后残留或闪烁。
 */
function setDragActive(textarea, delta) {
  const currentDepth = dragDepthMap.get(textarea) || 0;
  const nextDepth = Math.max(0, currentDepth + delta);
  dragDepthMap.set(textarea, nextDepth);
  textarea.classList.toggle('image-drop-active', nextDepth > 0);
}

function clearDragActive(textarea) {
  dragDepthMap.set(textarea, 0);
  textarea.classList.remove('image-drop-active');
}

/**
 * 多图按单一队列串行上传：先校验、再保存、最后插入，避免异步返回把用户原始粘贴顺序打乱。
 */
function queueImageInsertion(textarea, files, config) {
  uploadQueue = uploadQueue
    .catch(() => {})
    .then(async () => {
      for (const file of files) {
        await insertSingleImage(textarea, file, config);
      }
    });
  return uploadQueue;
}

async function insertSingleImage(textarea, file, config) {
  const extension = getImageExtension(file);
  if (!extension) {
    showToast('暂不支持该图片格式');
    return;
  }
  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    showToast('图片需小于 8MB');
    return;
  }

  try {
    const base64 = await fileToBase64(file);
    const imageUrl = await api.saveImage(base64, extension);
    const imageMarkdown = buildImageMarkdown(imageUrl);
    insertTextAtSelection(textarea, imageMarkdown);
    config.onValueChange?.(textarea.value);
    showToast('图片已插入');
  } catch (error) {
    console.error('save image failed', error);
    showToast('图片保存失败');
  }
}

function extractClipboardImages(clipboardData) {
  const items = Array.from(clipboardData?.items || []);
  return items
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function extractDroppedImages(dataTransfer) {
  return Array.from(dataTransfer?.files || []).filter((file) => file.type.startsWith('image/'));
}

function hasImageFiles(dataTransfer) {
  if (!dataTransfer) {
    return false;
  }
  if (Array.from(dataTransfer.files || []).some((file) => file.type.startsWith('image/'))) {
    return true;
  }
  return Array.from(dataTransfer.items || []).some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

function getImageExtension(file) {
  return SUPPORTED_IMAGE_TYPES.get(String(file?.type || '').toLowerCase()) || null;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('read image failed'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const commaIndex = result.indexOf(',');
      if (commaIndex < 0) {
        reject(new Error('invalid data url'));
        return;
      }
      resolve(result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

function buildImageMarkdown(imageUrl) {
  return `![${IMAGE_MARKDOWN_ALT}](${imageUrl})`;
}

function insertTextAtSelection(textarea, text) {
  const start = textarea.selectionStart ?? textarea.value.length;
  const end = textarea.selectionEnd ?? textarea.value.length;
  const currentValue = textarea.value;
  const needsLeadingBreak = start > 0 && currentValue[start - 1] !== '\n';
  const needsTrailingBreak = end < currentValue.length && currentValue[end] !== '\n';
  const insertion = `${needsLeadingBreak ? '\n' : ''}${text}${needsTrailingBreak ? '\n' : ''}`;
  textarea.value = `${currentValue.slice(0, start)}${insertion}${currentValue.slice(end)}`;
  const cursor = start + insertion.length;
  textarea.focus();
  textarea.selectionStart = cursor;
  textarea.selectionEnd = cursor;
}