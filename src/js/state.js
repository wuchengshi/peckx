/**
 * 保存当前应用运行期状态，供各模块共享读写。
 */
export const state = {
  mode: 'todo',
  expanded: false,
  categories: [],
  notes: [],
  todos: [],
  config: {
    auto_start: false,
    shortcut_toggle: 'Alt+X',
    completed_retention_days: 7,
    trash_retention_days: 7,
    home_preview_count: 8,
    notification_email: '',
    notification_phone: '',
  },
  activeView: 'home',
  popover: {
    visible: false,
    cleanup: null,
  },
  composer: {
    category: null,
    dueDate: null,
    reminders: [],
    repeat: null,
  },
  fullList: {
    query: '',
    category: '',
    page: 1,
    pageSize: 20,
    items: [],
    total: 0,
  },
  trash: {
    query: '',
    items: [],
  },
  archive: {
    query: '',
    type: 'todo',
    items: [],
  },
  completed: {
    query: '',
    items: [],
  },
  editor: {
    noteId: null,
    category: null,
    returnView: 'home',
    readOnly: false,
  },
  noteViewer: {
    noteId: null,
    returnView: 'home',
  },
  drawer: {
    todoId: null,
    returnView: 'home',
    readOnly: false,
  },
  reminder: {
    activeTodoIds: [],
  },
};

/**
 * 重置待办输入区元数据。
 */
export function resetComposerMeta() {
  state.composer.category = null;
  state.composer.dueDate = null;
  state.composer.reminders = [];
  state.composer.repeat = null;
}
