<p align="center">
  <img src="app/doc/images/openworkflows-mark.svg" alt="OpenWorkflows animated workflow mark" width="560">
</p>

<h1 align="center">OpenWorkflows</h1>

<h3 align="center">Use free and low-cost models as dynamic coding workflows.</h3>

<p align="center">
  OpenWorkflows is a local desktop coding tool that combines free-model routing with editable Dynamic Workflows. It turns cheap and free models into multi-agent flows that research, generate, challenge, vote, and retry so difficult programming tasks can get higher accuracy without sending every step to the most expensive model.
</p>

<p align="center">
  <strong>English</strong>
  &nbsp;·&nbsp;
  <a href="app/doc/README.zh-CN.md">中文</a>
  &nbsp;·&nbsp;
  <a href="app/doc/README.fr.md">Français</a>
  &nbsp;·&nbsp;
  <a href="app/doc/README.de.md">Deutsch</a>
  &nbsp;·&nbsp;
  <a href="app/doc/README.es.md">Español</a>
  &nbsp;·&nbsp;
  <a href="app/doc/README.pt-BR.md">Português</a>
  &nbsp;·&nbsp;
  <a href="app/doc/README.ru.md">Русский</a>
  &nbsp;·&nbsp;
  <a href="app/doc/README.ja.md">日本語</a>
  &nbsp;·&nbsp;
  <a href="app/doc/README.ko.md">한국어</a>
  &nbsp;·&nbsp;
  <a href="app/doc/README.hi.md">हिन्दी</a>
  &nbsp;·&nbsp;
  <a href="app/doc/README.ar.md">العربية</a>
  &nbsp;·&nbsp;
  <strong><a href="https://discord.gg/2C9ptSEFG">Discord</a></strong>
  &nbsp;·&nbsp;
  <strong>QQ Group: 149523963</strong>
</p>

<p align="center">
  <a href="app/package.json"><img src="https://img.shields.io/badge/version-0.2.2-2F6FED?style=flat-square&labelColor=161b22" alt="version 0.2.2"></a>
  <a href="app/src-tauri/tauri.conf.json"><img src="https://img.shields.io/badge/Tauri-2.11-24C8DB?style=flat-square&labelColor=161b22&logo=tauri&logoColor=white" alt="Tauri 2.11"></a>
  <a href="app/package.json"><img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&labelColor=161b22&logo=react&logoColor=white" alt="React 18"></a>
  <a href="app/package.json"><img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&labelColor=161b22&logo=typescript&logoColor=white" alt="TypeScript 5.6"></a>
  <a href="app/package.json"><img src="https://img.shields.io/badge/Vite-5.4-646CFF?style=flat-square&labelColor=161b22&logo=vite&logoColor=white" alt="Vite 5.4"></a>
  <a href="https://discord.gg/2C9ptSEFG"><img src="https://img.shields.io/badge/discord-join-5865F2?style=flat-square&labelColor=161b22&logo=discord&logoColor=white" alt="Join Discord"></a>
  <img src="https://img.shields.io/badge/QQ%20Group-149523963-12B7F5?style=flat-square&labelColor=161b22" alt="QQ Group 149523963">
</p>

<p align="center">
  <img src="app/doc/images/0-标题使用.png" alt="OpenWorkflows editor screenshot" width="960">
</p>

> [!IMPORTANT]
> **Community · 加入社区** — join the OpenWorkflows Discord or QQ group for setup help, workflow examples, feature ideas, and contributor coordination. Discord: <https://discord.gg/2C9ptSEFG> · QQ Group: `149523963`

## Why OpenWorkflows

Modern coding agents become much more reliable when they do not answer once and stop. Dynamic Workflows improve output quality by splitting a request into multiple agents, exploring from different angles, validating adversarially, and voting over competing answers. The tradeoff is cost: a serious workflow can burn through premium-model quota quickly.

OpenWorkflows makes that pattern visible, editable, and cheaper:

- Use free or low-cost channels such as Gemini, DeepSeek, Kimi, Groq, OpenRouter, NVIDIA NIM, Z.ai, Ollama, LM Studio, and llama.cpp.
- Fan out only the steps that need extra certainty; keep simple steps as single-pass calls.
- Let critical coding tasks pass through multi-angle research, adversarial review, tournament selection, or self-consistency voting.
- Route different nodes to different runtimes and model tiers, so expensive models are reserved for judgment, review, or high-risk steps.
- Keep the whole workflow graph local, inspectable, exportable, and reusable.

OpenWorkflows is not just a chat UI. It is a way to turn a collection of cheap models into a structured programming workflow.

## What It Can Do

### Free-Model Coding Chat

- **17+ built-in channels**: NVIDIA NIM, OpenRouter, Google Gemini, DeepSeek, Mistral, Mistral Codestral, Groq, Cerebras, Fireworks, Kimi, Z.ai, OpenCode, Wafer, plus local runtimes such as Ollama, LM Studio, and llama.cpp.
- Local Rust proxy translates between Anthropic and OpenAI-compatible protocols, so the same interface can talk to different providers.
- API keys stay on your machine. Local runtimes can run with zero API keys.

### Dynamic Workflow Canvas

- Generate an editable workflow blueprint from a natural-language coding goal.
- Build agent steps, parallel branches, pipelines, loops, branches, consensus nodes, and reusable composite workflows on a React Flow canvas.
- Compile the graph into runnable Claude Code-style workflow scripts, then parse scripts back into the same graph model.
- Run workflows from the desktop app while tracking node-level execution state.
- Export and import workflow graphs as portable `.owf.json` files.

### Multi-Round Accuracy Loop

OpenWorkflows supports the quality patterns that make Dynamic Workflows useful for programming:

| Pattern | Use it for | What happens |
| --- | --- | --- |
| Multi-angle research | Ambiguous requirements, architecture, migrations | Several agents inspect the same goal from different lenses before generation. |
| Adversarial validation | Security, code review, risky refactors | Candidate answers are challenged and only conclusions that survive critique are kept. |
| Tournament selection | Competing implementation plans | Multiple plans are scored; the winner can absorb useful ideas from the others. |
| Self-consistency voting | Deterministic decisions and structured outputs | The same prompt runs multiple times and the majority answer is selected. |
| Adaptive escalation | Hard nodes and final verification | The runner can start with a small sample count, measure disagreement, and add more samples only when needed. |

### Runtime and Model Routing

- Use Claude Code, Codex, Gemini, or extensible provider routing.
- Configure model/provider choices globally or per node.
- Route Claude Code through free channels via the local proxy.
- Use cheaper models for discovery and stronger models for synthesis, review, or final judgment.

### Local-First Workspace

- Sessions, favorites, history, API keys, and workflow files are stored locally.
- Chat sessions and workflow sessions are both preserved in the sidebar history.
- No hosted OpenWorkflows server is required.

## Quick Start

Run the web app from `app/`:

```bash
cd app
npm install
npm run dev
```

Vite starts at <http://localhost:5173>.

Run the desktop app:

```bash
cd app
npm run desktop
```

Build a production desktop package:

```bash
cd app
npm run package
```

From the repository root, `run.bat` rebuilds when needed and launches the Windows app. `build.bat` packages the Windows installer.

## Basic Usage

### Chat With a Free Channel

1. Click **+ New Session** in the sidebar.
2. Pick a free channel, for example Gemini, DeepSeek, Kimi, Groq, or Ollama.
3. Paste the provider API key if the channel needs one. Local runtimes need only a running local server and a model override.
4. Ask a coding question in the bottom input.
5. Star the session if you want it pinned in **Favorites**.

### Build a Coding Workflow

1. Click **+ New Workflow**.
2. Describe the programming task in the AI input: code review, migration, refactor plan, bug investigation, test generation, architecture audit, or implementation plan.
3. Let OpenWorkflows generate a blueprint, then refine it with follow-up instructions or right-panel prompt shortcuts for structure, completeness, cost, reliability, and rollback.
4. Select important nodes and configure prompt text, schema, model tier, provider, or execution parameters.
5. Convert high-risk nodes to **Consensus** when they need adversarial checking or voting.
6. Click **Run** and watch node-level status updates.

## CLI Preview

The CLI exposes two user-facing commands:

- `owf gen` generates or modifies a workflow script from natural language.
- `owf run` runs a workflow script, with dry-run and resume support.

Build it first if `app/cli/dist/owf.mjs` does not exist:

```bash
cd app
npm run cli:build
```

Then run it from the repository root:

```bash
node app/cli/dist/owf.mjs gen "Create a code-review workflow" -o review.js
node app/cli/dist/owf.mjs run review.js --dry-run
```

See [OpenWorkflows CLI usage](app/doc/openworkflows-cli-usage.md) and the [CLI skill spec](app/doc/openworkflows-cli-skill-spec.md) for details.

## How It Works

`IRGraph` is the single source of truth. The canvas, parser, emitter, AI mutation path, runtime, and local persistence all operate on the same model-agnostic graph.

```text
Coding goal
    |
    +-- Chat mode ------> simpleBlueprint -> single-node IRGraph -> free-channel proxy -> answer
    |
    +-- Workflow mode --> multi-angle research -> blueprint consensus -> IRGraph -> React Flow canvas
                                                                       |
                                                                       +--> emitter -> runnable workflow script
                                                                       |
                                                                       +--> parser  -> round-trip graph recovery
                                                                       |
                                                                       +--> runtime -> Claude Code / Codex / Gemini
                                                                                     |
                                                                                     +--> consensus / vote / retry
```

Free-channel proxy:

- Runs locally and binds to `127.0.0.1:<port>`.
- Routes each channel through `http://127.0.0.1:<port>/ch/<channelId>`.
- Translates Anthropic and OpenAI-compatible streaming protocols.
- Lets Claude Code use non-Anthropic and local providers through the same gateway path.

## Technology Stack

| Area | Technology |
| --- | --- |
| Desktop shell | Tauri 2, Rust |
| Frontend | React 18, Vite 5, TypeScript 5 |
| Canvas | React Flow / `@xyflow/react` |
| State | Zustand |
| Styling | Tailwind CSS, CSS variables |
| Icons | lucide-react |
| Workflow core | `IRGraph`, parser, emitter, round-trip checks |
| Runtime | DAG execution, provider gateway, per-node status, consensus runner |
| Free-channel proxy | Rust `tiny_http` + `ureq`, Anthropic/OpenAI protocol translation |
| Runtime adapters | Claude Code, Codex, Gemini, extensible provider routing |

## Project Structure

```text
app/
  src/
    core/        IR, parser, emitter, fixtures, consensus heuristics, round-trip checks
    canvas/      React Flow projection, node components, toolbar
    panels/      Sidebar, prompt panel, AI dock, node inspector, settings
    runtime/     DAG execution, provider gateway, consensus, run state
    store/       Zustand state and history
    lib/
      freeChannels.ts  17+ free channel catalog + helpers
  src-tauri/
    src/
      free_proxy.rs    Rust reverse proxy + Anthropic/OpenAI translation
      lib.rs           Tauri commands, filesystem/history bridge
  doc/                 Tutorials, localized READMEs, CLI docs, screenshots
docs/                  Research notes, static docs, assets
pencil/                Pencil design files
```

## Documentation

- [Usage tutorial](app/doc/claude-code-workflow-openworkflow.en.md) - walkthrough from settings and AI input to blueprint generation, running, and appearance switching.
- [Chinese usage tutorial](app/doc/claude-code-workflow-openworkflow.md)
- [OpenWorkflows CLI usage](app/doc/openworkflows-cli-usage.md)
- [OpenWorkflows CLI skill spec](app/doc/openworkflows-cli-skill-spec.md)
- [Chinese README](app/doc/README.zh-CN.md)
- [Workflow syntax reference](docs/workflow-syntax-reference.html)

## Development

Useful commands from `app/`:

```bash
npm run dev        # Vite dev server
npm run typecheck  # TypeScript check without emitting files
npm run lint       # ESLint for .ts and .tsx files
npm run test       # Vitest suite
npm run desktop    # Tauri development mode
npm run package    # Production Tauri build
```

For parser, emitter, or IR changes, run the app and use the browser console helpers exposed on `window.OpenWorkflow`, especially:

```js
OpenWorkflow.roundtrip()
OpenWorkflow.roundtripAll()
```

## Community

- Discord: <https://discord.gg/2C9ptSEFG>
- QQ Group: `149523963`
- Issues: <https://github.com/wellingfeng/OpenWorkflows/issues>
- Repository: <https://github.com/wellingfeng/OpenWorkflows>

Pull requests should describe the behavior change, list verification commands, link related issues, and include screenshots or short recordings for UI changes.

## License

No license has been specified yet.
