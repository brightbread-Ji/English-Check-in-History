# 儿童英语学习打卡 PWA

一个本地优先的儿童英语启蒙计划、打卡和月度分析工具。第一版默认服务一个 4.5 岁女孩，内置 ABC Reading for RAZ、牛津树、Lingostar、Push up、小猪佩奇、布鲁伊、Little Fox 和 Numberblocks。

## 启动

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址，默认通常是 `http://127.0.0.1:5173`。

## 功能

- 今日计划：按固定课表优先生成，再轮换分级阅读和熏听。
- 精细打卡：支持计划项计时、按计划完成、手动补录开始/结束时间。
- 月度分析：按资源、能力类型和日期统计投入时间。
- 资源库：预置资源可编辑、停用、调整默认时长和能力标签。
- 固定课表：配置 Lingostar、Push up 等每周课程。
- 数据管理：本地 IndexedDB 保存，支持 JSON 备份/恢复、CSV/XLSX 月报导出。

## 数据保存和同步

当前数据保存在浏览器本机 IndexedDB，数据库名是 `english-learning-tracker`。同一台电脑、同一个浏览器、同一个访问地址会读到同一份数据；换电脑、换浏览器或换访问地址时不会自动同步。

如果后续需要两位家长同频使用，建议升级为云端或家用共享后端，例如 Supabase/Firebase，或本地 NAS/小主机上的 Node + SQLite 服务。

## 验证

```bash
npm run build
npm run lint
npm audit --omit=dev
```
