# AI 微调数据保险箱可视化 Demo

这是一个面向 AI 微调数据保护场景的本地可视化 Demo。它用轻量真实训练流程和可选的本地 Qwen 推理展示：

- `vault_drive/`：移动保险箱模拟区，保存合成隐私数据、微调参数文件和审计日志。
- `vault_drive/fine_tune_docs/`：微调文档区，页面上传或选择的材料会进入这里。
- `vault_drive/model_cache/`：本地 Qwen 权重缓存区，默认用于保存 `Qwen/Qwen2.5-0.5B-Instruct`。
- `host_scratch/`：宿主机临时盘模拟区，无保护模式写入未加密缓存，保险箱模式只写入 AES-GCM 加密缓存。
- `reports/`：每次演示的验证报告，包含 sentinel 扫描、加密验证、硬件探测和训练指标。

模型权重、conda 环境、运行日志、验证报告和临时缓存不会进入 Git 仓库；首次运行时会在本地重新生成或按配置下载。

## GitHub Pages 纯演示版

仓库包含一个无需 GPU、无需后端服务的纯静态演示版本，位于 `docs/` 目录。该版本复用真实运行版的页面结构和视觉样式，用前端 mock 数据替代 FastAPI/Qwen 后端，适合没有运算资源或无法访问 SSH 服务器时展示界面流程：

- 微调文档上传改为弹窗选择预设文档，模拟加入移动保险箱。
- 大模型提问改为选择预设问题，并返回预设回答和引用依据。
- 三层拓扑、风险检测、运行资源、对比和事件时间线沿用真实版布局，但数据均为前端静态 mock。

推送到 `main` 后，GitHub Actions 会自动部署 `docs/` 到 GitHub Pages。仓库 Pages 地址通常为：

```text
https://kingfire7.github.io/AI-Fine-tuning-Data-Vault/
```

如果首次访问没有页面，请在 GitHub 仓库的 `Settings -> Pages` 中确认部署来源为 `GitHub Actions`。

## Qwen 真实模型模式

首次准备 conda 环境：

```bash
cd /data02/James/AI+/ai-vault-demo
./setup_qwen_env.sh
```

启动服务：

```bash
cd /data02/James/AI+/ai-vault-demo
./run_demo_qwen.sh
```

脚本默认只使用物理 GPU `4,5,6,7`：

```bash
CUDA_VISIBLE_DEVICES=4,5,6,7
```

页面和 `/api/model/status` 中看到的 `cuda:0` 是白名单内的逻辑编号，对应物理 GPU `4`。如需调整：

```bash
AI_VAULT_CUDA_VISIBLE_DEVICES=5,6,7 ./run_demo_qwen.sh
```

默认模型为：

```text
Qwen/Qwen2.5-0.5B-Instruct
```

如需试更大模型，可先从 7B 开始：

```bash
AI_VAULT_MODEL_ID=Qwen/Qwen2.5-7B-Instruct ./run_demo_qwen.sh
```

更大的 14B/32B 建议开启 Transformers 自动设备映射，让权重分布到白名单 GPU：

```bash
AI_VAULT_MODEL_ID=Qwen/Qwen2.5-14B-Instruct AI_VAULT_DEVICE_MAP=auto ./run_demo_qwen.sh
```

当前已下载并验证 `Qwen/Qwen2.5-14B-Instruct`，可直接用本地离线快照启动，避免再次访问 HuggingFace：

```bash
./run_demo_qwen14b.sh
```

14B 本地快照路径：

```text
vault_drive/model_cache/models--Qwen--Qwen2.5-14B-Instruct/snapshots/cf98f3b3bbb457ad9e2bb7baf9a0125b6b88caa8
```

首次点击页面中的“大模型使用窗口”发送问题时，会懒加载/下载模型权重。当前脚本默认使用 `https://huggingface.co`，因为本机测试中 `hf-mirror.com` 可被 `curl` 访问，但 `huggingface_hub` 解析失败。如需手动换端点：

```bash
AI_VAULT_HF_ENDPOINT=https://huggingface.co ./run_demo_qwen.sh
```

## 普通演示模式

```bash
cd /data02/James/AI+/ai-vault-demo
./run_demo.sh
```

默认访问地址：

```text
http://127.0.0.1:8010
```

如果通过 VSCode Remote SSH 使用，请在 Ports 面板转发远端 `8010` 端口，然后在本地浏览器打开 `http://localhost:8010`。

如需换端口：

```bash
PORT=8020 ./run_demo.sh
```

## 自检

```bash
cd /data02/James/AI+/ai-vault-demo
python3 self_check.py
```

自检会实际运行一次无保护模式和一次保险箱模式，并验证：

- 无保护模式能扫描到宿主机临时盘中的 sentinel 明文。
- 保险箱模式的宿主机临时盘没有 sentinel 明文。
- 错误密钥无法解密保险箱模式的缓存文件。
- 轻量微调参数文件已保存到 `vault_drive/adapters/`。

## 演示顺序

1. 在页面左上选择或上传微调文档。
2. 点击 `保险箱模式`，观察三层拓扑、事件时间线和缓存处理流程。
3. 在 `大模型使用窗口` 提问，查看本地 Qwen 结合私有文档上下文生成的回答。
4. 点击 `无保护模式`，展示未加密缓存泄露路径和报告中的 sentinel 命中。

## 真实性说明

真实执行的部分：

- 页面上传/选择的文档会写入 `vault_drive/fine_tune_docs/`。
- Qwen 模式会通过 Transformers 加载本地 `Qwen/Qwen2.5-0.5B-Instruct` 并生成回答。
- 推理上下文缓存会在保险箱模式中经 AES-GCM 加密后写入 `host_scratch/model_inference/`。
- 微调演示会运行 PyTorch toy adapter 训练，生成真实 loss、微调参数文件和审计事件。
- 报告会实际扫描 `host_scratch/` 中是否存在 sentinel 明文，并验证错误密钥无法解密加密缓存。

仍属于 Demo 边界的部分：

- toy adapter 不是对 Qwen 权重做生产级 LoRA 微调。
- 未实现真实 syscall 拦截、内核级沙箱、swap 禁用、mlock 或 TEE。
- `vault_drive/` 与 `host_scratch/` 是目录级模拟，用于验证应用层数据流和缓存加密暂存链路。

## 安全边界

本 Demo 验证概念链路和应用层数据流控制，不宣称防御 root、内核后门、物理内存转储或总线监听。生产化还需要系统级沙箱、swap 控制、mlock、强审计和 TEE/机密计算能力。
