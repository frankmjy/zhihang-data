# AGENTS.md
本文件基于用户修改自动生成

## 应用概览
- **类型**: 效率工具 - 网页数据提取器
- **核心功能**: 
  1. 内网URL输入与连接测试
  2. 手动触发网页数据提取
  3. 提取结果卡片展示
  4. 历史记录表格管理
- **目标用户**: 数据提取员，需要定期从内网网页获取数据的业务人员

## 设计文档

### 设计框架
**Design System-Based**: Material Design inspired management system

- **Rationale**: 选择浅色管理后台风格确保与行业标准一致，提供清晰的数据展示和良好的可读性

**Core Design Principles**:
1. **功能优先**: 所有视觉元素服务于数据提取的核心任务
2. **操作清晰**: 按钮状态明确，操作反馈即时可见
3. **信息密度**: 最大化有效信息展示，减少不必要的留白

### 全局布局架构
**当前布局**: MinimalTopNavigation

**布局特征**: 最少化导航，最大化内容空间，顶部导航仅包含应用图标与名称，移动端转为汉堡菜单

**空间约束**: 内容区域全宽可用，专注操作区与数据展示区的垂直分层布局

**可修改内容**: 导航文案、Logo，保持极简品牌透出

### 文字样式
⚠️ **字号铁律（强制约束，零容忍）**
> 所有文字元素字号**严格不得超过 text-lg (18px)**
> 这是不可突破的硬性约束，违反此规则的设计均视为不合格。
> **适用范围：** 页面内任何可见文字，包括标题、按钮、表单、表格、导航、弹窗等所有文字内容，无一例外。

**字号策略**（中文优化）：
- 页面主标题：text-lg (18px)   font-medium  【最大字号上限，不可突破】
- 卡片/模块标题：text-base (16px) font-medium
- 正文内容：text-sm (14px)    font-normal  【中文主力字号】
- 表格数据：text-sm (14px)    font-normal
- 辅助信息：text-xs (12px)    font-normal  【最小可读字号】

**字重策略**（强制约束，中文优化）：
- 最大字重限制：font-medium (500)，禁止使用 font-semibold (600) 及以上
- 中文笔画复杂，font-medium (500) 已能形成有效对比，过粗影响辨识度
- 标题/强调：font-medium (500)
- 正文/数据：font-normal (400)

**行高策略**：
- 标题：leading-snug (1.375) - leading-normal (1.5)
- 正文：leading-normal (1.5) - leading-relaxed (1.625)
- 表格/数据：leading-normal (1.5)
- 中文特性：中文行高建议最小 1.5，避免字符重叠

### 页面视觉区块

#### 组件库
**URL输入与测试区**:
- **Layout**: 顶部操作栏，flex 布局，左右分栏
- **URL输入框**: 宽版输入，text-sm，placeholder 提示格式
- **测试连接按钮**: primary 色，中等尺寸，loading 状态显示
- **提取数据按钮**: secondary 色，中等尺寸，disabled 状态管理
- **状态反馈**: 内联图标+文字，success/error 色区分

**提取结果展示区**:
- **Layout**: 卡片容器，p-6，圆角边框
- **结果卡片**: bg-card，border，内部滚动区域 max-h-96
- **内容格式**: 预格式化文本，font-mono，text-xs
- **操作按钮**: 复制按钮，icon-only，hover 状态

**历史记录表格**:
- **Layout**: 全宽表格，固定表头，分页底部
- **列定义**: 时间、URL、状态、操作（查看/复制）
- **状态标签**: badge 组件，success/error 色区分
- **分页控制**: 简洁分页，page-size 选择器

#### 页面布局
**数据提取主页**:
1. URL输入与测试区（顶部）
2. 提取结果展示区（中部）
3. 历史记录列表（底部）

#### 交互与状态
- **Loading**: 按钮 loading 状态，区域 skeleton
- **Empty**: 历史记录空状态，居中提示+图标
- **Error**: 内联错误提示，toast 通知

#### 响应式行为
- **Desktop (lg:)**: 三栏横向布局，表格全功能
- **Tablet (md:)**: 两栏布局，表格横向滚动
- **Mobile (base)**: 单栏垂直堆叠，简化操作

### 动效规范
**Hover 交互**:
- 按钮: hover:bg-opacity-90 transition-colors duration-150
- 卡片: hover:shadow-md transition-shadow duration-200
- 表格行: hover:bg-muted/50 transition-colors duration-150

**过渡效果**:
- 状态切换: transition-all duration-200 ease-in-out
- 内容展开: transition-all duration-300 ease-out

### 主题配置
**当前主题**: Light Management System - 浅色管理后台主题，以蓝色为主色调，适合企业内部数据管理系统

**配色方案**:
- 主色调: #1890ff（蓝色）
- 背景色: #ffffff（主背景）、#f5f5f5（次背景）
- 文字色: #333333（标题）、#666666（正文）、#999999（辅助）
- 边框色: #e8e8e8

**扩展 Token**: 使用现有主题配置，无需扩展

## 系统关键架构和依赖
<!-- 此章节暂时留空，等待后续更新 -->