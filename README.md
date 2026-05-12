# Zhihang Data Sync Console

本项目是一个面向内网页面数据拉取与飞书多维表同步的本地控制台，包含：

- 风险排查、变更、演练、事件四类数据抓取
- 浏览器登录态复用
- 飞书多维表覆盖同步
- 定时任务与飞书消息通知
- Windows 一键启动与停止脚本

## 使用前准备

1. 安装 Node.js 22+
2. 复制 `.env.example` 为 `.env`
3. 按实际环境填写：
   - 内网系统地址
   - 飞书应用配置
   - 多维表 app token / table id / view id
   - 消息通知群配置
4. 执行依赖安装并启动：

```powershell
npm install
.\start-dev.bat
```

停止服务：

```powershell
.\stop-dev.bat
```

## 安全说明

- `.env`、日志、构建产物、runtime、覆盖包等内容均被 `.gitignore` 排除
- 仓库中的 `.env.example` 仅保留占位值
- 请勿向公共仓提交真实 token、secret、chat id、内网域名或业务数据
