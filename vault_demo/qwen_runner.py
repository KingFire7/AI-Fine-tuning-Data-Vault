from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


DEFAULT_MODEL_ID = "Qwen/Qwen2.5-0.5B-Instruct"


class QwenRunner:
    """Lazy local Qwen inference wrapper.

    Heavy dependencies are imported only when a generation request arrives, so
    the rest of the demo can still run even before the model environment is ready.
    """

    def __init__(self, cache_dir: Path):
        self.model_id = os.getenv("AI_VAULT_MODEL_ID", DEFAULT_MODEL_ID)
        self.cache_dir = Path(os.getenv("AI_VAULT_MODEL_CACHE", str(cache_dir)))
        self.enabled = _env_enabled("AI_VAULT_QWEN_ENABLED", default=True)
        self.max_input_tokens = int(os.getenv("AI_VAULT_MAX_INPUT_TOKENS", "3072"))
        self.default_max_new_tokens = int(os.getenv("AI_VAULT_MAX_NEW_TOKENS", "220"))
        self.device_map = os.getenv("AI_VAULT_DEVICE_MAP", "").strip()
        if self.device_map == "single-gpu-auto-select":
            self.device_map = ""
        self._lock = threading.RLock()
        self._tokenizer = None
        self._model = None
        self._torch = None
        self._device = "not-loaded"
        self._dtype = "not-loaded"
        self._loaded = False
        self._load_seconds: Optional[float] = None
        self._last_error: Optional[str] = None
        self._last_generate_seconds: Optional[float] = None

    def status(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "enabled": self.enabled,
                "loaded": self._loaded,
                "real_model": bool(self.enabled and self._loaded and not self._last_error),
                "model_id": self.model_id,
                "backend": "transformers-local-qwen",
                "device": self._device,
                "device_map": self.device_map or None,
                "dtype": self._dtype,
                "cuda_visible_devices": os.getenv("CUDA_VISIBLE_DEVICES"),
                "cache_dir": str(self.cache_dir),
                "hf_endpoint": os.getenv("HF_ENDPOINT", "https://huggingface.co"),
                "load_seconds": self._load_seconds,
                "last_generate_seconds": self._last_generate_seconds,
                "last_error": self._last_error,
            }

    def generate(
        self,
        question: str,
        snippets: List[Dict[str, Any]],
        adapter_path: Optional[str] = None,
        max_new_tokens: Optional[int] = None,
    ) -> Dict[str, Any]:
        started = time.perf_counter()
        if not self.enabled:
            return self._failure("AI_VAULT_QWEN_ENABLED=0，真实 Qwen 推理已关闭。", started)
        try:
            self._ensure_loaded()
            prompt = self._build_prompt(question, snippets, adapter_path)
            tokenizer = self._tokenizer
            model = self._model
            torch = self._torch
            assert tokenizer is not None and model is not None and torch is not None

            if hasattr(tokenizer, "apply_chat_template"):
                messages = [
                    {
                        "role": "system",
                        "content": (
                            "你是本地部署的 Qwen 医疗文档问答助手。只依据给定的私有文档片段回答，"
                            "不要编造不存在的检查结果，不要输出 sentinel、患者编号或任何敏感标记。"
                        ),
                    },
                    {"role": "user", "content": prompt},
                ]
                model_input = tokenizer.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True
                )
            else:
                model_input = prompt

            inputs = tokenizer(
                model_input,
                return_tensors="pt",
                truncation=True,
                max_length=self.max_input_tokens,
            )
            input_device = next(model.parameters()).device
            inputs = {key: value.to(input_device) for key, value in inputs.items()}
            input_tokens = int(inputs["input_ids"].shape[-1])
            with torch.inference_mode():
                outputs = model.generate(
                    **inputs,
                    max_new_tokens=max_new_tokens or self.default_max_new_tokens,
                    do_sample=False,
                    repetition_penalty=1.05,
                    pad_token_id=getattr(tokenizer, "eos_token_id", None),
                )
            new_tokens = int(outputs[0].shape[-1] - input_tokens)
            answer_ids = outputs[0][input_tokens:]
            answer = tokenizer.decode(answer_ids, skip_special_tokens=True).strip()
            if not answer:
                answer = "本地 Qwen 已完成推理，但没有生成可展示文本。"

            elapsed = round(time.perf_counter() - started, 3)
            with self._lock:
                self._last_generate_seconds = elapsed
                self._last_error = None
            return {
                "ok": True,
                "real_model": True,
                "model_id": self.model_id,
                "backend": "transformers-local-qwen",
                "device": self._device,
                "device_map": self.device_map or None,
                "dtype": self._dtype,
                "cuda_visible_devices": os.getenv("CUDA_VISIBLE_DEVICES"),
                "cache_dir": str(self.cache_dir),
                "hf_endpoint": os.getenv("HF_ENDPOINT", "https://huggingface.co"),
                "load_seconds": self._load_seconds,
                "generate_seconds": elapsed,
                "input_tokens": input_tokens,
                "new_tokens": new_tokens,
                "text": answer,
            }
        except Exception as exc:
            return self._failure(str(exc), started)

    def _ensure_loaded(self) -> None:
        with self._lock:
            if self._loaded and self._model is not None and self._tokenizer is not None:
                return
            started = time.perf_counter()
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            os.environ.setdefault("HF_HOME", str(self.cache_dir / "huggingface"))
            os.environ.setdefault("TRANSFORMERS_CACHE", str(self.cache_dir / "transformers"))
            os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

            try:
                import torch
                from transformers import AutoModelForCausalLM, AutoTokenizer
            except Exception as exc:
                self._last_error = "缺少 Qwen 依赖：%s" % exc
                raise RuntimeError(self._last_error) from exc

            device = self._select_device(torch)
            dtype = torch.float16 if device.startswith("cuda") else torch.float32
            tokenizer = AutoTokenizer.from_pretrained(
                self.model_id,
                cache_dir=str(self.cache_dir),
                trust_remote_code=True,
                use_fast=True,
            )
            model_kwargs = {
                "cache_dir": str(self.cache_dir),
                "trust_remote_code": True,
                "torch_dtype": dtype,
                "low_cpu_mem_usage": True,
            }
            if self.device_map:
                model_kwargs["device_map"] = self.device_map
                max_memory = _parse_max_memory(os.getenv("AI_VAULT_MAX_MEMORY", ""))
                if max_memory:
                    model_kwargs["max_memory"] = max_memory
            model = AutoModelForCausalLM.from_pretrained(self.model_id, **model_kwargs)
            if not self.device_map:
                model.to(device)
            model.eval()
            if getattr(tokenizer, "pad_token", None) is None and getattr(tokenizer, "eos_token", None):
                tokenizer.pad_token = tokenizer.eos_token

            self._torch = torch
            self._tokenizer = tokenizer
            self._model = model
            self._device = (
                "device_map:%s visible:%s"
                % (self.device_map, os.getenv("CUDA_VISIBLE_DEVICES", "all"))
                if self.device_map
                else device
            )
            self._dtype = str(dtype).replace("torch.", "")
            self._loaded = True
            self._load_seconds = round(time.perf_counter() - started, 3)
            self._last_error = None

    def _select_device(self, torch: Any) -> str:
        requested = os.getenv("AI_VAULT_DEVICE", "").strip()
        if requested:
            return requested
        if not torch.cuda.is_available():
            return "cpu"
        best_index = 0
        best_free = -1
        for index in range(torch.cuda.device_count()):
            try:
                free_bytes, _total_bytes = torch.cuda.mem_get_info(index)
                if int(free_bytes) > best_free:
                    best_index = index
                    best_free = int(free_bytes)
            except Exception:
                continue
        return "cuda:%d" % best_index

    def _build_prompt(
        self, question: str, snippets: List[Dict[str, Any]], adapter_path: Optional[str]
    ) -> str:
        if snippets:
            context_lines = []
            for index, snippet in enumerate(snippets, start=1):
                text = _redact_sensitive(str(snippet.get("snippet", "")))
                context_lines.append(
                    "[%d] 文档《%s》 相关度=%s\n%s"
                    % (
                        index,
                        snippet.get("title", "未命名文档"),
                        snippet.get("score", "--"),
                        text,
                    )
                )
            context = "\n\n".join(context_lines)
        else:
            context = "未检索到私有文档片段。"
        adapter_state = (
            "已生成轻量 adapter：%s" % Path(adapter_path).name
            if adapter_path
            else "尚未生成轻量 adapter，本次只使用文档检索上下文。"
        )
        return (
            "私有文档片段如下：\n%s\n\n"
            "运行状态：%s\n\n"
            "用户问题：%s\n\n"
            "请用中文分点回答。回答必须说明依据来自哪份文档；如证据不足，请明确说明。"
        ) % (context, adapter_state, question)

    def _failure(self, error: str, started: float) -> Dict[str, Any]:
        elapsed = round(time.perf_counter() - started, 3)
        with self._lock:
            self._last_generate_seconds = elapsed
            self._last_error = error
        status = self.status()
        status.update(
            {
                "ok": False,
                "real_model": False,
                "generate_seconds": elapsed,
                "error": error,
                "text": "",
            }
        )
        return status


def _env_enabled(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def _parse_max_memory(raw: str) -> Optional[Dict[Any, str]]:
    value = (raw or "").strip()
    if not value:
        return None
    result: Dict[Any, str] = {}
    for item in value.split(","):
        if not item.strip() or ":" not in item:
            continue
        key, memory = item.split(":", 1)
        key = key.strip()
        memory = memory.strip()
        if not key or not memory:
            continue
        result[int(key) if key.isdigit() else key] = memory
    return result or None


def _redact_sensitive(text: str) -> str:
    return text.replace("AI_VAULT_PATIENT_SENTINEL_9F3B2C7A", "[SENSITIVE_REDACTED]")
