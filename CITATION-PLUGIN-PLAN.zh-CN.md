# pi-websearch：最简 Codex-like 搜索方案

> 状态：**已按本方案完成第一轮代码清理，等待验证；尚未提交或发布。**
>
> 核心结论：我们不需要在插件里重新实现 Codex 的 citation 展示逻辑。插件只需要
> 调用 `codex-local` 的 Responses API 原生 `web_search`，拿到 Codex 生成的搜索结果，
> 再把这段结果作为 tool result 返回给外层 Pi 模型。最终答案由外层模型按照用户
> 的提示词自然组织。

## 1. 目标

用户输入：

```text
查询 OpenAI 最近的 3 条官方新闻。每条事实后面保留网页标题和完整 URL。
```

期望流程不是插件强制生成某种模板，而是：

```text
外层 Pi 模型决定需要搜索
        ↓
调用 pi-websearch 的 web_search tool
        ↓
插件调用 codex-local Responses API
        ↓
Responses 原生 web_search
        ↓
Codex 生成自然的搜索结果
        ↓
插件原样提取搜索结果文本
        ↓
作为 tool result 返回给外层 Pi 模型
        ↓
外层 Pi 模型根据原始用户提示词生成最终回答
```

外层模型可以自然输出：

- 段落；
- 列表；
- 表格；
- 网页标题 + URL；
- Markdown links；
- `[1]` / `[2]` 数字引用；
- `Sources:`；
- 用户要求的其他格式。

**最终格式由用户提示词和外层模型决定，不由插件决定。**

## 2. 为什么这是最简单的路径

之前的实现试图在插件中负责：

- 解析 `url_citation`；
- 读取标题和 URL；
- 分配 `[n]` 编号；
- 生成 `Sources:`；
- 移动来源链接；
- 去重 citation；
- 自定义 TUI entry；
- 直接终止 Pi 的后续模型调用。

这些工作实际上是在重复实现 Codex 已经完成的“搜索结果组织”能力，也会带来：

- 固定格式和自然对话体验冲突；
- 插件和外层模型之间的职责边界复杂；
- TUI、text、JSON、RPC 模式行为不一致；
- citation formatter、fallback 和 index 处理持续增加复杂度；
- 需要维护两套展示逻辑。

最简单的职责边界是：

```text
插件：负责搜索，并把搜索结果交给模型
Codex/嵌套模型：负责搜索结果的自然表达
外层 Pi 模型：负责最终回答用户
Pi TUI：负责正常显示外层模型回答
```

## 3. 最终架构：B-minimal

```text
Pi Agent
   ↓
pi-websearch custom web_search tool
   ↓
当前 codex-local Responses endpoint
   ↓
原生 Responses web_search
   ↓
嵌套 Codex 输出 output_text
   ↓
插件返回 content[0].text
   ↓
外层 Pi 模型继续生成最终答案
```

插件仍然是独立 Pi package，但不再拥有最终 citation 展示权。

### 插件负责

- 注册 `web_search` tool；
- 接收查询参数；
- 获取当前 Pi 模型的 endpoint 和认证；
- 调用原生 Responses `web_search`；
- 将原始用户请求和搜索任务传给嵌套请求；
- 提取嵌套 Responses 的文本结果；
- 将结果作为 tool result 返回给外层模型；
- 搜索失败时向外层模型报告真实错误。

### 插件不负责

- 生成 `[1]`、`[2]`；
- 生成或删除 `Sources:`；
- 重排正文；
- 移动 Markdown link；
- 根据 index 插入 citation；
- 自己生成网页标题；
- 自己猜测或补全 URL；
- 自定义 TUI 最终答案 entry；
- 使用 `terminate: true` 跳过外层模型；
- 注册 `/web-search format numbered`；
- 修改 `pi-ai`、`pi-tui`、`pi-coding-agent` 或 `node_modules`。

## 4. Nested Responses 请求

插件调用当前模型配置对应的 Responses endpoint：

```json
{
  "model": "gpt-5.6-luna",
  "input": "原始用户请求 + 搜索任务说明",
  "tools": [
    {
      "type": "web_search",
      "search_context_size": "medium"
    }
  ],
  "stream": false,
  "store": false
}
```

可选的 `include` 只用于确保后端返回完整结果；插件不依赖这些 metadata 来重新
排版最终答案。

### Nested prompt

只提供最小必要的上下文约束：

```text
Use native web search to answer the original user's request.
Return the search findings naturally for the parent model.
Follow the original user's language, count, scope, and requested output format.
Preserve exact page titles and complete URLs when the user asks for them or when they are useful.
Do not mention this nested search call or add planning commentary.
Do not invent sources or URLs.
```

不要求：

```text
必须使用 [n]
必须生成 Sources:
必须每条事实一行
必须使用固定 Markdown 模板
```

## 5. Tool result contract

插件只返回嵌套 Codex 的文本结果：

```ts
{
  content: [
    {
      type: "text",
      text: nestedOutputText,
    },
  ],
  details: {
    query,
    provider,
    model,
  },
}
```

其中 `nestedOutputText` 优先取：

1. `response.output_text`；
2. `response.output[].content[]` 中的 `output_text`；
3. 没有文本时返回明确错误。

默认不对 `nestedOutputText` 做 formatter 处理。尤其不做：

- citation 编号插入；
- Sources 追加；
- URL 替换；
- 标题替换；
- 段落重排；
- raw citation token 改写。

这样外层模型看到的就是 Codex 搜索工具返回的内容，而不是插件重新加工后的
“二次格式”。

## 6. 外层模型的职责

外层 Pi 模型会同时看到：

- 原始用户请求；
- `web_search` tool result；
- Pi 当前系统提示词和用户偏好。

因此外层模型可以完成最后一步：

```text
用户要求：每条事实后面保留网页标题和完整 URL
        ↓
外层模型读取搜索结果
        ↓
生成自然中文回答
```

或者：

```text
用户要求：使用 [1]、[2]，结尾生成 Sources
        ↓
外层模型读取搜索结果
        ↓
生成数字 citation 回答
```

或者：

```text
用户要求：用表格列出日期、标题、摘要和 URL
        ↓
外层模型读取搜索结果
        ↓
生成表格
```

插件不需要为每一种用户格式维护独立代码路径。

## 7. TUI 行为

不再使用插件自定义的 TUI-only final entry，也不隐藏正常的 tool lifecycle。

标准流程恢复为 Pi 默认行为：

```text
用户请求
  ↓
Pi 显示 web_search tool execution
  ↓
Pi 显示 tool result
  ↓
外层 Pi 模型生成最终 assistant answer
  ↓
Pi 使用默认 Markdown renderer 显示答案
```

这样 TUI、text、JSON、RPC 使用同一条逻辑路径，避免模式差异。

如果未来需要改善工具执行过程的视觉展示，应单独作为 UI 功能设计，不与 citation
逻辑绑定。

## 8. 配置和命令

稳定版本只保留搜索开关：

```text
/web-search on
/web-search off
/web-search status
```

配置：

```json
{
  "nativeWebSearch": {
    "enabled": true
  }
}
```

不提供：

```text
/web-search format numbered
```

数字引用、Sources、表格、标题 URL 等格式全部交给用户提示词和外层模型。

## 9. 错误处理

如果 nested Responses 请求失败：

- tool execution 返回错误；
- 外层模型知道搜索不可用；
- 不回退到 DuckDuckGo；
- 不回退到 `pi-web-access`；
- 不使用 bash、Python、curl、浏览器或外部搜索 API；
- 不生成猜测性的搜索结果。

如果 nested Responses 成功但没有文本：

```text
web_search returned no textual result
```

交给外层模型处理，不由插件臆造答案。

## 10. 测试范围

### 单元测试

只测试最小的响应文本提取函数：

- `response.output_text`；
- `message.content[].output_text`；
- 多个文本片段拼接；
- 忽略 `web_search_call` 和 reasoning item；
- 空响应返回空文本，由 tool 层报告错误。

HTTP 层当前使用 `stream: false`，因此不再维护 citation 或 SSE formatter。

不再测试插件自己的：

- 数字编号；
- Sources 生成；
- citation span index；
- CJK citation 插入；
- URL formatter；
- 标题 escaping formatter；
- Markdown source 重排。

### 集成测试

验证：

1. 外层 Pi 模型能够调用插件 `web_search`；
2. 插件调用 `codex-local` 原生 Responses `web_search`；
3. nested result 被完整放入 tool result 的 `content[0].text`；
4. 外层模型能根据原始提示词重新组织答案；
5. 用户要求标题和 URL 时，最终答案保留标题和 URL；
6. 用户要求数字引用时，由外层模型决定是否使用数字引用；
7. 用户要求表格时，外层模型可以生成表格；
8. 不修改 Pi 安装源码；
9. 搜索失败时不使用未授权的 fallback 搜索路径。

## 11. 安全和工程约束

- 不修改 `pi-ai`；
- 不修改 `pi-tui`；
- 不修改 `pi-coding-agent`；
- 不修改 `node_modules`；
- 不提交 API key、私有 proxy URL、session 或模型凭据；
- 使用当前 Pi 模型的正常认证配置；
- 使用 `codex-local` 的 Responses endpoint；
- 使用原生 Responses `web_search`；
- 不把 nested response 的凭据暴露给外层模型；
- 不依赖 Pi 私有 runtime bindings；
- 不要求用户安装 Pi fork 或手工 patch。

## 12. 已完成的代码清理

已按 B-minimal 方向整理工作区中的实现：

- `extensions/openai-web-search.ts` 只保留搜索请求、配置开关、响应读取和 tool result；
- 新增 `src/extract-responses-text.mjs`，只负责提取 `output_text`；
- 删除插件自己的 numbered citation formatter；
- 删除 `Sources:` 生成和来源重排逻辑；
- 删除自定义 TUI entry、`renderShell: "self"` 和 `terminate: true`；
- 删除 `format numbered` 产品路径；
- 删除旧的 citation formatter 测试；
- 新增最小响应文本提取测试；
- 更新 README、CHANGELOG 和本设计文档。

当前尚未：

- 提交 Git；
- 推送远程仓库；
- 发布 npm 或 Pi package；
- 宣称真实交互式 TUI 验收已经完成。

## 13. 下一步验证

1. 运行单元测试和语法检查；
2. 用真实 Pi 交互会话执行 `/reload`；
3. 执行 `/web-search status`；
4. 测试自然查询、标题/URL 查询、数字 citation 请求和表格请求；
5. 确认外层模型收到的是 nested Codex 的搜索结果文本；
6. 确认没有插件强制生成固定格式；
7. 验证通过后再提交和发布。

## 14. 最终确认

> 采用最简 B-minimal 方案：插件只负责调用 Codex native `web_search`，把 Codex
> 的搜索结果文本原样返回给外层 Pi 模型；最终回答格式完全交给用户提示词和外层
> 模型。插件不再负责 citation formatter、Sources、数字编号或最终 TUI 渲染。
>
> 本轮已经按该设计清理不必要代码，并将实现边界记录在本文档中。
