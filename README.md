# Conveditor · 动画 AI 作画工作室

题 B 的可运行实现：围绕 **绘画 → 评估 → 选择建议 → 生成候选 → 对比采纳 → 继续绘画** 组织人机协作。React / TypeScript / react-konva 前端，FastAPI 后端；评估与图像编辑均使用真实云端接口，密钥只在后端保存。

## 已实现

- 1024 × 1024 画布：画笔、颜色、笔宽、橡皮、撤销/重做、PNG/JPEG/WebP 导入与 PNG 导出。非正方形图片等比置于白色画布中。
- 点击顶部画稿名称即可命名，按 Enter 或点击别处确认；名称随工作区自动保存，刷新后保留。
- 草稿、线稿、上色三种阶段；创作目标、保留要求及矩形修改选区。
- 框选后在选区旁弹出对话窗，可连续提问或点击“修改选区”按文字要求生成局部候选。支持收起/展开、Ctrl / ⌘ + Enter 发消息，浮窗随滚动及窗口尺寸调整位置。悬停或聚焦“选区”按钮可查看操作说明。
- 多模态评估返回画面总结、优点及至多 5 条建议，每条包含可见证据、修正动作、理由、优先级和问题位置。
- 评估流程中用户明确勾选建议后才生成候选；选区对话中由用户明确点击“修改选区”发起生成。聊天不会自动触发改图。
- 滑动/并排对比；放弃保持原图，采纳后保存新版本。生成指令可展开查看。
- 最近 20 个画稿版本、恢复前对尚未留档的画稿及创作要求自动留档，以及 IndexedDB 工作区自动保存。支持逐个删除版本，删除不影响当前画稿。采纳结果能继续手绘，刷新能恢复当前画稿。
- 配置、鉴权、额度、超时、上游拒绝和格式错误的失败提示；不自动重试计费调用。

工作流、Prompt 场景设计与验收用例见 [docs/workflow.md](docs/workflow.md)，模块边界见 [AGENTS.md](AGENTS.md)。

## 环境与模型配置

需要 Node.js 22.12+（或 20.19+）、Python 3.11+ 和 uv。

在项目根目录复制配置：

```powershell
Set-Location D:\conveditor
Copy-Item .env.example .env
```

在 `.env` 中填写自己的密钥，已有 `.env` 时直接编辑，勿覆盖：

```dotenv
OPENAI_API_KEY=你的服务端密钥
OPENAI_BASE_URL=https://api.openai.com/v1
EVALUATION_MODEL=gpt-4.1-mini
IMAGE_EDIT_MODEL=gpt-image-2
MODEL_TIMEOUT_SECONDS=180
```

评估与图片编辑默认共用 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL`。需要为图片编辑使用另一家服务时，在 `.env` 中设置 `IMAGE_EDIT_API_KEY` 和 `IMAGE_EDIT_BASE_URL`；未填写的项继续使用对应的 `OPENAI_*` 配置，评估服务不受影响。

默认评估调用 Responses API 的图片输入和严格结构化输出；修正使用 `gpt-image-2` 的 Images Edit API，以 multipart 上传完整画稿，有选区时同时上传同尺寸 PNG 遮罩，并读取完整候选的 base64 PNG。接口实现参考 [OpenAI 结构化输出文档](https://developers.openai.com/api/docs/guides/structured-outputs)、[图片输入文档](https://developers.openai.com/api/docs/guides/images-vision) 与 [图像编辑文档](https://developers.openai.com/api/reference/python/resources/images/methods/edit)。模型名称可以配置；使用兼容服务时，图片编辑服务需支持 `image` 与 `mask` 文件，各服务需支持对应的调用协议，仅支持 Chat Completions 的服务不能直接用于评估。

密钥需要对应模型的访问权限和可用额度。未配置时可以使用画布，AI 操作不可用。更改配置后重启后端并刷新页面。`/api/health` 的 `configured` 仅代表密钥已填写，不代表额度、模型权限或网络已验证。

## 启动

开发模式，在两个终端分别运行：

```powershell
Set-Location D:\conveditor\backend
uv sync --locked
uv run uvicorn conveditor.main:app --host 127.0.0.1 --port 8000
```

```powershell
Set-Location D:\conveditor\frontend
npm ci
npm run dev
```

打开 <http://localhost:5173>。Vite 会将 `/api` 转发到 `127.0.0.1:8000`。API 文档：<http://127.0.0.1:8000/docs>。

也可以只运行一个后端服务：先在 `frontend/` 执行 `npm run build`，再启动上述后端。FastAPI 会提供 `frontend/dist` 静态页面，打开 <http://127.0.0.1:8000> 即可。端口占用时可改为 `--port 8001` 并直接打开该端口；开发模式下则需同步修改 Vite 代理。

## VS Code 调试

用 VS Code 打开项目根目录 `D:\conveditor`，安装 `.vscode/extensions.json` 推荐的 **Python** 和 **Python Debugger** 扩展。先按“启动”一节执行 `uv sync --locked` 和 `npm ci` 安装依赖；调试配置会启动服务，无需提前运行启动命令。

按 `Ctrl+Shift+D` 打开“运行和调试”，选择配置后按 `F5`：

| 配置 | 行为 |
| --- | --- |
| 全栈：FastAPI + Vite + Edge | 先启动后端，后端就绪后启动 Vite，前端就绪后自动打开带调试器的 Edge。 |
| 后端：FastAPI | 只调试后端，可打开 `http://127.0.0.1:9002/docs` 发送请求。 |
| 前端：Vite + Edge | 启动 Vite 和 Edge，调试 React / TypeScript；调用 API 时需要后端已在 9002 端口启动。 |

在 `backend/src/conveditor/` 的 Python 文件或 `frontend/src/` 的 TypeScript / TSX 文件行号旁点击设置断点，然后在页面触发对应操作。可先在 `backend/src/conveditor/api/routes/health.py` 的 `settings = get_settings()` 行设置断点，刷新页面验证后端断点；前端可在 `frontend/src/app/App.tsx` 的操作处理函数中设置断点。

调试使用后端 9002、前端 5175，页面地址为 `http://localhost:5175`。前端调试通过 `--port` 指定端口，通过 `CONVEDITOR_API_PROXY` 设置 API 代理；普通终端启动仍默认使用后端 8000、前端 5173。以后修改调试端口时，需同步更新 `.vscode/launch.json` 中两个后端配置的 `args`、后端就绪匹配、前端 `args`、API 代理和前端就绪匹配。

后端调试固定使用 `backend/.venv/Scripts/python.exe`，读取根目录 `.env`，不开启 Uvicorn 自动重载；修改 Python 后重启后端调试会话，前端仍支持 Vite 热更新。若编辑器选择了其他 Python 环境，执行 `Python: Select Interpreter` 并选择该虚拟环境。启动前确保 9002、5175 端口没有其他服务或 SSH 转发占用。

全栈调试结束时，在调试工具栏选择 **全栈：FastAPI + Vite + Edge** 会话再停止；停止后端会连带停止 Vite 和浏览器调试会话。单独关闭浏览器调试会话不会停止服务。若使用 Chrome，将 `.vscode/launch.json` 中前端的 `serverReadyAction.action` 改为 `debugWithChrome`。配置字段参考 [VS Code 调试配置文档](https://code.visualstudio.com/docs/debugtest/debugging-configuration)。

## 演示流程

1. 点击“载入狐狸信使示例”，或导入自己的画稿；在画布上修改几笔。示例是原创矢量草稿，不是 AI 生成结果。
2. 选择“草稿”，写明希望改善的动作；在“保留要求”写下角色特征和画风。需要局部修改时切换“选区”，拖出矩形。
3. 点击“评估当前画稿”。模型会收到实际画面、阶段和创作资料；评估前的画稿自动成为一个历史版本。
4. 阅读证据和修正动作，勾选认可的建议；可补充“只做小幅调整”等要求，再生成候选。
5. 使用滑动或并排对比。采纳会更新画布并保存版本；放弃可调整所选建议再次生成。
6. 继续绘画后旧评估会失效，需要重新评估。点击历史缩略图可恢复，恢复前尚未留档的画稿及创作要求会自动保存；重复点击当前版本或在已保存版本间切换不会新增副本。点击卡片上的“删除”可移除该版本，当前画稿保持不变。

## 选区对话与直接修改

框选任意局部，在浮窗输入问题并点击“发送消息”，LLM 将结合整幅画面、选区细节和同一会话的上下文回复。输入明确修改要求（例如“把围巾改成浅蓝色，保留轮廓线”）并点击“修改选区”，即可直接生成，无需先做整图评估。要求不清楚时，LLM 会先提问。

生成会把完整原图与同尺寸遮罩交给图像模型：选区完全透明、框外不透明。模型返回完整画稿后，应用保留选区内生成结果，并恢复框外原始像素及透明度，防止模型越界调色或改变背景。采纳前仍需检查框内非目标部位和边缘衔接。重新框选、修改画稿或创作要求都会开启新对话；改画稿名称不影响当前对话。刷新会恢复画稿和选区，但不恢复聊天窗口中的历史消息。后端保留最近 10 轮上下文。

## 检查

```powershell
Set-Location D:\conveditor\backend
uv run pytest -q

Set-Location D:\conveditor\frontend
npm run build
npx playwright install chromium
npm test
```

后端测试覆盖 API 校验、已选建议约束、源图保护、遮罩坐标与透明度、框外原色及透明度保护、失败重试、三个阶段的 Prompt，以及通过本地 HTTP 服务器验证真实 OpenAI SDK 的原图与遮罩 multipart 请求/响应协议。浏览器测试覆盖绘画、撤销、框选、持久化、旧评估失效、候选采纳/放弃和移动布局。

**自动化测试不消耗模型额度，也不证明真实生成质量。** 生产代码无 MOCK 分支；真实云端验收必须配置有效密钥，按上面的演示流程跑完一次评估和生成，人工检查模型输出。

## 数据与当前边界

- 浏览器 IndexedDB 保存当前画稿和版本；清理网站数据会丢失这些记录。不同域名/端口是不同工作区。导出 PNG 可独立备份。
- 后端 `data/` 保存评估原图、评估结果、选区会话、候选图片和生成指令。目录和 `.env` 均已加入忽略规则。可通过 `DATA_DIR` 指定绝对存储路径；目前不自动清理产物。
- 局部修正使用完整原图、原生 PNG 遮罩与指令，生成后由应用保证框外原始像素和透明度不变。遮罩仍是模型的范围引导，选区内非目标内容与边界衔接需人工检查。
- 每次生成一个候选、medium 质量，输出请求为 1024 方图与不透明背景；未指定的颜色、明度和光影受 Prompt 保留约束。请求期间锁定画稿，不展示虚构百分比；请求超时或服务重启不能断点续跑，手动重试可能重复计费。刷新保留画稿，不恢复正在执行的请求或尚未采纳的对比弹窗。
- 本机单用户 MVP，无登录、项目隔离、任务队列、多帧时间轴和多人协作。这里的“动画编辑”聚焦动画角色单幅作画流程。共享部署需要增加认证、配额和产物访问隔离。
