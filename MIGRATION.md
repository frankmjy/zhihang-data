# 迁移说明

## 迁移包说明

- `完整包`：包含 `node_modules`，解压后更快启动，但体积更大。
- `轻量包`：不包含 `node_modules` 和随包 Node，体积更小；首次在新电脑上运行时会自动安装 Node.js，并执行 `npm install` 下载依赖。

## 新电脑首次安装

1. 解压迁移包。
2. 双击 `install-new-pc.bat`。
3. 如果电脑没有 Node.js，脚本会优先尝试通过 Windows `winget` 安装 Node.js LTS。
4. 如果包里没有 `node_modules`，脚本会自动执行 `npm install` 下载依赖。
5. 如果脚本提示无法自动安装 Node.js，请手动安装 Node.js 22 或更高版本：https://nodejs.org
6. 看到检查通过即可。

## 日常启动

1. 先登录 VPN。
2. 双击 `start-dev.bat`。
3. 脚本会启动本地服务，并拉起浏览器。
4. 在打开的内网页面完成登录。
5. 回到 `http://localhost:8080`，点击“获取数据”。

## 页面保活

- 启动后会默认对内网页签保活。
- 默认每 5 分钟自动刷新一次内网页面。
- 可以在 `.env` 中调整：
  - `RISK_KEEPALIVE_ENABLED=true|false`
  - `RISK_KEEPALIVE_INTERVAL_MS=300000`
  - `RISK_KEEPALIVE_START_DELAY_MS=30000`

## 自动同步

- 启动后会默认开启自动同步调度。
- 默认每天 `08:00` 自动执行一次“更新当月 A-E 楼编号 -> 数据拉取 -> 清空多维表 -> 写入新数据 -> 飞书群通知”。
- 可以在 `.env` 中调整：
  - `RISK_AUTO_SYNC_ENABLED=true|false`
  - `RISK_AUTO_SYNC_HOUR=8`
  - `RISK_AUTO_SYNC_MINUTE=0`

## 楼栋编号自动更新

- 页面中的“更新楼栋编号测试”会从内网排查记录列表自动识别当月南通 A/B/C/D/E 楼最新记录编号。
- “获取数据”和后台自动同步都会先自动刷新楼栋编号，再拉取明细数据。
- 排查记录列表接口可在 `.env` 中调整：
  - `RISK_RECORD_LIST_API_PATH=/api/ab-bpm/biz/bizCustGrid/view/fxgl_xcydfxpcjlsjlb`

## 停止服务

双击 `stop-dev.bat`。

## 说明

- 完整离线依赖包已经包含 `node_modules`，正常情况下不需要执行 `npm install`。
- 轻量包首次安装依赖时需要联网访问 npm。
- 如果你使用的是完整包，则正常情况下不需要执行 `npm install`。
- 如果 `node_modules` 被删除，`install-new-pc.bat` 会在检测到 `npm` 可用时自动执行 `npm install` 修复依赖。
- 压缩包不包含 `.run`、`dist`、`logs` 等运行临时文件。
- `.env` 已随项目保留，端口和内网地址配置会一起迁移。
