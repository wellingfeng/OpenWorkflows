# OpenWorkflow

<div align="center">
  <a href="README.md">English</a> | 中文
</div>

Claude Code 引入了 Workflow 功能，可以用脚本编排多智能体步骤、并行分支和流水线。OpenWorkflow 在这个基础上把 Workflow 做成可视化、多大模型的编辑器：同一份 Workflow 蓝图可以面向 Claude Code、Codex、Gemini，以及未来更多本地或云端大模型运行时。

统一 IR 会保留工作流结构，同时允许每个节点单独配置面向运行时的模型、提示词、schema 和执行参数。

<p align="center">
  <img src="app/doc/images/0-标题使用.png" alt="OpenWorkflow 编辑器截图" width="960">
</p>

## 使用教程

- [OpenWorkflow 使用教程](app/doc/claude-code-workflow-openworkflow.md) - 按截图顺序讲清从模型配置到蓝图生成、运行和界面风格切换的完整流程。

## 多大模型工作流支持

- OpenWorkflow 将 Claude Code 的 Workflow 思路扩展到更多大模型运行时。
- 同一份 Workflow 蓝图可以在画布中编辑，并面向 Claude Code、Codex、Gemini 或更多适配器。
- Claude Code 风格的 agent 步骤、并行分支和流水线会变成可复用的图节点。
- 每个节点都可以单独配置提示词、模型档位、schema 和执行参数。
- 当前脚本视图可以生成可运行的 Claude Code 风格 Workflow 脚本，适配层也为其他大模型运行时预留了扩展空间。

## 为什么要做这个

- 在右下角 AI 输入框描述需求，自动生成可编辑的 Workflow 蓝图。
- 用画布替代手写大段多智能体脚本，工作流结构一眼可见。
- 内置常用提示词库，方便快速做清晰度、完整性、成本、可靠性等方向的调整。
- 记录工作区和会话历史，方便回到之前的版本和上下文。
- 运行时会显示节点级状态，支持随时停止。
- 接口密钥只保存在本机，适合浏览器侧的 AI 辅助编辑。

## 快速开始

```bash
cd app
npm install
npm run dev
```

桌面端开发模式：

```bash
cd app
npm run desktop
```

打 Windows 安装包：

```bash
cd app
npm run package
```

在仓库根目录下，也可以直接使用 `run.bat` 启动应用，或用 `build.bat` 打包 Windows 安装器。

## 基本用法

1. 新建工作流，或者打开已有工作流。
2. 在右下角 AI 输入框描述需求，OpenWorkflow 会自动生成 Workflow 蓝图。
3. 继续在 AI 输入框补充要求，或者点击右侧常用提示词，持续优化结构、完整性、成本、回退等方向。
4. 必要时选中节点，手动修改提示词、模型、schema 和执行参数。
5. 选择 Claude Code、Codex、Gemini 等运行时适配器，必要时调整节点使用的模型。
6. 点击顶部运行按钮真正执行工作流，查看每个节点的执行状态，需要时随时停止。
7. 通过历史记录切换会话或工作区，继续之前的工作。

## 项目结构

```text
app/
  src/                 React + TypeScript 前端
    core/              IR、解析器、生成器、往返校验逻辑
    canvas/            React Flow 画布和节点组件
    panels/            Sidebar、提示词面板、AI 面板
    store/             Zustand 应用状态
  src-tauri/           Rust/Tauri 桌面端后端和打包配置
  doc/                 使用教程和截图
pencil/                Pencil 设计文件
run.bat                自动重建并启动 Windows 应用
build.bat              打包 Windows 安装包
```

## 相关文档

- [英文版](README.md)
- [英文使用教程](app/doc/claude-code-workflow-openworkflow.en.md)

## 验证方式

```bash
cd app
npm run typecheck
npm run lint
npm run package
```

## 许可证

目前尚未指定许可证。
