/**
 * 查询单个节点，减少重复书写。
 */
export function $(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * 查询多个节点并返回数组。
 */
export function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

/**
 * 按条件切换类名。
 */
export function toggleClass(element, className, enabled) {
  element?.classList.toggle(className, enabled);
}