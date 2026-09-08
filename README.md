# peck-x

peck-x 是一个基于 Tauri 2 + Rust + 原生 HTML/CSS/JavaScript 的桌面端个人效率工具，提供随记与待办双模式输入、分类管理、提醒、归档、垃圾桶以及系统托盘常驻能力。

这个目录用于发布到 GitHub，已经整理出可直接编译的前后端源码与安装包配置。用户从源码编译后，将得到 Windows 安装程序，而不是依赖手工摆放数据目录的绿色版。

## 功能概览

- 双模式输入：支持待办与随记快速录入
- 待办元数据：支持分类、截止时间、提醒、重复规则、备注
- 随记内容：支持长文本记录与图片插入
- 列表浏览：支持首页预览、完整列表、搜索与分类筛选
- 状态管理：支持星标、完成、归档、删除与恢复
- 垃圾桶：软删除后保留，支持自动清理
- 提醒能力：支持应用内提醒，邮件链路可选
- 系统集成：支持全局快捷键、开机自启动、托盘驻留

## 技术栈

- 桌面框架：Tauri 2
- 后端：Rust
- 前端：原生 ES Modules + HTML5 + CSS3
- 数据存储：本地文件系统
- 邮件发送：lettre SMTP

## 目录结构

```text
peckx/
├── README.md
├── .gitignore
├── package.json
├── package-lock.json
├── src/                 # 前端页面、样式、脚本、静态资源
├── src-tauri/           # Rust 后端与 Tauri 配置
└── .github/
    └── workflows/       # 基础 CI 检查
```

## 运行环境

在 Windows 上编译前，请先准备以下环境：

- Node.js 20 或更高版本
- Rust stable toolchain
- Microsoft Visual Studio C++ Build Tools
- WebView2 Runtime

如果你需要完整的 Tauri 环境说明，可参考 Tauri 官方 prerequisites 文档。这个仓库本身已经包含 Tauri CLI 依赖，安装 Node 依赖后可直接通过 npx 调用。

## 安装依赖

在仓库根目录执行：

```bash
npm install
```

## 开发运行

```bash
npm run dev
```

## 编译发布

生成 Windows 安装程序：

```bash
npm run build
```

如需仅生成未封装的调试可执行文件：

```bash
npm run build:no-bundle
```

常见输出位置：

- 未封装可执行文件：src-tauri/target/release/peckx.exe
- NSIS 安装程序：src-tauri/target/release/bundle/nsis/

## 配置说明

安装版不会把用户数据放到安装目录。默认情况下，程序会把运行数据放到系统用户数据目录：

- Windows: %AppData%/com.peckx.desktop/

首次启动时，程序会自动创建缺失的配置文件、待办数据文件、随记目录和图片目录，用户不需要手工准备模板文件。

### 用户配置

运行后，应用会自动创建运行数据目录。用户配置文件位于：

```text
%AppData%/com.peckx.desktop/config.json
```

如果程序无法获取系统 app data 目录，才会回退到可执行文件同目录下的 peckxData/config.json。

示例：

```json
{
  "auto_start": false,
  "shortcut_toggle": "Alt+X",
  "completed_retention_days": 7,
  "trash_retention_days": 7,
  "home_preview_count": 8,
  "notification_email": "receiver@example.com",
  "notification_phone": ""
}
```

字段说明：

- auto_start：是否开机自启动
- shortcut_toggle：显示或隐藏主窗口的全局快捷键
- completed_retention_days：已完成待办保留天数
- trash_retention_days：垃圾桶条目保留天数
- home_preview_count：首页预览条数
- notification_email：提醒邮件接收邮箱
- notification_phone：预留字段，当前未启用短信链路

### 邮件提醒配置

邮件提醒除了用户配置中的 notification_email，还依赖系统级 SMTP 配置文件：

```text
%AppData%/com.peckx.desktop/sys-config.json
```

同样地，只有在系统 app data 目录不可用时，才会回退到可执行文件同目录下的 peckxData/sys-config.json。

示例：

```json
{
  "email_reminder_enabled": true,
  "smtp_host": "smtp.yeah.net",
  "smtp_port": 465,
  "smtp_username": "your_account@yeah.net",
  "smtp_password": "your_smtp_password",
  "smtp_sender_email": "your_account@yeah.net",
  "smtp_sender_name": "peck-x",
  "smtp_ssl": true
}
```

字段说明：

- email_reminder_enabled：是否启用邮件提醒
- smtp_host：SMTP 服务器地址
- smtp_port：SMTP 端口
- smtp_username：SMTP 登录账号
- smtp_password：SMTP 密码或授权码
- smtp_sender_email：发件人邮箱
- smtp_sender_name：发件人名称
- smtp_ssl：是否使用 SSL

邮件提醒规则：

- 只有在 notification_email 已填写且 SMTP 配置完整时，邮件提醒才会正常发送
- 测试邮件可用于验证 SMTP 链路是否可用
- 没有截止时间的待办不允许保留提醒，避免出现无法触发的无效提醒

## 数据目录

运行后生成的数据目录结构示意：

```text
%AppData%/com.peckx.desktop/
├── config.json
├── sys-config.json
├── todos.json
├── images/
└── notes/
```

说明：

- notes/：随记正文与元数据
- images/：图片附件
- todos.json：待办列表数据
- config.json：用户侧配置
- sys-config.json：SMTP 等系统级配置
- 如果系统 app data 目录不可用，程序会回退到可执行文件同目录下的 peckxData/。

更标准的仓库发布方式通常是：

- 提交源码目录 src 和 src-tauri
- 忽略真实运行目录 peckxData
- 忽略 node_modules 和 src-tauri/target 等构建产物

## 首次使用

1. 安装 Node.js、Rust 和 Tauri 依赖环境。
2. 在仓库根目录执行 npm install。
3. 执行 npm run build 生成安装程序，或执行 npm run dev 进行开发调试。
4. 运行安装程序，按安装界面选择安装位置。
5. 首次启动后，程序会在系统用户数据目录中自动创建 notes、images、todos.json、config.json 和 sys-config.json。

## 代码说明

- src/：前端界面与交互逻辑
- src/js/api.js：前端到 Tauri invoke 的统一封装
- src-tauri/src/main.rs：应用入口、托盘、快捷键、窗口管理
- src-tauri/src/commands.rs：前后端命令桥接
- src-tauri/src/store.rs：核心数据读写与业务规则
- src-tauri/src/reminders.rs：提醒调度、提醒动作、邮件发送

## GitHub 发布建议

建议将这个 peckx 目录作为独立仓库根目录上传到 GitHub。上传前可再确认以下内容：

- 不要提交 node_modules
- 不要提交 src-tauri/target
- 不要提交本地 peckxData 用户数据

## 快速自检

编译前可先执行：

```bash
npm run check
```

如果 cargo check 通过，通常说明 Rust 侧源码结构和依赖声明是完整的。