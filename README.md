# Outlook 邮件查看器（简化版）

基于 FastAPI 的 Outlook 邮件查看系统，默认仅获取并展示“最新一封邮件”，前端采用单容器紧凑布局，支持临时账户与管理后台。

## 功能特点

- 只获取并展示最新一封邮件（更快）
- 一次性拉取完整正文（HTML/文本）并前端渲染
- 前端单容器布局，紧凑、现代、响应式
- 临时账户模式（无需改动配置文件即可测试）
- 管理后台（账户导入/导出、系统配置、标签管理）

## 目录结构

```
.
├── static/                 # 前端静态文件
│   ├── index_simple.html   # 简化版主页面（默认）
│   ├── script_simple.js    # 简化版脚本
│   ├── admin.html          # 管理页面
│   ├── admin.js            # 管理页面脚本
│   ├── style.css           # 全局样式（部分模块使用）
│   └── image*.png          # 预览图片
├── mail_api.py             # 后端主程序（FastAPI）
├── imap_client.py          # IMAP 客户端（一次性获取正文）
├── auth.py                 # OAuth2 获取/刷新 token
├── database.py             # SQLite 数据存储
├── get_refresh_token.py    # 获取 refresh_token 工具
├── requirements.txt        # 依赖
├── Dockerfile              # Docker 镜像
├── docker-compose.yml      # Docker 编排
└── README.md               # 本文档
```

## 快速开始

```bash
pip install -r requirements.txt
python mail_api.py web
```

打开浏览器访问：

- 简化版页面（默认）：http://localhost:5001/
- 管理后台：http://localhost:5001/admin

## 使用说明

1) 在简化版页面输入邮箱地址，点击“查看邮件”，将直接显示该邮箱最新一封邮件的完整内容。
2) 如需临时测试未在配置文件中的邮箱，点击“临时账户”，填入邮箱与 refresh_token 即可。
3) 管理后台支持账户导入/导出、系统配置（邮件获取条数默认已为 1）、标签管理等。

## 配置（可选）

项目仍兼容 `config.txt` 批量配置：

```
# 批量邮箱账户配置文件
# 格式：用户名----密码----client_id----refresh_token
user@example.com----password----client_id----refresh_token_here
```

> refresh_token 可通过 `python get_refresh_token.py` 获取。

## 环境变量（可选）

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| ADMIN_TOKEN | 管理后台访问令牌 | admin123 |

## 重要变更

- 默认前端改为 `index_simple.html + script_simple.js`
- 移除旧版页面与脚本：`index.html` 与 `script.js`
- 移除 `/full` 与 `/script.js` 路由（保留 `/admin` 与 `/script_simple.js`）
- 默认邮件获取条数改为 1（可在 `config.py` 中修改）

## 注意事项

- 邮件正文为原文渲染，已做基础安全过滤
- 临时账户信息仅保存在浏览器会话，不会写入服务器
- 请妥善保管 refresh_token