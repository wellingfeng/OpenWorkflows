# OpenWorkflow

OpenWorkflow 是一个 Tauri 桌面端工作流编辑器。它支持用可视化方式编排 AI 工作流，直接调整节点参数，在本地运行，并把同一份 IR 转成可执行的 Claude Code 风格脚本。

![OpenWorkflow 编辑器截图](docs/assets/openworkflow-editor.png)

## 为什么要做这个

- 用画布替代手写大段脚本，工作流结构一眼可见。
- 画布、解析器、生成器和历史记录共用同一套 IR。
- 支持多个运行时适配器，包括 Claude Code、Codex 和 Gemini。
- 支持节点级即时修改，可直接改提示词、模型、schema 和其他参数。
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
2. 选择运行时适配器，必要时调整节点使用的模型。
3. 在画布上选中节点，直接修改它的 prompt 和参数。
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
