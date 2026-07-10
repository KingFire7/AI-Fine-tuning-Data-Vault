# AI 数据保险箱可视化 Demo

面向敏感数据本地 AI 处理场景的可视化原型。项目展示一种“移动存储承载敏感数据，宿主机只提供算力，中间缓存加密暂存，退出后验证宿主机无敏感明文残留”的应用层数据流方案。

项目包含两种形态：

- 网页演示版：无需 GPU、无需后端，适合快速展示界面和流程。
- 真实运行版：FastAPI 后端 + 单页前端，可运行轻量训练、AES-GCM 缓存加密、风险检测，并可接入本地 Qwen 推理。

## 功能概览

- 私有文档管理：选择、上传或模拟加入本地资料。
- 本地模型问答：结合已选私有文档生成回答，并展示引用依据。
- 三层隔离拓扑：展示宿主机资源层、隔离运行环境层、物理数据存储层。
- 运行资源展示：展示 GPU、显存占用、模型选择建议和运行配置。
- 风险检测：扫描宿主机临时目录，验证明文残留、缓存形态、错误密钥拒绝和报告完整性。
- 无保护 vs 保险箱对比：对比未加密缓存风险与保险箱模式的保护效果。
- 事件时间线：记录接入、模型适配、缓存、结果保存、退出和检测事件。

## 目录结构

```text
.
├── app.py                         # FastAPI 入口
├── static/                        # 真实运行版前端
├── docs/                          # GitHub Pages 网页演示版
├── vault_demo/                    # 演示引擎与 Qwen 推理封装
├── vault_drive/                   # 移动保险箱模拟区
│   └── fine_tune_docs/            # 随仓库提供的示例私有文档
├── host_scratch/                  # 宿主机临时盘模拟区，运行时生成
├── reports/                       # 验证报告，运行时生成
├── setup_qwen_env.sh              # Qwen 依赖环境准备脚本
├── run_demo.sh                    # 普通演示模式
├── run_demo_qwen.sh               # Qwen 真实模型模式
├── run_demo_qwen14b.sh            # 本地 14B 快照启动脚本
└── self_check.py                  # 自检脚本
```

模型权重、conda 环境、运行日志、验证报告和临时缓存不会进入 Git 仓库；首次运行时会在本地重新生成或按配置下载。

## 网页演示版

网页演示版位于 `docs/`，复用真实运行版的页面结构和视觉样式，用前端 mock 数据替代 FastAPI/Qwen 后端。

适用场景：

- 没有 GPU 或无法访问 SSH 服务器时展示项目。
- 快速说明界面布局、核心流程和安全验证逻辑。
- 给评审或用户提供无需安装的浏览器预览。

在线访问：

```text
https://kingfire7.github.io/AI-Fine-tuning-Data-Vault/
```

网页演示版限制：

- 不加载真实 Qwen 权重。
- 大模型回答为预设问题和预设回答。
- 上传文档为预设文档模拟加入。
- GPU、风险检测、事件时间线和报告数据均为前端演示数据。

## 真实运行版复现

### 1. 克隆项目

```bash
git clone git@github.com:KingFire7/AI-Fine-tuning-Data-Vault.git
cd AI-Fine-tuning-Data-Vault
```

如果使用 HTTPS：

```bash
git clone https://github.com/KingFire7/AI-Fine-tuning-Data-Vault.git
cd AI-Fine-tuning-Data-Vault
```

### 2. 安装普通演示依赖

普通演示模式不加载 Qwen，只需要 Python 后端依赖：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. 启动普通演示模式

```bash
./run_demo.sh
```

默认访问地址：

```text
http://127.0.0.1:8010
```

如需修改端口：

```bash
PORT=8020 ./run_demo.sh
```

如果在远程 SSH 服务器上运行，请将远端端口转发到本地。例如 VSCode Remote SSH 可在 Ports 面板转发 `8010`，然后在本地浏览器访问：

```text
http://localhost:8010
```

## Qwen 真实模型模式

Qwen 模式会通过 Transformers 加载本地或远程 Qwen 模型，用于展示真实本地推理。首次加载模型可能需要较长时间，并需要足够显存或内存。

### 1. 准备 conda 环境

项目提供 `setup_qwen_env.sh`，默认会把 conda 环境安装到项目目录下的 `.conda-qwen38`。如服务器 conda 路径不同，可通过环境变量指定：

```bash
CONDA_BIN=/path/to/conda SOURCE_PREFIX=/path/to/base/conda ./setup_qwen_env.sh
```

准备完成后启动：

```bash
./run_demo_qwen.sh
```

### 2. GPU 选择

默认 GPU 白名单为：

```bash
AI_VAULT_CUDA_VISIBLE_DEVICES=4,5,6,7
```

可按实际资源调整：

```bash
AI_VAULT_CUDA_VISIBLE_DEVICES=1,2 ./run_demo_qwen.sh
```

注意：页面中显示的 `cuda:0` 是白名单内的逻辑编号，不一定等同于物理 GPU 0。

### 3. 模型选择

默认模型：

```text
Qwen/Qwen2.5-0.5B-Instruct
```

使用 7B：

```bash
AI_VAULT_MODEL_ID=Qwen/Qwen2.5-7B-Instruct ./run_demo_qwen.sh
```

使用 14B 并启用自动设备映射：

```bash
AI_VAULT_MODEL_ID=Qwen/Qwen2.5-14B-Instruct AI_VAULT_DEVICE_MAP=auto ./run_demo_qwen.sh
```

如果已有本地模型快照，也可以直接指定本地路径：

```bash
AI_VAULT_MODEL_ID=/path/to/Qwen2.5-14B-Instruct/snapshot AI_VAULT_DEVICE_MAP=auto ./run_demo_qwen.sh
```

### 4. 离线或镜像配置

模型缓存目录默认位于：

```text
vault_drive/model_cache/
```

如需指定 HuggingFace 端点：

```bash
AI_VAULT_HF_ENDPOINT=https://huggingface.co ./run_demo_qwen.sh
```

如需离线运行：

```bash
HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 ./run_demo_qwen.sh
```

## 自检

运行：

```bash
python3 self_check.py
```

自检会实际执行一次无保护模式和一次保险箱模式，并验证：

- 无保护模式能扫描到宿主机临时盘中的 sentinel 明文。
- 保险箱模式的宿主机临时盘没有 sentinel 明文。
- 错误密钥无法解密保险箱模式的缓存文件。
- 轻量模型适配参数已保存到 `vault_drive/adapters/`。

## 推荐演示流程

1. 在“私有文档”中选择示例文档，或上传测试文档。
2. 在“大模型使用窗口”提问，观察私有文档检索、回答生成和引用依据。
3. 点击“保险箱模式”，观察三层拓扑高亮、缓存加密暂存、参数文件保存和安全退出。
4. 进入第二页，点击“风险检测”，查看宿主机明文残留、缓存形态和错误密钥验证结果。
5. 点击“无保护模式”，对比未加密缓存进入宿主机临时目录后的风险。
6. 展开“事件时间线”，查看每一步审计事件和细节。

## 真实性说明

真实运行版中实际执行的部分：

- 页面上传或选择的文档会写入 `vault_drive/fine_tune_docs/`。
- Qwen 模式会通过 Transformers 加载本地 Qwen 模型并生成回答。
- 推理上下文缓存会在保险箱模式中经 AES-GCM 加密后写入 `host_scratch/model_inference/`。
- 后台模型适配验证会运行 PyTorch toy adapter 训练，生成真实 loss、模型适配参数和审计事件。
- 报告会实际扫描 `host_scratch/` 中是否存在 sentinel 明文，并验证错误密钥无法解密加密缓存。

仍属于 Demo 边界的部分：

- toy adapter 不是对 Qwen 权重做生产级 LoRA 微调。
- 未实现真实 syscall 拦截、内核级沙箱、swap 禁用、mlock 或 TEE。
- `vault_drive/` 与 `host_scratch/` 是目录级模拟，用于验证应用层数据流和缓存加密暂存链路。

## 安全边界

本 Demo 验证概念链路和应用层数据流控制，不宣称防御 root 权限、内核后门、物理内存转储或总线监听。生产化还需要系统级沙箱、swap 控制、mlock、强审计和 TEE/机密计算能力。
