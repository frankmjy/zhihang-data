# risk + change 迁移测试说明

## 这个包里有什么

- risk 页面：`http://localhost:8080/`
- change 页面：`http://localhost:8080/change`
- 启动脚本：`start-dev.bat`
- 停止脚本：`stop-dev.bat`
- 新电脑初始化脚本：`install-new-pc.bat`
- 环境变量模板：`.env.example`

## 新电脑首次使用

1. 解压压缩包。
2. 进入解压后的项目目录。
3. 当前测试包会随带 `.env` 测试配置；如果后续更换飞书应用、群或多维表，再按 `.env.example` 调整对应项。
4. 如迁移后本地端口被占用，先双击 `stop-dev.bat` 再重新启动。
5. 双击 `install-new-pc.bat`，脚本会检查 Node.js 和依赖。
6. 双击 `start-dev.bat` 启动程序。

## VPN 和内网登录

启动脚本会打开一个带调试端口的浏览器窗口，并自动打开：

- risk 内网页：`https://risk.example.internal`
- change 内网页：`https://change.example.internal`
- 本地应用页：`http://localhost:8080`

先在打开的内网页完成 VPN/系统登录，再回到本地页面点击获取数据。

如果本地服务已经运行但专用浏览器被关闭，再次双击 `start-dev.bat` 会重新打开专用浏览器；后台定时任务也会在 9222 调试端口丢失时尝试自动拉起浏览器。

## change 测试口径

change 页面沿用原 change 项目的内网请求参数：

- 工单列表 URL：`https://change.example.internal/api/change/change/order/listPage`
- 工单列表 method：`POST`
- 工单列表 payload：页面默认 JSON，按环境配置补充业务参数
- 基础信息 URL：`https://change.example.internal/api/change/changeDetails/getBasicInformation`
- 基础信息 method：`POST`
- 基础信息 payload：`{"orderId": "", "userId": ""}`

合并到 risk 后，实际请求由 `/api/change/browser-fetch` 交给已登录的浏览器标签执行，用来复用 VPN/内网登录态；URL、method、payload 不变。

## 飞书同步

- risk 同步仍使用 `.env` 中的 `FEISHU_*` 配置。
- change 同步使用同一个飞书应用，默认复用 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`。
- change 多维表目标：
  - `CHANGE_FEISHU_BITABLE_APP_TOKEN=`
  - `CHANGE_FEISHU_BASIC_DATA_TABLE_ID=`
  - `CHANGE_FEISHU_BASIC_DATA_VIEW_ID=`

同步逻辑为：先删除旧数据，再写入本次拉取的最新数据，成功后发送飞书群消息。

## 自动同步时间

- risk：每天 `08:30` 同步一次。
- change：每天 `08:30`、`13:00`、`16:00` 同步三次。

## 常用地址

- risk 页面：`http://localhost:8080/`
- change 页面：`http://localhost:8080/change`
- 后端健康检查：`http://localhost:3000/api/health`

## 停止服务

双击 `stop-dev.bat`，或在命令行执行：

```powershell
npm run local:stop
```
