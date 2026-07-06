# 儿童英语学习打卡 PWA

一个本地优先的儿童英语启蒙计划、打卡和月度分析工具。第一版默认服务一个 4.5 岁女孩，内置 ABC Reading for RAZ、牛津树、Lingostar、Push up、小猪佩奇、布鲁伊、Little Fox 和 Numberblocks。

## 启动

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址，默认通常是 `http://127.0.0.1:5173`。

如果要同时调试 SQLite 同步后端，另开一个终端运行：

```bash
npm run dev:api
```

前端开发服务器会把 `/api` 代理到 `http://127.0.0.1:8787`。

## 功能

- 今日计划：按固定课表优先生成，再轮换分级阅读和熏听。
- 精细打卡：支持计划项计时、按计划完成、手动补录开始/结束时间。
- 月度分析：按资源、能力类型和日期统计投入时间。
- 资源库：预置资源可编辑、停用、调整默认时长和能力标签。
- 固定课表：配置 Lingostar、Push up 等每周课程。
- 数据管理：本地 IndexedDB 保存，支持 SQLite 服务器同步、JSON 备份/恢复、CSV/XLSX 月报导出。

## 数据保存和同步

默认数据保存在浏览器本机 IndexedDB，数据库名是 `english-learning-tracker`。同一台电脑、同一个浏览器、同一个访问地址会读到同一份数据；换电脑、换浏览器或换访问地址时不会自动同步。

项目现在内置一个 Node + SQLite 同步后端。它采用“整包版本同步”：每个数据空间保存一份完整学习数据，后端用 SQLite 记录 `revision` 和 `updated_at`；前端可以手动上传本机数据或拉取云端数据。

### SQLite 同步后端

同步后端使用 Node 自带的 `node:sqlite`，建议服务器安装 Node 24 或更新版本。

复制 `.env.example` 后按需设置环境变量：

```bash
PORT=8787
SYNC_DB_PATH=data/english-learning.sqlite
SYNC_TOKEN=换成自己的长随机密钥
SYNC_CORS_ORIGIN=https://你的前端域名
```

启动后端：

```bash
npm run server
```

常用接口：

- `GET /api/health`：健康检查。
- `GET /api/sync/default`：读取 `default` 数据空间。
- `PUT /api/sync/default`：上传并替换 `default` 数据空间。

如果设置了 `SYNC_TOKEN`，请求需要带 `Authorization: Bearer <SYNC_TOKEN>`。前端在“数据管理 / 服务器同步”里填写同步地址、数据空间和同步密钥即可。生产环境建议用 HTTPS，并把 SQLite 文件所在的 `data/` 目录纳入服务器备份。

### 上线方式

最简单的部署方式是让同一个 Node 服务同时提供 API 和前端静态文件：

```bash
npm run build
PORT=8787 SYNC_TOKEN=换成自己的长随机密钥 npm run server
```

后端会读取 `dist/` 作为前端静态文件目录，SQLite 文件默认写入 `data/english-learning.sqlite`。如果前端和 API 分开部署，在前端环境里设置 `VITE_SYNC_API_URL=https://你的 API 域名`。

## 验证

```bash
npm run build
npm run lint
npm audit --omit=dev
```
