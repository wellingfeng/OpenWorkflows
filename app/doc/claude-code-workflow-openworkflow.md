# Claude Code 有了 Workflow，那其他大模型怎么办？我用 OpenWorkflow 跑了一遍

最近一直在看 Claude Code 的 workflows。

它吸引我的地方不是“又多了一个功能”，而是把复杂任务从一轮一轮聊天里抽出来。任务可以拆成 subagents、并行分支和流水线，再交给脚本协调执行。

这件事挺关键：workflow 不再只是一次对话里的临时安排，而是可以保存、修改、复用的流程。

我也有一个问题：如果 Workflow 会成为 AI 编程里很常用的一层，它为什么要绑在某一个模型或某一个 CLI 上？

顺着这个问题，我最近试了一下 OpenWorkflow。它把 Claude Code 这类 workflow 做成可视化画布，并尝试让同一份流程面向 Claude Code、Codex、Gemini，甚至更多本地或云端运行时。

这次我不讲抽象概念，直接按截图走一遍。例子也很具体：让 OpenWorkflow 支持多种界面风格，默认使用 Pencil，并且能在“设置 / 外观”里切换。

> 这是一篇按截图整理的使用教程，适合第一次上手 OpenWorkflow。
>
> English version: [Claude Code Has Workflows. What About Other Models? I Tried OpenWorkflow](claude-code-workflow-openworkflow.en.md)

## 0. 先看最终界面

<p align="center">
  <img src="images/0-标题使用.png" alt="OpenWorkflow 画布、历史记录、节点属性和 AI 输入区" width="960">
</p>
<p align="center"><em>图 0：OpenWorkflow 的主界面，中央是 workflow 蓝图，右侧是节点属性，底部是 AI 输入和返回。</em></p>

OpenWorkflow 的主界面大概分成四块：左侧是 workflow 历史，中央是可视化画布，右侧是节点属性和常用提示词，底部是 AI 输入与返回。

截图里的 workflow 标题是“Pencil 多风格外观方案落地”。这不是一张静态流程图，而是一套可以继续编辑、生成脚本、运行和回看历史的 workflow。

## 1. 下载 OpenWorkflow

<p align="center">
  <img src="images/1-下载.png" alt="OpenWorkflow GitHub 项目页和 Releases 入口" width="840">
</p>
<p align="center"><em>图 1：从 GitHub 项目页右侧的 Releases 找到最新版。</em></p>

最快的方式是在 GitHub 项目页右侧找到 Releases，下载最新版。截图里右侧 About 写得很清楚：它是把 Claude Code Workflows 扩展到 Codex、Gemini 和更多 LLM runtimes 的可视化编辑器。

如果你想改代码，可以直接 clone 仓库，从 `app/` 目录启动：

```bash
npm install
npm run dev
```

如果要跑桌面端，再用：

```bash
npm run desktop
```

## 2. 先配置大模型

<p align="center">
  <img src="images/2-配置大模型.png" alt="OpenWorkflow 设置中的模型配置页面" width="640">
</p>
<p align="center"><em>图 2：在“设置 / 模型”里配置 Provider、本机 CLI 和默认模型。</em></p>

第一次使用不要急着画 workflow，先打开“设置 / 模型”。这里可以配置 Provider、本机 CLI、默认模型和运行通道。

每个 Provider 会显示当前状态，比如默认、直连、CLI 运行时、不可用等。API key 会保存在本机，截图里也能看到 “Key configured · stored locally”。

如果你已经用 `cc-switch` 管理过模型配置，也可以从这里拷贝数据。后面在 AI 输入框底部，还能选择本次请求使用哪个模型或通道。

## 3. 新建 Workflow，然后输入需求

<p align="center">
  <img src="images/3-新建workflow.png" alt="新建 Workflow 并在 AI 输入框输入需求" width="840">
</p>
<p align="center"><em>图 3：点击“新建 Workflow”，在右下角 AI 输入框描述要生成的流程。</em></p>

配置好模型后，点击左侧“新建 Workflow”。画布上会出现一个最小结构：Start、一个 Agent、End。

真正开始的地方不是手动画节点，而是右下角的 AI 输入框。这个例子里，我输入的是：

```text
我希望为 OpenWorkflow 支持多种界面风格，
默认用 Pencil 来设计，
并且在“设置 / 外观”中可以切换。
```

写完后可以按 `Ctrl+Enter` 发送，也可以点右下角的发送按钮。OpenWorkflow 会把这段自然语言转成一张可编辑的 workflow 蓝图。

## 4-1. 生成 Workflow 蓝图

<p align="center">
  <img src="images/4-1生成workflow蓝图.png" alt="OpenWorkflow 根据需求生成的多节点蓝图" width="960">
</p>
<p align="center"><em>图 4-1：AI 把需求拆成并行分支、汇总节点、实现节点、验证节点和交付节点。</em></p>

发送需求后，OpenWorkflow 会先把当前步骤整改成一个完整 workflow。

截图里的蓝图大致是这样的：

```text
Start
  -> 并行梳理外观支持方案
      -> 现有外观入口调研
      -> 多风格体系设计
      -> Pencil 默认风格设计
  -> 汇总实现方案
  -> 实现多界面风格
  -> 接入设置外观切换
  -> 验证与回归检查
  -> 记录交付结果
  -> End
```

这一步最重要的不是“图好不好看”，而是它把一个模糊目标拆成了可检查的执行计划。

右侧节点属性里可以看到选中节点的 label、type、并行分支、agent type 和 schema。也就是说，生成之后仍然能继续改结构和节点配置。

## 4-2. 查看生成脚本

<p align="center">
  <img src="images/4-2蓝图脚本.png" alt="从蓝图生成的 workflow 脚本弹窗" width="960">
</p>
<p align="center"><em>图 4-2：点击顶部“脚本”，可以查看从画布生成的 workflow 脚本。</em></p>

顶部有一个“脚本”入口。点开以后，会出现当前蓝图生成的脚本。

截图里能看到 `parallel(...)` 和 `agent(...)` 这样的结构。并行节点会变成并发执行的分支，普通节点会变成一个个 agent 调用。

这一步能说明 OpenWorkflow 不是单纯画图。画布背后有统一的 workflow 结构，后面才能继续接不同运行时。

## 5. 用右侧常用提示词继续改

<p align="center">
  <img src="images/5-使用常用提示词.png" alt="右侧常用提示词面板和 AI 输入框" width="960">
</p>
<p align="center"><em>图 5：右侧常用提示词会把常见优化动作填入 AI 输入框。</em></p>

蓝图生成后，不一定马上运行。右侧“常用提示词”更适合用来继续打磨流程。

这里的提示词按场景分组，比如互动澄清、清晰度、完整性、成本、结构、可靠性、性能与并行、验证与测试。

截图里点的是“澄清需求”。它会把一段提示填入 AI 输入框，要求 AI 在修改蓝图前先用交互方式确认关键含糊点。

这个设计很实用。很多 workflow 失败不是因为模型不会做，而是因为目标、边界、失败路径和成本策略一开始没有说清楚。

## 6. 在交互选择里确认边界

<p align="center">
  <img src="images/6-交互选择.png" alt="AI 返回中的交互选择按钮" width="640">
</p>
<p align="center"><em>图 6：当需求有歧义时，AI 会给出可选项，让你先确认范围。</em></p>

点了“澄清需求”以后，AI 没有直接改图，而是先问：“背版切换功能要落地到什么范围？”

截图里给了两个选项：只落地 Pencil 默认风格并预留扩展结构，或者同时落地 Pencil 及多套可切换风格。

你选完以后，AI 才会把这个决定写回 workflow 蓝图，并输出更新后的 IRGraph。这个步骤能减少“AI 自作主张改错方向”的问题。

## 7. 点击运行

<p align="center">
  <img src="images/7-运行.png" alt="OpenWorkflow 顶部运行按钮" width="960">
</p>
<p align="center"><em>图 7：蓝图确认后，点击顶部“运行”按钮。</em></p>

等蓝图结构、模型配置和关键边界都确认后，再点顶部的“运行”。

这里建议不要一生成蓝图就跑。先看并行分支是否合理，汇总节点是否在并行分支之后，验证节点是否覆盖到最后结果。

如果某个节点只是职责不清，可以先在节点属性里改 label、prompt、agent type 或 schema，再运行。

## 8. 观察运行状态

<p align="center">
  <img src="images/8-运行中.png" alt="OpenWorkflow 运行中的节点状态和停止按钮" width="960">
</p>
<p align="center"><em>图 8：运行中按钮会变成“运行中...停止”，节点会显示当前状态。</em></p>

运行后，顶部按钮会变成“运行中...停止”。底部 AI 输入会被锁定，避免在执行中把蓝图改乱。

画布上会显示节点状态。截图里 Start 已完成，后面的并行节点正在执行，右上角也有运行计数。

这比盯一长串日志直观。失败时也不用把整个长 prompt 推倒重来，可以先定位失败节点，再改这个节点的提示词、模型或输入。

## 9. 切换界面风格

<p align="center">
  <img src="images/9-切换风格.png" alt="OpenWorkflow 设置外观中的多种界面风格" width="840">
</p>
<p align="center"><em>图 9：最终功能落在“设置 / 外观”，可以选择 Pencil、深邃午夜、极光、日光、余烬等风格。</em></p>

这个例子的目标，是让 OpenWorkflow 支持多种界面风格。最终入口就在“设置 / 外观”。

截图里可以看到 Pencil、深邃午夜、极光、日光、余烬等风格卡片。选中某个风格后，会影响全局背景、面板、边框和运行状态颜色。

这也说明 OpenWorkflow 的用法不是只做演示图。它可以把一个产品需求拆成调研、设计、实现、验证和记录交付，再交给不同节点推进。

## 我觉得真正有用的地方

OpenWorkflow 最有价值的地方，不是把 prompt 包了一层 UI。

它把“需求 -> 蓝图 -> 脚本 -> 运行 -> 回看历史”串起来了。你可以先用自然语言生成流程，再在画布上检查结构，必要时用常用提示词补边界，最后才运行。

同一份 workflow 也不必天然绑定某一个模型。简单节点可以用便宜模型，关键节点可以用更强模型，执行目标也可以继续扩展到 Claude Code、Codex、Gemini 或其他运行时。

对复杂 AI 编程任务来说，这种拆法比一个超长 prompt 更容易维护。某个节点失败了，就改那个节点；某条分支不需要，就删那条分支；想复用，就从历史里继续改。

## 和 Claude Code 是什么关系

OpenWorkflow 看起来不是要替代 Claude Code。

Claude Code 已经把 workflows 这个方向讲清楚了：复杂任务可以被写成动态脚本，可以协调多个 subagents，也可以在后台执行。

OpenWorkflow 更像是在这个方向上补一个可视化层：把 workflow 画出来、改出来、保存下来，再尝试让同一份结构适配更多模型和运行时。

所以它不是反着来，而是顺着 Claude Code Workflow 的思路往外扩。

## 现在还早，但方向值得看

OpenWorkflow 现在还不算成熟。运行时适配、节点能力和脚本生态都还会继续变。

但方向是清楚的：AI 编程不会长期停留在“开一个聊天框，然后手动推进每一步”。

复杂任务最后一定会变成 workflow。区别只是，这个 workflow 是锁在某个工具里，还是能被看见、编辑、迁移和复用。

项目地址：

https://github.com/wellingfeng/OpenWorkflow

参考：

https://code.claude.com/docs/en/workflows
