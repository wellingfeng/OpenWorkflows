# OpenWorkflow

<div align="center">
  English | <a href="README.zh-CN.md">中文</a>
</div>

Claude Code introduced a Workflow feature for orchestrating multi-agent steps, parallel branches, and pipelines as executable scripts. OpenWorkflow turns that pattern into a visual, multi-model editor: build one Workflow graph, then run or adapt it across Claude Code, Codex, Gemini, and future local or cloud model runtimes.

The shared IR keeps workflow structure portable while letting each node choose its runtime-facing model, prompt, schema, and execution settings.

![OpenWorkflow editor screenshot](docs/assets/openworkflow-editor.png)

## Multi-Model Workflow Support

- OpenWorkflow extends the Claude Code Workflow idea beyond a single LLM runtime.
- The same Workflow graph can be edited visually and targeted at Claude Code, Codex, Gemini, or additional adapters.
- Claude Code-style primitives such as agent steps, parallel branches, and pipelines become portable graph nodes.
- Each node can carry its own prompt, model tier, schema, and execution settings.
- The script view compiles the graph into runnable Claude Code-style Workflow scripts today, with the adapter layer ready for other model runtimes.

## Why OpenWorkflow

- Visual workflow authoring instead of hand-editing large multi-agent scripts.
- A reusable prompt library with common workflow rewrites and review prompts.
- Workspace and session history so you can return to earlier work quickly.
- Run/stop controls with per-node execution state on the canvas.
- Local API key storage for browser-side AI assist, kept on the machine only.

## Quick Start

```bash
cd app
npm install
npm run dev
```

For the desktop app:

```bash
cd app
npm run desktop
```

For a Windows release package:

```bash
cd app
npm run package
```

From the repository root, `run.bat` launches the app and rebuilds when needed, and `build.bat` packages the Windows installer.

## Basic Usage

1. Create a new workflow or open an existing one.
2. Pick a runtime adapter such as Claude Code, Codex, or Gemini, then tune node models as needed.
3. Select a node on the canvas to edit its prompt and parameters.
4. Use the prompt panel to apply common edits such as clarity, completeness, cost, reliability, and rollback-oriented fixes.
5. Run the workflow, watch node status updates, and stop at any time.
6. Switch sessions or workspaces from the history rail to continue earlier work.

## Project Layout

```text
app/
  src/                 React + TypeScript frontend
    core/              IR, parser, emitter, round-trip logic
    canvas/            React Flow canvas and node components
    panels/            Sidebar, prompt panel, AI dock
    store/             Zustand application state
  src-tauri/           Rust/Tauri desktop backend and packaging config
docs/                  Design and workflow references
pencil/                Pencil design files
run.bat                Build-if-needed and launch the Windows app
build.bat              Build the Windows installer
```

## More Docs

- [Chinese README](README.zh-CN.md)
- [Workflow syntax reference](docs/workflow-syntax-reference.html)
- [Design notes](docs/design.html)

## Verification

```bash
cd app
npm run typecheck
npm run lint
npm run package
```

## License

No license has been specified yet.
