# OpenWorkflow

<div align="center">
  <a href="README.md">English</a> | 中文
</div>

Claude Code 引入了 Workflow 功能，可以用脚本编排多智能体步骤、并行分支和流水线。OpenWorkflow 在这个基础上把 Workflow 做成可视化、多大模型的编辑器：同一份 Workflow 蓝图可以面向 Claude Code、Codex、Gemini，以及未来更多本地或云端大模型运行时。

统一 IR 会保留工作流结构，同时允许每个节点单独配置面向运行时的模型、提示词、schema 和执行参数。

![OpenWorkflow 编辑器截图](docs/assets/openworkflow-editor.png)

## 多大模型工作流支持

- OpenWorkflow 将 Claude Code 的 Workflow 思路扩展到更多大模型运行时。
- 同一份 Workflow 蓝图可以在画布中编辑，并面向 Claude Code、Codex、Gemini 或更多适配器。
- Claude Code 风格的 agent 步骤、并行分支和流水线会变成可复用的图节点。
- 每个节点都可以单独配置提示词、模型档位、schema 和执行参数。
- 当前脚本视图可以生成可运行的 Claude Code 风格 Workflow 脚本，适配层也为其他大模型运行时预留了扩展空间。

## 为什么要做这个

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
2. 选择 Claude Code、Codex、Gemini 等运行时适配器，必要时调整节点使用的模型。
3. 在画布上选中节点，直接修改它的提示词和参数。
4. 使用右侧常用提示词面板，快速做结构、完整性、成本、回退等方向的改动。
5. 运行工作流，查看每个节点的执行状态，需要时随时停止。
6. 通过历史记录切换会话或工作区，继续之前的工作。

## 项目结构

```text
app/
  src/                 React + TypeScript 前端
    core/              IR、解析器、生成器、往返校验逻辑
    canvas/            React Flow 画布和节点组件
    panels/            Sidebar、提示词面板、AI 面板
    store/             Zustand 应用状态
  src-tauri/           Rust/Tauri 桌面端后端和打包配置
docs/                  设计文档和工作流参考
pencil/                Pencil 设计文件
run.bat                自动重建并启动 Windows 应用
build.bat              打包 Windows 安装包
```

## 相关文档

- [英文版](README.md)
- [工作流语法参考](docs/workflow-syntax-reference.html)
- [设计说明](docs/design.html)

## 验证方式

```bash
cd app
npm run typecheck
npm run lint
npm run package
```

## 许可证

目前尚未指定许可证。
