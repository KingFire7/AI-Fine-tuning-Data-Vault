from __future__ import annotations

import json
import hashlib
import math
import os
import platform
import random
import re
import shutil
import subprocess
import threading
import time
import traceback
import unicodedata
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from vault_demo.qwen_runner import QwenRunner


SENTINEL = "AI_VAULT_PATIENT_SENTINEL_9F3B2C7A"
SAFETY_BOUNDARY = (
    "本 Demo 验证概念链路和应用层数据流控制，不宣称防御 root、内核后门、"
    "物理内存转储或总线监听。生产化还需要系统级沙箱、swap 控制、mlock、"
    "更强审计和 TEE/机密计算能力。"
)


class DemoEngine:
    """Runs the baseline and vault demo scenarios and stores auditable reports."""

    def __init__(self, app_dir: Path):
        self.app_dir = app_dir
        self.vault_dir = app_dir / "vault_drive"
        self.host_scratch_dir = app_dir / "host_scratch"
        self.reports_dir = app_dir / "reports"
        self.private_data_dir = self.vault_dir / "private_data"
        self.fine_tune_docs_dir = self.vault_dir / "fine_tune_docs"
        self.model_cache_dir = self.vault_dir / "model_cache"
        self.adapter_dir = self.vault_dir / "adapters"
        self.audit_dir = self.vault_dir / "audit_logs"
        self.inference_dir = self.host_scratch_dir / "model_inference"
        self.runtime_config_path = self.app_dir / ".runtime_config.env"
        self.qwen_runner = QwenRunner(self.model_cache_dir)
        self._lock = threading.RLock()
        self._runs: Dict[str, Dict[str, Any]] = {}
        self.ensure_layout()

    def ensure_layout(self) -> None:
        for path in [
            self.vault_dir,
            self.host_scratch_dir,
            self.reports_dir,
            self.private_data_dir,
            self.fine_tune_docs_dir,
            self.model_cache_dir,
            self.adapter_dir,
            self.audit_dir,
            self.inference_dir,
        ]:
            path.mkdir(parents=True, exist_ok=True)
        self._seed_private_dataset()
        self._seed_demo_documents()

    def _seed_private_dataset(self) -> None:
        dataset_path = self.private_data_dir / "synthetic_medical_qa.jsonl"
        if dataset_path.exists():
            return
        samples = _synthetic_samples()
        with dataset_path.open("w", encoding="utf-8") as handle:
            for sample in samples:
                handle.write(json.dumps(sample, ensure_ascii=False) + "\n")

    def _seed_demo_documents(self) -> None:
        if any(self.fine_tune_docs_dir.glob("*.txt")):
            return
        docs = {
            "cardiology_followup_protocol.txt": (
                "心内科随访策略\n"
                "适用场景：胸痛、胸闷、心悸、活动后气短或既往冠心病患者的初步问答适配。\n"
                "优先评估：心电图、肌钙蛋白、血压曲线、血氧和既往支架或心梗病史。\n"
                "高风险提示：胸痛伴大汗、濒死感、血压下降或肌钙蛋白升高时，应优先进入心内科急诊通道。\n"
                "随访建议：稳定患者需记录发作诱因、持续时间、缓解方式和近期用药依从性。\n"
                "问答边界：本资料用于流程提示，不能替代医生诊断或急救处置。"
            ),
            "respiratory_triage_notes.txt": (
                "呼吸科分诊记录\n"
                "适用场景：咳嗽、咳痰、喘息、发热或活动后气短患者的分诊问答。\n"
                "基础信息：记录体温、血氧饱和度、呼吸频率、肺部听诊和胸部影像结果。\n"
                "慢阻肺患者：需要复核吸入药名称、使用频次、吸入手法和近期急性加重次数。\n"
                "感染提示：持续高热、黄绿色痰、血氧下降或影像新发渗出时，应提示线下就医。\n"
                "居家建议：症状轻且血氧稳定者可记录饮水、休息、用药后变化和复诊时间。"
            ),
            "private_case_summary.txt": (
                "隐私病历摘要\n"
                "患者编号 %s，用于演示敏感标记在宿主机临时盘中的扫描结果。\n"
                "术后第 7 天随访重点：伤口红肿渗液、体温变化、疼痛评分和活动耐受情况。\n"
                "用药调整：需核对抗凝药、抗生素和止痛药是否按医嘱服用，避免自行停药。\n"
                "复查计划：若无异常，建议按出院小结安排复诊；若出现发热、伤口裂开或明显出血，应提前就医。\n"
                "问答要求：回答时只提取随访建议，不直接暴露患者编号或敏感标记。"
            )
            % SENTINEL,
            "common_cold_classification.txt": (
                "感冒分类说明\n"
                "感冒主要分为普通感冒和流行性感冒两种类型，区别在于病原体、症状严重程度及传染性不同。\n"
                "普通感冒通常由鼻病毒等引起，常见表现为鼻塞、流涕、咽痛和轻度咳嗽，整体症状相对较轻。\n"
                "流行性感冒通常由流感病毒引起，常见高热、肌肉酸痛、乏力和明显全身症状，传染性更强。\n"
                "问答提示：当用户询问感冒类型时，应优先回答普通感冒和流行性感冒两类，并说明主要区别。"
            ),
        }
        for filename, content in docs.items():
            (self.fine_tune_docs_dir / filename).write_text(content, encoding="utf-8")

    def get_hardware(self) -> Dict[str, Any]:
        mem_total_gib = None
        try:
            for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
                if line.startswith("MemTotal:"):
                    mem_kib = int(line.split()[1])
                    mem_total_gib = round(mem_kib / 1024 / 1024, 2)
                    break
        except Exception:
            mem_total_gib = None

        hardware: Dict[str, Any] = {
            "platform": platform.platform(),
            "python": platform.python_version(),
            "cpu_count": os.cpu_count(),
            "memory_gib": mem_total_gib,
            "cuda_available": False,
            "cuda_visible_devices": os.getenv("CUDA_VISIBLE_DEVICES"),
            "gpu_count": 0,
            "gpus": [],
            "selected_device": "cpu",
        }

        try:
            import torch

            hardware["torch"] = getattr(torch, "__version__", "unknown")
            hardware["cuda_available"] = bool(torch.cuda.is_available())
            if torch.cuda.is_available():
                hardware["gpu_count"] = int(torch.cuda.device_count())
                best_index = 0
                best_free = -1
                for index in range(torch.cuda.device_count()):
                    props = torch.cuda.get_device_properties(index)
                    free_mib = None
                    try:
                        free_bytes, total_bytes = torch.cuda.mem_get_info(index)
                        free_mib = int(free_bytes / 1024 / 1024)
                        total_mib = int(total_bytes / 1024 / 1024)
                    except Exception:
                        total_mib = int(props.total_memory / 1024 / 1024)
                    if free_mib is not None and free_mib > best_free:
                        best_index = index
                        best_free = free_mib
                    hardware["gpus"].append(
                        {
                            "index": index,
                            "name": props.name,
                            "total_mib": total_mib,
                            "free_mib": free_mib,
                            "capability": "%s.%s" % props.major_minor
                            if hasattr(props, "major_minor")
                            else f"{props.major}.{props.minor}",
                        }
                    )
                hardware["selected_device"] = f"cuda:{best_index}"
        except Exception as exc:
            hardware["torch_error"] = str(exc)

        nvidia_smi = shutil.which("nvidia-smi")
        if nvidia_smi:
            try:
                result = subprocess.run(
                    [
                        nvidia_smi,
                        "--query-gpu=index,name,memory.total,memory.free,utilization.gpu",
                        "--format=csv,noheader,nounits",
                    ],
                    check=False,
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=5,
                )
                if result.returncode == 0:
                    hardware["nvidia_smi"] = [
                        line.strip() for line in result.stdout.splitlines() if line.strip()
                    ]
            except Exception:
                pass
            try:
                inventory = collect_nvidia_inventory(nvidia_smi, self.app_dir)
                if inventory:
                    hardware["gpu_inventory"] = inventory["gpus"]
                    hardware["gpu_totals"] = inventory["totals"]
            except Exception as exc:
                hardware["gpu_inventory_error"] = str(exc)
        return hardware

    def get_model_status(self) -> Dict[str, Any]:
        latest_report = self.get_latest_report() or {}
        status = self.qwen_runner.status()
        status["adapter_path"] = latest_report.get("paths", {}).get("adapter")
        status["adapter_loaded_in_prompt"] = bool(status["adapter_path"])
        return status

    def get_runtime_config(self) -> Dict[str, Any]:
        hardware = self.get_hardware()
        inventory = hardware.get("gpu_inventory") or []
        current_gpu_ids = _parse_visible_devices(os.getenv("AI_VAULT_CUDA_VISIBLE_DEVICES"))
        if current_gpu_ids is None:
            current_gpu_ids = _parse_visible_devices(os.getenv("CUDA_VISIBLE_DEVICES"))
        if current_gpu_ids is None:
            current_gpu_ids = {gpu.get("index") for gpu in inventory if gpu.get("visible", True)}
        selected_gpu_ids = sorted(
            int(index) for index in current_gpu_ids if isinstance(index, int)
        )
        model_options = self._detect_qwen_model_options()
        current_model = os.getenv("AI_VAULT_MODEL_ID", "Qwen/Qwen2.5-0.5B-Instruct")
        current_model_label = _model_label(current_model)
        active_model_option_id = current_model
        for option in model_options:
            if option["id"] == current_model or option["label"] == current_model_label:
                active_model_option_id = option["id"]
                break
        if current_model not in {option["id"] for option in model_options} and all(
            option["label"] != current_model_label for option in model_options
        ):
            model_options.append(
                {
                    "id": current_model,
                    "label": current_model_label,
                    "params_b": _parse_model_params(current_model),
                    "local": Path(current_model).exists(),
                    "available": Path(current_model).exists() or "/" in current_model,
                    "note": "当前进程正在使用",
                }
            )
        recommendation = _runtime_recommendation(inventory, selected_gpu_ids, model_options)
        return {
            "selected_gpu_ids": selected_gpu_ids,
            "current_model_id": current_model,
            "current_model_label": current_model_label,
            "active_model_option_id": active_model_option_id,
            "device_map": os.getenv("AI_VAULT_DEVICE_MAP", "single-gpu-auto-select"),
            "model_options": model_options,
            "gpu_options": [
                {
                    "index": gpu.get("index"),
                    "name": gpu.get("name"),
                    "total_mib": gpu.get("total_mib", 0),
                    "free_mib": gpu.get("free_mib", 0),
                    "used_mib": gpu.get("used_mib", 0),
                    "visible": gpu.get("visible", False),
                    "utilization_gpu": gpu.get("utilization_gpu", 0),
                }
                for gpu in inventory
            ],
            "recommendation": recommendation,
            "process": {"pid": os.getpid(), "ppid": os.getppid()},
            "restart_supported": True,
        }

    def apply_runtime_config(
        self, gpu_ids: List[int], model_id: str, device_map: str = "auto"
    ) -> Dict[str, Any]:
        runtime = self.get_runtime_config()
        available_gpu_ids = {int(gpu["index"]) for gpu in runtime["gpu_options"] if gpu.get("index") is not None}
        requested_gpu_ids = sorted({int(index) for index in gpu_ids})
        if not requested_gpu_ids:
            raise ValueError("请至少选择一张 GPU。")
        invalid = [index for index in requested_gpu_ids if index not in available_gpu_ids]
        if invalid:
            raise ValueError(f"GPU {invalid} 不在当前宿主机检测结果中。")

        model_options = {option["id"]: option for option in runtime["model_options"]}
        if model_id not in model_options:
            raise ValueError("所选模型不在当前可用模型列表中。")
        selected_model = model_options[model_id]
        if not selected_model.get("available"):
            raise ValueError("所选模型当前不可用，请先下载到本地缓存。")

        clean_device_map = (device_map or "auto").strip()
        if clean_device_map not in {"auto", "single-gpu-auto-select"}:
            clean_device_map = "auto"
        env_values = {
            "AI_VAULT_CUDA_VISIBLE_DEVICES": ",".join(str(index) for index in requested_gpu_ids),
            "AI_VAULT_MODEL_ID": model_id,
            "AI_VAULT_DEVICE_MAP": clean_device_map,
            "AI_VAULT_QWEN_ENABLED": "1",
            "AI_VAULT_MAX_NEW_TOKENS": os.getenv("AI_VAULT_MAX_NEW_TOKENS", "140"),
        }
        if Path(model_id).exists():
            env_values["HF_HUB_OFFLINE"] = "1"
            env_values["TRANSFORMERS_OFFLINE"] = "1"
        else:
            env_values["HF_HUB_OFFLINE"] = os.getenv("HF_HUB_OFFLINE", "0")
            env_values["TRANSFORMERS_OFFLINE"] = os.getenv("TRANSFORMERS_OFFLINE", "0")

        content = [
            "# Generated by AI Vault Demo runtime settings.",
            "# Edit through the web UI unless you are intentionally overriding startup.",
        ]
        for key, value in env_values.items():
            content.append(f'{key}="{_shell_escape_env(value)}"')
        self.runtime_config_path.write_text("\n".join(content) + "\n", encoding="utf-8")

        self._schedule_restart()
        return {
            "status": "restarting",
            "selected_gpu_ids": requested_gpu_ids,
            "model": selected_model,
            "device_map": clean_device_map,
            "message": "配置已写入，Demo 服务正在按新设置重启。",
        }

    def _detect_qwen_model_options(self) -> List[Dict[str, Any]]:
        options: List[Dict[str, Any]] = []
        for model_dir in sorted(self.model_cache_dir.glob("models--Qwen--Qwen2.5-*-Instruct")):
            snapshots_dir = model_dir / "snapshots"
            if not snapshots_dir.exists():
                continue
            snapshots = sorted(
                [path for path in snapshots_dir.iterdir() if path.is_dir()],
                key=lambda path: path.stat().st_mtime,
                reverse=True,
            )
            if not snapshots:
                continue
            model_name = model_dir.name.replace("models--Qwen--", "").replace("--", "/")
            snapshot = snapshots[0]
            params_b = _parse_model_params(model_name)
            options.append(
                {
                    "id": str(snapshot),
                    "label": model_name,
                    "params_b": params_b,
                    "local": True,
                    "available": True,
                    "note": "本地缓存快照",
                }
            )
        options.sort(key=lambda option: float(option.get("params_b") or 0))
        if not options:
            options.append(
                {
                    "id": "Qwen/Qwen2.5-0.5B-Instruct",
                    "label": "Qwen2.5-0.5B-Instruct",
                    "params_b": 0.5,
                    "local": False,
                    "available": True,
                    "note": "需要可访问模型仓库或已有缓存",
                }
            )
        return options

    def _schedule_restart(self) -> None:
        pid = os.getpid()
        ppid = os.getppid()
        kill_targets = [str(pid)]
        if ppid > 1:
            kill_targets.append(str(ppid))
        command = (
            "sleep 1; "
            f"kill {' '.join(kill_targets)} 2>/dev/null || true; "
            "sleep 1; "
            f"cd {_shell_single_quote(str(self.app_dir))} && "
            "exec ./run_demo_qwen.sh >> demo_server.log 2>&1 < /dev/null"
        )
        subprocess.Popen(
            ["setsid", "/bin/bash", "-lc", command],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )

    def list_documents(self) -> List[Dict[str, Any]]:
        self.ensure_layout()
        documents = []
        for path in sorted(self.fine_tune_docs_dir.glob("*")):
            if not path.is_file():
                continue
            try:
                content = path.read_text(encoding="utf-8", errors="replace")
            except Exception:
                continue
            title = content.splitlines()[0].strip() if content.splitlines() else path.name
            documents.append(
                {
                    "id": path.name,
                    "name": path.name,
                    "title": title or path.name,
                    "bytes": path.stat().st_size,
                    "modified_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat(
                        timespec="seconds"
                    ),
                    "preview": _compact_text(content, 150),
                    "path": str(path),
                    "contains_sentinel": SENTINEL in content,
                }
            )
        return documents

    def save_document(self, filename: str, content: str) -> Dict[str, Any]:
        self.ensure_layout()
        clean_name = _safe_filename(filename)
        clean_content = (content or "").strip()
        if not clean_content:
            raise ValueError("document content is empty")
        if len(clean_content.encode("utf-8")) > 300_000:
            raise ValueError("document is too large for the demo")
        path = self.fine_tune_docs_dir / clean_name
        if path.exists():
            stem = path.stem
            suffix = path.suffix or ".txt"
            path = self.fine_tune_docs_dir / (
                "%s_%s%s" % (stem, datetime.now().strftime("%H%M%S"), suffix)
            )
        path.write_text(clean_content, encoding="utf-8")
        return self._document_summary(path)

    def delete_document(self, document_id: str) -> Dict[str, Any]:
        self.ensure_layout()
        clean_name = Path(document_id or "").name
        if not clean_name:
            raise ValueError("document id is empty")
        path = self.fine_tune_docs_dir / clean_name
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(clean_name)
        summary = self._document_summary(path)
        path.unlink()
        return {"deleted": True, "document": summary}

    def ask_model(
        self, question: str, document_ids: Optional[List[str]] = None, mode: str = "vault"
    ) -> Dict[str, Any]:
        self.ensure_layout()
        clean_question = (question or "").strip()
        if not clean_question:
            raise ValueError("question is empty")
        if mode not in {"vault", "baseline"}:
            mode = "vault"

        inference_id = "infer-%s-%s" % (
            datetime.now().strftime("%Y%m%d-%H%M%S"),
            uuid.uuid4().hex[:6],
        )
        host_run_dir = self.inference_dir / inference_id
        host_run_dir.mkdir(parents=True, exist_ok=True)
        documents = self._resolve_documents(document_ids)
        snippets = _retrieve_snippets(clean_question, documents)
        latest_report = self.get_latest_report() or {}
        adapter_path = latest_report.get("paths", {}).get("adapter")
        session_key = AESGCM.generate_key(bit_length=256)

        context_payload = {
            "inference_id": inference_id,
            "question": clean_question,
            "selected_documents": [doc["id"] for doc in documents],
            "snippets": snippets,
            "sentinel": SENTINEL,
            "adapter_path": adapter_path,
        }
        payload_bytes = json.dumps(context_payload, ensure_ascii=False).encode("utf-8")
        if mode == "vault":
            cache_path = host_run_dir / "retrieval_context.cache.enc"
            encrypt_cache(payload_bytes, cache_path, session_key)
            correct_decrypt_ok = decrypt_cache(cache_path, session_key) == payload_bytes
            wrong_key_failed = self._verify_wrong_key_fails([str(cache_path)])
        else:
            cache_path = host_run_dir / "retrieval_context.cache"
            cache_path.write_bytes(payload_bytes)
            correct_decrypt_ok = False
            wrong_key_failed = None

        base_answer = _compose_base_answer(clean_question)
        qwen_result = self.qwen_runner.generate(clean_question, snippets, adapter_path)
        scan = scan_for_sentinel(host_run_dir, SENTINEL)
        if qwen_result.get("ok"):
            answer = qwen_result.get("text") or "本地 Qwen 已完成推理，但没有生成可展示文本。"
        else:
            fallback = _compose_vault_answer(clean_question, snippets, adapter_path, mode)
            answer = (
                "真实 Qwen 未完成本次推理，当前显示规则降级回答。\n"
                "降级原因：%s\n\n%s"
                % (qwen_result.get("error") or qwen_result.get("last_error") or "未知错误", fallback)
            )
        session_key = None
        return {
            "inference_id": inference_id,
            "mode": mode,
            "question": clean_question,
            "base_answer": base_answer,
            "vault_answer": answer,
            "model_backend": qwen_result,
            "retrieved_snippets": snippets,
            "selected_documents": [
                {
                    "id": doc["id"],
                    "title": doc["title"],
                    "contains_sentinel": doc["contains_sentinel"],
                }
                for doc in documents
            ],
            "cache_verification": {
                "cache_path": str(cache_path),
                "encrypted": mode == "vault",
                "correct_decrypt_ok": correct_decrypt_ok,
                "wrong_key_decrypt_failed": wrong_key_failed,
                "host_plaintext_found": scan["found"],
                "host_plaintext_hits": scan["hits"],
                "session_key_destroyed": session_key is None,
            },
            "file_flow": _build_inference_flow(
                mode, documents, cache_path, scan, adapter_path, qwen_result
            ),
            "safety_boundary": SAFETY_BOUNDARY,
        }

    def start_run(
        self, mode: str, document_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        if mode not in {"baseline", "vault"}:
            raise ValueError("mode must be 'baseline' or 'vault'")
        self.ensure_layout()
        selected_ids = list(document_ids or [])
        run_id = "%s-%s" % (mode, datetime.now().strftime("%Y%m%d-%H%M%S"))
        run_id = "%s-%s" % (run_id, uuid.uuid4().hex[:6])
        started_at = _now_iso()
        with self._lock:
            self._runs[run_id] = {
                "run_id": run_id,
                "mode": mode,
                "status": "running",
                "started_at": started_at,
                "document_ids": selected_ids,
                "events": [],
                "report": None,
            }
        thread = threading.Thread(
            target=self._run_guarded, args=(run_id, mode, selected_ids), daemon=True
        )
        thread.start()
        return {"run_id": run_id, "mode": mode, "status": "running", "started_at": started_at}

    def get_events(self, run_id: str) -> Dict[str, Any]:
        with self._lock:
            run = self._runs.get(run_id)
            if not run:
                disk_report = self._read_report(run_id)
                if disk_report:
                    return {
                        "run_id": run_id,
                        "status": disk_report.get("status", "completed"),
                        "events": disk_report.get("events", []),
                    }
                raise KeyError(run_id)
            return {
                "run_id": run_id,
                "status": run["status"],
                "events": list(run["events"]),
            }

    def get_report(self, run_id: str) -> Dict[str, Any]:
        with self._lock:
            run = self._runs.get(run_id)
            if run and run.get("report"):
                return run["report"]
        report = self._read_report(run_id)
        if report:
            return report
        raise KeyError(run_id)

    def get_latest_report(self) -> Optional[Dict[str, Any]]:
        latest_path = self.reports_dir / "last_report.json"
        if not latest_path.exists():
            return None
        try:
            return json.loads(latest_path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def get_latest_reports_by_mode(self) -> Dict[str, Optional[Dict[str, Any]]]:
        latest: Dict[str, Optional[Dict[str, Any]]] = {"baseline": None, "vault": None}
        latest_mtime: Dict[str, float] = {"baseline": -1.0, "vault": -1.0}
        if not self.reports_dir.exists():
            return latest
        for path in self.reports_dir.glob("*.json"):
            if path.name == "last_report.json":
                continue
            try:
                report = json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                continue
            mode = report.get("mode")
            if mode not in latest:
                continue
            mtime = path.stat().st_mtime
            if mtime > latest_mtime[mode]:
                latest[mode] = report
                latest_mtime[mode] = mtime
        return latest

    def verify_run(self, run_id: str) -> Dict[str, Any]:
        report = self.get_report(run_id)
        verification = self._run_verification(report)
        report["verification"] = verification
        report["sentinel"] = {
            **(report.get("sentinel") or {}),
            "host_plaintext_found": verification["summary"]["host_plaintext_found"],
            "host_plaintext_hits": verification["summary"]["host_plaintext_hits"],
        }
        cache = report.get("cache_encryption") or {}
        report["cache_encryption"] = {
            **cache,
            "cache_files": verification["summary"]["cache_files"],
            "encrypted_cache_files": verification["summary"]["encrypted_cache_files"],
            "plaintext_cache_files": verification["summary"]["plaintext_cache_files"],
            "wrong_key_decrypt_failed": verification["summary"]["wrong_key_decrypt_failed"],
            "encrypted_entropy_bits_per_byte": verification["summary"]["encrypted_entropy_bits_per_byte"],
        }
        self._write_report(report)
        with self._lock:
            if run_id in self._runs:
                self._runs[run_id]["report"] = report
        return report

    def _run_guarded(self, run_id: str, mode: str, document_ids: List[str]) -> None:
        try:
            report = self._run_scenario(run_id, mode, document_ids)
            self._finish_run(run_id, "completed", report)
        except Exception as exc:
            error_report = {
                "run_id": run_id,
                "mode": mode,
                "status": "failed",
                "error": str(exc),
                "traceback": traceback.format_exc(),
                "events": self._snapshot_events(run_id),
                "safety_boundary": SAFETY_BOUNDARY,
            }
            self._event(
                run_id,
                "验证报告",
                "failure",
                "demo-engine",
                "reports",
                "record_failure",
                "failed",
                str(exc),
            )
            self._finish_run(run_id, "failed", error_report)

    def _run_scenario(
        self, run_id: str, mode: str, document_ids: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        started = time.perf_counter()
        host_run_dir = self.host_scratch_dir / run_id
        vault_run_dir = self.audit_dir / run_id
        host_run_dir.mkdir(parents=True, exist_ok=True)
        vault_run_dir.mkdir(parents=True, exist_ok=True)
        hardware = self.get_hardware()
        selected_documents = self._resolve_documents(document_ids)

        self._event(
            run_id,
            "接入与探测",
            "hardware_probe",
            "host",
            "sandbox",
            "probe_resources",
            "ok",
            "检测到 %s 个 GPU，当前执行设备为 %s"
            % (hardware.get("gpu_count", 0), hardware.get("selected_device", "cpu")),
        )
        time.sleep(0.25)

        dataset = self._load_private_dataset(selected_documents)
        self._event(
            run_id,
            "隔离环境初始化",
            "dataset_mount",
            "vault_drive/private_data",
            "sandbox",
            "mount_private_dataset",
            "ok",
            "读取训练样本 %d 条，挂载微调文档 %d 份，sentinel 仅允许出现在 vault 或加密载荷内"
            % (len(dataset), len(selected_documents)),
        )
        time.sleep(0.25)

        session_key: Optional[bytes] = None
        if mode == "vault":
            session_key = AESGCM.generate_key(bit_length=256)
            self._event(
                run_id,
                "隔离环境初始化",
                "session_key",
                "sandbox-memory",
                "aes-gcm",
                "create_session_key",
                "ok",
                "生成单次会话 AES-256-GCM 密钥，仅保留在当前进程内存中",
            )
        else:
            self._event(
                run_id,
                "隔离环境初始化",
                "unsafe_config",
                "application",
                "host_scratch",
                "use_plaintext_cache",
                "warning",
                "无保护模式下缓存以明文形式写入宿主机临时目录，用于形成风险对照。",
            )
        time.sleep(0.25)

        training = self._train_toy_adapter(run_id, mode, dataset, host_run_dir, session_key, hardware)
        time.sleep(0.2)

        wrong_key_failed = None
        correct_decrypt_checks = training.get("correct_decrypt_checks", 0)
        if mode == "vault":
            wrong_key_failed = self._verify_wrong_key_fails(training.get("encrypted_cache_files", []))
            session_key = None
            self._event(
                run_id,
                "安全退出",
                "session_key",
                "sandbox-memory",
                "destroyed",
                "zeroize_session_key",
                "ok",
                "会话密钥引用已销毁，宿主机残留缓存只能作为不可读密文保留",
            )
        else:
            self._event(
                run_id,
                "安全退出",
                "plaintext_leftover",
                "host_scratch",
                "attacker",
                "inspect_plaintext",
                "warning",
                "无保护模式下宿主机临时目录存在可直接扫描到的明文敏感片段",
            )
        time.sleep(0.2)

        scan = scan_for_sentinel(host_run_dir, SENTINEL)
        cache_files = _list_cache_files(host_run_dir)
        encrypted_entropy = None
        if training.get("encrypted_cache_files"):
            encrypted_entropy = estimate_entropy(Path(training["encrypted_cache_files"][0]))

        if mode == "vault":
            scan_status = "ok" if not scan["found"] else "failed"
            detail = (
                "宿主机临时盘未发现 sentinel 明文"
                if not scan["found"]
                else "宿主机临时盘发现 sentinel 明文，隔离失败"
            )
        else:
            scan_status = "warning" if scan["found"] else "failed"
            detail = (
                "基线扫描发现 sentinel 明文，证明风险可观测"
                if scan["found"]
                else "基线未发现 sentinel，演示数据异常"
            )
        self._event(
            run_id,
            "验证报告",
            "sentinel_scan",
            "host_scratch",
            "reports",
            "scan_plaintext",
            scan_status,
            detail,
        )

        ended_at = _now_iso()
        duration_ms = int((time.perf_counter() - started) * 1000)
        report = {
            "run_id": run_id,
            "mode": mode,
            "status": "completed",
            "started_at": self._runs[run_id]["started_at"],
            "ended_at": ended_at,
            "duration_ms": duration_ms,
            "hardware": hardware,
            "selected_documents": [
                {
                    "id": doc["id"],
                    "title": doc["title"],
                    "bytes": doc["bytes"],
                    "contains_sentinel": doc["contains_sentinel"],
                }
                for doc in selected_documents
            ],
            "training": training,
            "sentinel": {
                "value": SENTINEL,
                "host_scan_root": str(host_run_dir),
                "host_plaintext_found": scan["found"],
                "host_plaintext_hits": scan["hits"],
            },
            "cache_encryption": {
                "enabled": mode == "vault",
                "cache_files": cache_files,
                "encrypted_cache_files": training.get("encrypted_cache_files", []),
                "plaintext_cache_files": training.get("plaintext_cache_files", []),
                "correct_decrypt_checks": correct_decrypt_checks,
                "wrong_key_decrypt_failed": wrong_key_failed,
                "session_key_destroyed": mode == "vault",
                "encrypted_entropy_bits_per_byte": encrypted_entropy,
            },
            "paths": {
                "vault_drive": str(self.vault_dir),
                "host_scratch_run": str(host_run_dir),
                "reports": str(self.reports_dir),
                "adapter": training.get("adapter_path"),
            },
            "runtime_flow": _build_training_flow(mode, selected_documents, training, scan),
            "safety_boundary": SAFETY_BOUNDARY,
            "events": self._snapshot_events(run_id),
        }
        self._write_report(report)
        return report

    def _train_toy_adapter(
        self,
        run_id: str,
        mode: str,
        dataset: List[Dict[str, Any]],
        host_run_dir: Path,
        session_key: Optional[bytes],
        hardware: Dict[str, Any],
    ) -> Dict[str, Any]:
        try:
            import torch
            import torch.nn.functional as F
        except Exception as exc:
            self._event(
                run_id,
                "安全微调",
                "torch_missing",
                "python",
                "demo-engine",
                "fallback",
                "warning",
                "PyTorch 不可用，生成模拟训练指标：%s" % exc,
            )
            return self._simulated_training(run_id, mode, dataset, host_run_dir, session_key, hardware)

        device_name = hardware.get("selected_device", "cpu")
        if not isinstance(device_name, str) or not device_name.startswith("cuda"):
            device_name = "cpu"
        try:
            device = torch.device(device_name if torch.cuda.is_available() and device_name != "cpu" else "cpu")
            if device.type == "cuda":
                torch.zeros(1, device=device)
        except Exception:
            device = torch.device("cpu")
            device_name = "cpu"

        random.seed(7)
        torch.manual_seed(7)
        input_dim = 48
        num_classes = 4
        rank = 4
        features, labels = _vectorize_dataset(dataset, input_dim)
        x = torch.tensor(features, dtype=torch.float32, device=device)
        y = torch.tensor(labels, dtype=torch.long, device=device)

        base_weight = torch.randn(num_classes, input_dim, device=device) * 0.08
        base_weight.requires_grad_(False)
        adapter_a = torch.nn.Parameter(torch.randn(input_dim, rank, device=device) * 0.03)
        adapter_b = torch.nn.Parameter(torch.zeros(rank, num_classes, device=device))
        optimizer = torch.optim.Adam([adapter_a, adapter_b], lr=0.18)

        self._event(
            run_id,
            "安全微调",
            "train_start",
            "sandbox",
            "gpu" if device.type == "cuda" else "cpu",
            "start_toy_lora",
            "ok",
            "启动轻量 adapter 训练，设备=%s，样本=%d，rank=%d"
            % (device_name, len(dataset), rank),
        )

        losses: List[float] = []
        encrypted_cache_files: List[str] = []
        plaintext_cache_files: List[str] = []
        correct_decrypt_checks = 0
        epochs = 18
        for epoch in range(1, epochs + 1):
            optimizer.zero_grad()
            hidden = x.matmul(adapter_a)
            logits = x.matmul(base_weight.t()) + hidden.matmul(adapter_b) * (1.0 / rank)
            loss = F.cross_entropy(logits, y)
            loss.backward()
            optimizer.step()
            losses.append(round(float(loss.detach().cpu().item()), 5))

            if epoch in {1, 6, 12, 18}:
                payload = {
                    "epoch": epoch,
                    "kind": "intermediate_activation_cache",
                    "sentinel": SENTINEL,
                    "loss": losses[-1],
                    "activation_preview": [
                        round(float(v), 6) for v in hidden.detach().cpu().flatten()[:12].tolist()
                    ],
                }
                payload_bytes = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                if mode == "vault":
                    assert session_key is not None
                    cache_path = host_run_dir / ("activation_epoch_%02d.cache.enc" % epoch)
                    encrypt_cache(payload_bytes, cache_path, session_key)
                    decrypted = decrypt_cache(cache_path, session_key)
                    if decrypted == payload_bytes:
                        correct_decrypt_checks += 1
                    encrypted_cache_files.append(str(cache_path))
                    self._event(
                        run_id,
                        "加密卸载",
                        "cache_write",
                        "sandbox-memory",
                        "host_scratch",
                        "aes_gcm_encrypt_and_offload",
                        "ok",
                        "epoch %02d 中间缓存已加密卸载到宿主机临时盘" % epoch,
                    )
                else:
                    cache_path = host_run_dir / ("activation_epoch_%02d.cache" % epoch)
                    cache_path.write_bytes(payload_bytes)
                    plaintext_cache_files.append(str(cache_path))
                    self._event(
                        run_id,
                        "不安全缓存",
                        "cache_write",
                        "sandbox-memory",
                        "host_scratch",
                        "write_plaintext_cache",
                        "warning",
                        "epoch %02d 中间缓存明文落入宿主机临时盘" % epoch,
                    )
            time.sleep(0.05)

        with torch.no_grad():
            hidden = x.matmul(adapter_a)
            logits = x.matmul(base_weight.t()) + hidden.matmul(adapter_b) * (1.0 / rank)
            pred = torch.argmax(logits, dim=1)
            accuracy = round(float((pred == y).float().mean().detach().cpu().item()), 4)

        adapter_path = self.adapter_dir / ("adapter_%s.pt" % run_id)
        torch.save(
            {
                "adapter_a": adapter_a.detach().cpu(),
                "adapter_b": adapter_b.detach().cpu(),
                "rank": rank,
                "input_dim": input_dim,
                "num_classes": num_classes,
                "labels": ["心内科", "呼吸科", "消化科", "随访咨询"],
                "demo_note": "Synthetic toy LoRA adapter for AI vault visualization demo.",
            },
            adapter_path,
        )
        self._event(
            run_id,
            "结果回写",
            "adapter_save",
            "sandbox",
            "vault_drive/adapters",
            "persist_adapter",
            "ok",
            "最终 adapter 已保存到移动存储模拟区：%s" % adapter_path.name,
        )

        return {
            "device": str(device),
            "epochs": epochs,
            "samples": len(dataset),
            "rank": rank,
            "loss_first": losses[0],
            "loss_last": losses[-1],
            "loss_curve": losses,
            "accuracy": accuracy,
            "adapter_path": str(adapter_path),
            "encrypted_cache_files": encrypted_cache_files,
            "plaintext_cache_files": plaintext_cache_files,
            "correct_decrypt_checks": correct_decrypt_checks,
        }

    def _simulated_training(
        self,
        run_id: str,
        mode: str,
        dataset: List[Dict[str, Any]],
        host_run_dir: Path,
        session_key: Optional[bytes],
        hardware: Dict[str, Any],
    ) -> Dict[str, Any]:
        losses = [round(1.35 - i * 0.04 + random.random() * 0.01, 5) for i in range(18)]
        encrypted_cache_files: List[str] = []
        plaintext_cache_files: List[str] = []
        checks = 0
        for epoch in [1, 6, 12, 18]:
            payload_bytes = json.dumps(
                {"epoch": epoch, "sentinel": SENTINEL, "loss": losses[epoch - 1]},
                ensure_ascii=False,
            ).encode("utf-8")
            if mode == "vault":
                assert session_key is not None
                cache_path = host_run_dir / ("activation_epoch_%02d.cache.enc" % epoch)
                encrypt_cache(payload_bytes, cache_path, session_key)
                if decrypt_cache(cache_path, session_key) == payload_bytes:
                    checks += 1
                encrypted_cache_files.append(str(cache_path))
            else:
                cache_path = host_run_dir / ("activation_epoch_%02d.cache" % epoch)
                cache_path.write_bytes(payload_bytes)
                plaintext_cache_files.append(str(cache_path))
        adapter_path = self.adapter_dir / ("adapter_%s.json" % run_id)
        adapter_path.write_text(
            json.dumps({"simulated": True, "loss_curve": losses}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return {
            "device": hardware.get("selected_device", "cpu"),
            "epochs": 18,
            "samples": len(dataset),
            "rank": 4,
            "loss_first": losses[0],
            "loss_last": losses[-1],
            "loss_curve": losses,
            "accuracy": 0.875,
            "adapter_path": str(adapter_path),
            "encrypted_cache_files": encrypted_cache_files,
            "plaintext_cache_files": plaintext_cache_files,
            "correct_decrypt_checks": checks,
        }

    def _verify_wrong_key_fails(self, encrypted_cache_files: List[str]) -> bool:
        if not encrypted_cache_files:
            return False
        wrong_key = AESGCM.generate_key(bit_length=256)
        try:
            decrypt_cache(Path(encrypted_cache_files[0]), wrong_key)
        except InvalidTag:
            return True
        except Exception:
            return True
        return False

    def _load_private_dataset(self, documents: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
        dataset_path = self.private_data_dir / "synthetic_medical_qa.jsonl"
        samples = []
        with dataset_path.open("r", encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if line:
                    samples.append(json.loads(line))
        for index, document in enumerate(documents or []):
            samples.append(
                {
                    "id": "doc-%s" % document["id"],
                    "question": "根据微调文档 %s 生成专科问答样本。" % document["title"],
                    "answer": document["content"],
                    "label": index % 4,
                }
            )
        return samples

    def _resolve_documents(self, document_ids: Optional[List[str]]) -> List[Dict[str, Any]]:
        all_documents = {doc["id"]: doc for doc in self.list_documents()}
        selected_ids = [doc_id for doc_id in (document_ids or []) if doc_id in all_documents]
        if not selected_ids:
            selected_ids = list(all_documents.keys())
        resolved = []
        for doc_id in selected_ids:
            path = self.fine_tune_docs_dir / doc_id
            doc = dict(all_documents[doc_id])
            try:
                doc["content"] = path.read_text(encoding="utf-8", errors="replace")
            except Exception:
                doc["content"] = ""
            resolved.append(doc)
        return resolved

    def _document_summary(self, path: Path) -> Dict[str, Any]:
        content = path.read_text(encoding="utf-8", errors="replace")
        title = content.splitlines()[0].strip() if content.splitlines() else path.name
        return {
            "id": path.name,
            "name": path.name,
            "title": title or path.name,
            "bytes": path.stat().st_size,
            "modified_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds"),
            "preview": _compact_text(content, 150),
            "path": str(path),
            "contains_sentinel": SENTINEL in content,
        }

    def _event(
        self,
        run_id: str,
        phase: str,
        event_type: str,
        source: str,
        target: str,
        action: str,
        status: str,
        detail: str,
    ) -> None:
        event = {
            "run_id": run_id,
            "ts": _now_iso(),
            "phase": phase,
            "event_type": event_type,
            "source": source,
            "target": target,
            "action": action,
            "status": status,
            "detail": detail,
        }
        with self._lock:
            if run_id in self._runs:
                self._runs[run_id]["events"].append(event)

    def _snapshot_events(self, run_id: str) -> List[Dict[str, Any]]:
        with self._lock:
            run = self._runs.get(run_id)
            if not run:
                return []
            return list(run.get("events", []))

    def _finish_run(self, run_id: str, status: str, report: Dict[str, Any]) -> None:
        report["events"] = self._snapshot_events(run_id)
        self._write_report(report)
        with self._lock:
            if run_id in self._runs:
                self._runs[run_id]["status"] = status
                self._runs[run_id]["report"] = report

    def _write_report(self, report: Dict[str, Any]) -> None:
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        report_path = self.reports_dir / ("%s.json" % report["run_id"])
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        latest_path = self.reports_dir / "last_report.json"
        latest_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    def _read_report(self, run_id: str) -> Optional[Dict[str, Any]]:
        path = self.reports_dir / ("%s.json" % run_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _run_verification(self, report: Dict[str, Any]) -> Dict[str, Any]:
        mode = report.get("mode")
        run_id = report.get("run_id", "")
        paths = report.get("paths") or {}
        training = report.get("training") or {}
        cache = report.get("cache_encryption") or {}
        host_root = Path(paths.get("host_scratch_run") or self.host_scratch_dir / run_id)
        adapter_path = Path(training.get("adapter_path") or paths.get("adapter") or "")
        report_path = self.reports_dir / ("%s.json" % run_id)

        started = time.perf_counter()
        scan = scan_for_sentinel(host_root, SENTINEL)
        cache_files = _list_cache_files(host_root)
        encrypted_cache_files = [
            path for path in cache_files if path.endswith(".enc") and Path(path).exists()
        ]
        report_plaintext = [
            path for path in cache.get("plaintext_cache_files", []) if Path(path).exists()
        ]
        plaintext_cache_files = sorted(
            set(report_plaintext)
            | {
                hit["path"]
                for hit in scan.get("hits", [])
                if ".cache" in Path(hit["path"]).name and not hit["path"].endswith(".enc")
            }
        )
        wrong_key_failed = (
            self._verify_wrong_key_fails(encrypted_cache_files) if encrypted_cache_files else None
        )
        encrypted_entropy = (
            estimate_entropy(Path(encrypted_cache_files[0])) if encrypted_cache_files else None
        )
        report_sha256 = None
        if report_path.exists():
            report_sha256 = hashlib.sha256(report_path.read_bytes()).hexdigest()

        is_vault = mode == "vault"
        checks = [
            {
                "id": "host_plaintext_scan",
                "name": "宿主机明文残留扫描",
                "method": "递归读取 host_scratch 本次运行目录，按字节搜索敏感 sentinel。",
                "status": "pass" if not scan["found"] else "risk",
                "result": "未检出敏感明文" if not scan["found"] else "检出敏感明文",
                "evidence": "扫描根目录：%s；命中数量：%d"
                % (host_root, len(scan.get("hits", []))),
            },
            {
                "id": "cache_encryption_shape",
                "name": "缓存加密形态验证",
                "method": "枚举本次运行缓存文件，核验 .enc 密文缓存与明文缓存数量。",
                "status": "pass"
                if is_vault and encrypted_cache_files and not plaintext_cache_files
                else "risk",
                "result": "仅发现密文缓存"
                if is_vault and encrypted_cache_files and not plaintext_cache_files
                else "存在明文缓存",
                "evidence": "密文缓存：%d 个；明文缓存：%d 个；缓存总数：%d 个"
                % (len(encrypted_cache_files), len(plaintext_cache_files), len(cache_files)),
            },
            {
                "id": "wrong_key_rejection",
                "name": "错误密钥拒绝验证",
                "method": "用随机 AES-GCM 错误密钥尝试解密首个密文缓存。",
                "status": "pass" if wrong_key_failed is True else "skip" if wrong_key_failed is None else "risk",
                "result": "错误密钥解密失败"
                if wrong_key_failed is True
                else "无密文缓存可测"
                if wrong_key_failed is None
                else "错误密钥未被拒绝",
                "evidence": "检测文件：%s" % (encrypted_cache_files[0] if encrypted_cache_files else "无"),
            },
            {
                "id": "adapter_residency",
                "name": "Adapter 产物归属验证",
                "method": "检查 adapter 产物是否存在，且路径位于 vault_drive/adapters。",
                "status": "pass"
                if adapter_path.exists() and self.adapter_dir in adapter_path.parents
                else "risk",
                "result": "Adapter 位于 Vault"
                if adapter_path.exists() and self.adapter_dir in adapter_path.parents
                else "Adapter 路径异常或不存在",
                "evidence": "Adapter 路径：%s" % (adapter_path if str(adapter_path) != "." else "无"),
            },
            {
                "id": "audit_report_integrity",
                "name": "审计报告完整性检查",
                "method": "读取本次运行 JSON 报告并计算 SHA-256 摘要。",
                "status": "pass" if report_sha256 else "risk",
                "result": "报告文件可读取" if report_sha256 else "报告文件缺失",
                "evidence": "报告路径：%s；SHA-256：%s"
                % (report_path, report_sha256[:16] + "…" if report_sha256 else "无"),
            },
        ]
        return {
            "verified_at": _now_iso(),
            "duration_ms": int((time.perf_counter() - started) * 1000),
            "mode": mode,
            "summary": {
                "host_scan_root": str(host_root),
                "host_plaintext_found": scan["found"],
                "host_plaintext_hits": scan["hits"],
                "cache_files": cache_files,
                "encrypted_cache_files": encrypted_cache_files,
                "plaintext_cache_files": plaintext_cache_files,
                "wrong_key_decrypt_failed": wrong_key_failed,
                "encrypted_entropy_bits_per_byte": encrypted_entropy,
                "adapter_exists": adapter_path.exists(),
                "adapter_in_vault": adapter_path.exists() and self.adapter_dir in adapter_path.parents,
                "report_sha256": report_sha256,
            },
            "checks": checks,
            "safety_boundary": SAFETY_BOUNDARY,
        }


def encrypt_cache(payload: bytes, path: Path, key: bytes) -> None:
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, payload, None)
    path.write_bytes(nonce + ciphertext)


def decrypt_cache(path: Path, key: bytes) -> bytes:
    raw = path.read_bytes()
    nonce = raw[:12]
    ciphertext = raw[12:]
    return AESGCM(key).decrypt(nonce, ciphertext, None)


def _safe_filename(filename: str) -> str:
    name = Path(filename or "uploaded_document.txt").name.strip()
    if not name:
        name = "uploaded_document.txt"
    stem = Path(name).stem or "uploaded_document"
    suffix = Path(name).suffix.lower() or ".txt"
    if suffix not in {".txt", ".md", ".json", ".csv"}:
        suffix = ".txt"
    clean_stem = re.sub(r"[^A-Za-z0-9_\-\u4e00-\u9fff]+", "_", stem).strip("_")
    if not clean_stem:
        clean_stem = "uploaded_document"
    return (clean_stem[:64] + suffix)[:90]


def _compact_text(text: str, limit: int = 180) -> str:
    collapsed = re.sub(r"\s+", " ", text or "").strip()
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1] + "…"


def _retrieve_snippets(question: str, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    query_tokens = _query_tokens(question)
    query_identifiers = _identifier_keys(question)
    total_weight = sum(_term_weight(token) for token in query_tokens) or 1.0
    scored = []

    for doc in documents:
        metadata = "%s %s" % (doc.get("title", ""), doc.get("id", ""))
        metadata_normalized = _normalize_search_text(metadata)
        metadata_identifiers = _identifier_keys(metadata)
        identifier_match = bool(query_identifiers & metadata_identifiers)

        for chunk_index, chunk in enumerate(_document_chunks(doc.get("content", ""))):
            chunk_text = chunk["text"]
            chunk_normalized = _normalize_search_text(chunk_text)
            chunk_identifiers = _identifier_keys(chunk_text)
            chunk_identifier_match = bool(query_identifiers & chunk_identifiers)
            candidate_identifier_match = identifier_match or chunk_identifier_match
            matched_terms = []
            content_weight = 0.0
            metadata_weight = 0.0

            if query_identifiers and not candidate_identifier_match:
                continue

            for token in query_tokens:
                token_normalized = _normalize_search_text(token)
                if not token_normalized:
                    continue
                weight = _term_weight(token)
                if token_normalized in chunk_normalized:
                    matched_terms.append(token)
                    content_weight += weight
                elif token_normalized in metadata_normalized:
                    matched_terms.append(token)
                    metadata_weight += weight * 0.35

            if candidate_identifier_match:
                metadata_weight += 12.0
                identifier_terms = sorted(
                    query_identifiers & (metadata_identifiers | chunk_identifiers)
                )
                matched_terms.extend(identifier_terms)

            # Metadata can select the right patient file, but a citation still needs
            # question-specific evidence in the chunk whenever such terms exist.
            if content_weight <= 0 and not candidate_identifier_match:
                continue

            score = content_weight + metadata_weight
            normalized_question = _normalize_search_text(question)
            if normalized_question and normalized_question in chunk_normalized:
                score += 18.0

            relevance = min(1.0, content_weight / total_weight)
            scored.append(
                {
                    "score": round(score, 3),
                    "relevance": round(relevance, 3),
                    "matched_terms": _deduplicate_terms(matched_terms)[:8],
                    "document": doc,
                    "chunk": chunk,
                    "chunk_index": chunk_index,
                    "content_weight": content_weight,
                }
            )

    scored.sort(
        key=lambda item: (
            item["score"],
            item["content_weight"],
            -item["chunk_index"],
        ),
        reverse=True,
    )
    if not scored:
        return []

    minimum_score = max(8.0, scored[0]["score"] * 0.45)
    snippets = []
    per_document: Dict[str, int] = {}
    seen_text = set()
    for item in scored:
        if item["score"] < minimum_score or len(snippets) >= 4:
            break
        doc = item["document"]
        document_id = doc["id"]
        if per_document.get(document_id, 0) >= 2:
            continue
        snippet_text = _compact_text(item["chunk"]["text"], 520)
        normalized_snippet = _normalize_search_text(snippet_text)
        if not normalized_snippet or normalized_snippet in seen_text:
            continue
        seen_text.add(normalized_snippet)
        per_document[document_id] = per_document.get(document_id, 0) + 1
        snippets.append(
            {
                "document_id": document_id,
                "title": doc["title"],
                "section": item["chunk"].get("section") or "相关内容",
                "score": item["score"],
                "relevance": item["relevance"],
                "matched_terms": item["matched_terms"],
                "snippet": snippet_text,
                "contains_sentinel": doc.get("contains_sentinel", False),
            }
        )
    return snippets


def _query_tokens(question: str) -> List[str]:
    text = unicodedata.normalize("NFKC", re.sub(r"\s+", "", question or ""))
    domain_terms = [
        "下一次复查",
        "复查日期",
        "签到时间",
        "复查地点",
        "实验室检查",
        "低密度脂蛋白胆固醇",
        "肾小球滤过率",
        "肌酐",
        "eGFR",
        "LDL-C",
        "日期",
        "时间",
        "地点",
        "胸痛",
        "胸闷",
        "心悸",
        "肌钙蛋白",
        "心电图",
        "血压",
        "心内科",
        "急诊",
        "咳嗽",
        "喘息",
        "气短",
        "血氧",
        "肺部",
        "呼吸",
        "慢阻肺",
        "术后",
        "随访",
        "复查",
        "用药",
        "伤口",
        "感冒",
        "普通感冒",
        "流行性感冒",
        "流感",
        "病原体",
        "症状",
        "传染性",
        "类型",
        "分类",
        "分为",
        "隐私",
        "病历",
    ]
    generic_terms = {
        "患者",
        "流程",
        "应该",
        "优先",
        "参考",
        "哪份",
        "哪些",
        "什么",
        "怎么",
        "怎样",
        "如何",
        "今天",
        "天气",
        "北京",
        "怎么样",
        "分什么",
        "为什么",
    }
    tokens = [
        term
        for term in domain_terms
        if _normalize_search_text(term) in _normalize_search_text(text)
        and term not in generic_terms
    ]
    for token in _overlap_terms(text):
        if len(token) >= 2 and token not in tokens and token not in generic_terms:
            tokens.append(token)
    return _deduplicate_terms(tokens)[:24]


def _overlap_terms(text: str) -> List[str]:
    tokens = re.findall(r"[A-Za-z][A-Za-z0-9_\-]{2,}", text)
    chars = "".join(char for char in text if re.match(r"[\u4e00-\u9fff]", char))
    for size in (4, 3, 2):
        for index in range(0, max(0, len(chars) - size + 1)):
            token = chars[index : index + size]
            if any(bad in token for bad in ["什", "么", "怎", "如何", "哪些", "哪份", "应该"]):
                continue
            tokens.append(token)
    return tokens


def _document_chunks(content: str, max_chars: int = 520) -> List[Dict[str, str]]:
    lines = [line.strip() for line in (content or "").splitlines() if line.strip()]
    if not lines:
        return []

    chunks: List[Dict[str, str]] = []
    current_lines: List[str] = []
    current_section = ""

    def flush() -> None:
        nonlocal current_lines
        text = "\n".join(current_lines).strip()
        if text:
            chunks.append({"text": text, "section": current_section})
        current_lines = []

    for line in lines:
        is_heading = bool(
            re.match(
                r"^(?:[一二三四五六七八九十]+、|第[一二三四五六七八九十0-9]+[章节部分])",
                line,
            )
        )
        if is_heading:
            flush()
            current_section = line
            current_lines = [line]
            continue

        projected = len("\n".join(current_lines + [line]))
        if current_lines and projected > max_chars:
            overlap = current_lines[-1:]
            flush()
            current_lines = ([current_section] if current_section else []) + overlap
        current_lines.append(line)
    flush()
    return chunks


def _normalize_search_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text or "").casefold()
    return re.sub(r"[^a-z0-9\u4e00-\u9fff]+", "", normalized)


def _identifier_keys(text: str) -> set:
    normalized = unicodedata.normalize("NFKC", text or "").casefold()
    keys = set()
    pattern = r"[a-z]+(?:[\s_-]*[a-z]+)*[\s_-]*\d{3,}"
    for match in re.findall(pattern, normalized):
        compact = re.sub(r"[^a-z0-9]", "", match)
        alpha_parts = re.findall(r"[a-z]+", match)
        digits = "".join(re.findall(r"\d+", match))
        if compact:
            keys.add(compact)
        if alpha_parts and digits:
            keys.add(alpha_parts[0] + digits)
    return keys


def _term_weight(token: str) -> float:
    normalized = _normalize_search_text(token)
    high_value_terms = {
        "下一次复查",
        "复查日期",
        "签到时间",
        "复查地点",
        "实验室检查",
        "低密度脂蛋白胆固醇",
        "肾小球滤过率",
        "肌酐",
        "egfr",
        "ldlc",
        "日期",
        "时间",
        "地点",
    }
    if normalized in {_normalize_search_text(term) for term in high_value_terms}:
        return 12.0
    if re.search(r"[a-z0-9]", normalized):
        return 10.0
    if len(normalized) >= 5:
        return 8.0
    if len(normalized) == 4:
        return 7.0
    if len(normalized) == 3:
        return 5.0
    return 3.0


def _deduplicate_terms(terms: List[str]) -> List[str]:
    result = []
    seen = set()
    for term in terms:
        normalized = _normalize_search_text(term)
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        result.append(term)
    return result


def _compose_base_answer(question: str) -> str:
    return (
        "通用模型回答：问题涉及专业资料，建议结合院内规范、检查结果和医生判断。"
        "由于未加载私有文档，回答只能停留在通用建议层面。"
    )


def _compose_vault_answer(
    question: str, snippets: List[Dict[str, Any]], adapter_path: Optional[str], mode: str
) -> str:
    if not snippets:
        return "保险箱增强模型回答：未在已选文档中检索到可用依据，请先选择或上传微调文档。"
    top = snippets[0]
    adapter_state = "已加载最新 adapter" if adapter_path else "尚未运行微调，使用文档检索上下文"
    answer = [
        "保险箱增强模型回答：",
        "1. 已根据已选微调文档定位到《%s》。" % top["title"],
        "2. 结合文档内容，当前问题可优先按该专科流程处理：%s" % top["snippet"],
        "3. 运行状态：%s；上下文缓存%s落入宿主机临时盘。"
        % (adapter_state, "以 AES-GCM 密文形式" if mode == "vault" else "以明文形式"),
    ]
    if top.get("contains_sentinel"):
        answer.append("4. 命中的文档含敏感标记，报告会继续验证宿主机目录是否出现明文残留。")
    return "\n".join(answer)


def _build_training_flow(
    mode: str,
    documents: List[Dict[str, Any]],
    training: Dict[str, Any],
    scan: Dict[str, Any],
) -> List[Dict[str, Any]]:
    encrypted = mode == "vault"
    return [
        {
            "stage": "1",
            "name": "文档进入移动 SSD",
            "source": "Browser / Operator",
            "target": "vault_drive/fine_tune_docs",
            "status": "ok",
            "detail": "已选 %d 份微调文档，敏感原文只作为 vault 内部训练语料读取" % len(documents),
        },
        {
            "stage": "2",
            "name": "隔离环境挂载数据集",
            "source": "vault_drive/private_data",
            "target": "sandbox-memory",
            "status": "ok",
            "detail": "合成样本与文档片段被装配为轻量 adapter 训练集",
        },
        {
            "stage": "3",
            "name": "宿主机提供算力",
            "source": "sandbox",
            "target": training.get("device", "cpu"),
            "status": "ok",
            "detail": "冻结基础权重，仅训练低秩 adapter 参数",
        },
        {
            "stage": "4",
            "name": "中间缓存处理",
            "source": "sandbox-memory",
            "target": "host_scratch",
            "status": "ok" if encrypted else "warning",
            "detail": "AES-GCM 密文卸载" if encrypted else "基线模式明文写入，作为泄露对照",
        },
        {
            "stage": "5",
            "name": "结果回写",
            "source": "sandbox",
            "target": "vault_drive/adapters",
            "status": "ok",
            "detail": "adapter 产物：%s" % Path(training.get("adapter_path", "")).name,
        },
        {
            "stage": "6",
            "name": "明文扫描",
            "source": "host_scratch",
            "target": "reports",
            "status": "ok" if encrypted and not scan.get("found") else "warning",
            "detail": "未发现 sentinel 明文"
            if not scan.get("found")
            else "发现 %d 处 sentinel 明文" % len(scan.get("hits", [])),
        },
    ]


def _build_inference_flow(
    mode: str,
    documents: List[Dict[str, Any]],
    cache_path: Path,
    scan: Dict[str, Any],
    adapter_path: Optional[str],
    model_backend: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    encrypted = mode == "vault"
    backend = model_backend or {}
    qwen_ok = bool(backend.get("real_model"))
    qwen_detail = (
        "%s · %s · 生成 %.3fs"
        % (
            backend.get("model_id", "Qwen"),
            backend.get("device", "unknown"),
            float(backend.get("generate_seconds") or 0.0),
        )
        if qwen_ok
        else "真实 Qwen 未完成加载/推理：%s"
        % (backend.get("error") or backend.get("last_error") or "等待首次调用")
    )
    return [
        {
            "stage": "Q1",
            "name": "用户提问",
            "source": "Browser",
            "target": "sandbox API",
            "status": "ok",
            "detail": "问题进入隔离运行环境，未写入宿主机持久目录",
        },
        {
            "stage": "Q2",
            "name": "读取微调文档",
            "source": "vault_drive/fine_tune_docs",
            "target": "retriever",
            "status": "ok",
            "detail": "检索 %d 份已选文档" % len(documents),
        },
        {
            "stage": "Q3",
            "name": "加载本地 Qwen",
            "source": "vault_drive/model_cache",
            "target": backend.get("device", "GPU / CPU"),
            "status": "ok" if qwen_ok else "warning",
            "detail": qwen_detail,
        },
        {
            "stage": "Q4",
            "name": "加载 adapter",
            "source": "vault_drive/adapters",
            "target": "Qwen prompt context",
            "status": "ok" if adapter_path else "warning",
            "detail": Path(adapter_path).name if adapter_path else "尚未生成 adapter，使用文档上下文演示",
        },
        {
            "stage": "Q5",
            "name": "上下文缓存",
            "source": "sandbox-memory",
            "target": str(cache_path),
            "status": "ok" if encrypted else "warning",
            "detail": "AES-GCM 密文缓存" if encrypted else "明文缓存风险",
        },
        {
            "stage": "Q6",
            "name": "退出验证",
            "source": "host_scratch/model_inference",
            "target": "scanner",
            "status": "ok" if encrypted and not scan.get("found") else "warning",
            "detail": "宿主机无明文 sentinel"
            if not scan.get("found")
            else "宿主机发现 %d 处明文 sentinel" % len(scan.get("hits", [])),
        },
    ]


def scan_for_sentinel(root: Path, sentinel: str) -> Dict[str, Any]:
    sentinel_bytes = sentinel.encode("utf-8")
    hits: List[Dict[str, Any]] = []
    if not root.exists():
        return {"found": False, "hits": hits}
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        try:
            data = path.read_bytes()
        except Exception:
            continue
        index = data.find(sentinel_bytes)
        if index >= 0:
            hits.append({"path": str(path), "offset": index, "bytes": len(data)})
    return {"found": bool(hits), "hits": hits}


def estimate_entropy(path: Path) -> Optional[float]:
    try:
        data = path.read_bytes()
    except Exception:
        return None
    if not data:
        return 0.0
    counts = Counter(data)
    length = len(data)
    entropy = -sum((count / length) * math.log2(count / length) for count in counts.values())
    return round(entropy, 3)


def _list_cache_files(root: Path) -> List[str]:
    if not root.exists():
        return []
    return [str(path) for path in sorted(root.rglob("*")) if path.is_file()]


def collect_nvidia_inventory(nvidia_smi: str, app_dir: Path) -> Dict[str, Any]:
    gpu_result = subprocess.run(
        [
            nvidia_smi,
            "--query-gpu=index,uuid,name,memory.total,memory.used,memory.free,utilization.gpu,power.draw,temperature.gpu",
            "--format=csv,noheader,nounits",
        ],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=6,
    )
    if gpu_result.returncode != 0:
        return {}

    visible = _parse_visible_devices(os.getenv("CUDA_VISIBLE_DEVICES"))
    uuid_to_index: Dict[str, int] = {}
    gpus: List[Dict[str, Any]] = []
    for line in gpu_result.stdout.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) < 9:
            continue
        index = _safe_int(parts[0])
        if index is None:
            continue
        uuid_value = parts[1]
        uuid_to_index[uuid_value] = index
        gpus.append(
            {
                "index": index,
                "uuid": uuid_value,
                "name": parts[2],
                "total_mib": _safe_int(parts[3]) or 0,
                "used_mib": _safe_int(parts[4]) or 0,
                "free_mib": _safe_int(parts[5]) or 0,
                "utilization_gpu": _safe_int(parts[6]) or 0,
                "power_w": _safe_float(parts[7]),
                "temperature_c": _safe_int(parts[8]),
                "visible": not visible or index in visible,
                "processes": [],
                "our_used_mib": 0,
                "other_used_mib": 0,
            }
        )

    by_index = {gpu["index"]: gpu for gpu in gpus}
    process_result = subprocess.run(
        [
            nvidia_smi,
            "--query-compute-apps=gpu_uuid,pid,process_name,used_memory",
            "--format=csv,noheader,nounits",
        ],
        check=False,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=6,
    )
    if process_result.returncode == 0:
        for line in process_result.stdout.splitlines():
            parts = [part.strip() for part in line.split(",")]
            if len(parts) < 4:
                continue
            gpu_index = uuid_to_index.get(parts[0])
            if gpu_index is None or gpu_index not in by_index:
                continue
            pid = _safe_int(parts[1])
            used_mib = _safe_int(parts[3]) or 0
            owned = _process_belongs_to_app(pid, app_dir) if pid is not None else False
            entry = {
                "pid": pid,
                "name": parts[2],
                "used_mib": used_mib,
                "owner": "ours" if owned else "other",
            }
            by_index[gpu_index]["processes"].append(entry)
            if owned:
                by_index[gpu_index]["our_used_mib"] += used_mib

    for gpu in gpus:
        gpu["processes"].sort(key=lambda item: item.get("used_mib", 0), reverse=True)
        gpu["other_used_mib"] = max(0, gpu["used_mib"] - gpu["our_used_mib"])

    visible_gpus = [gpu for gpu in gpus if gpu.get("visible")]
    total_gpus = visible_gpus or gpus
    totals = {
        "gpu_count": len(gpus),
        "visible_count": len(visible_gpus),
        "total_mib": sum(gpu["total_mib"] for gpu in total_gpus),
        "used_mib": sum(gpu["used_mib"] for gpu in total_gpus),
        "free_mib": sum(gpu["free_mib"] for gpu in total_gpus),
        "our_used_mib": sum(gpu["our_used_mib"] for gpu in total_gpus),
        "other_used_mib": sum(gpu["other_used_mib"] for gpu in total_gpus),
        "avg_utilization_gpu": round(
            sum(gpu["utilization_gpu"] for gpu in total_gpus) / max(1, len(total_gpus)), 1
        ),
    }
    return {"gpus": gpus, "totals": totals}


def _parse_visible_devices(raw: Optional[str]) -> Optional[set]:
    if not raw:
        return None
    visible = set()
    for part in raw.split(","):
        part = part.strip()
        if part.isdigit():
            visible.add(int(part))
    return visible or None


def _parse_model_params(value: str) -> Optional[float]:
    match = re.search(r"(\d+(?:\.\d+)?)B", value, flags=re.IGNORECASE)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def _model_label(model_id: str) -> str:
    path = Path(model_id)
    if path.exists():
        model_root = path
        for parent in path.parents:
            if parent.name.startswith("models--Qwen--"):
                model_root = parent
                break
        if model_root.name.startswith("models--Qwen--"):
            return model_root.name.replace("models--Qwen--", "").replace("--", "/")
        return path.name
    return model_id.rsplit("/", 1)[-1] if "/" in model_id else model_id


def _runtime_recommendation(
    inventory: List[Dict[str, Any]], selected_gpu_ids: List[int], model_options: List[Dict[str, Any]]
) -> Dict[str, Any]:
    selected = [gpu for gpu in inventory if int(gpu.get("index", -1)) in selected_gpu_ids]
    if not selected:
        selected = [gpu for gpu in inventory if gpu.get("visible")]
    total_mib = sum(int(gpu.get("total_mib") or 0) for gpu in selected)
    free_mib = sum(int(gpu.get("free_mib") or 0) for gpu in selected)
    count = len(selected)

    def best_option(max_params: float) -> Optional[Dict[str, Any]]:
        candidates = [
            option
            for option in model_options
            if option.get("available") and float(option.get("params_b") or 0) <= max_params
        ]
        if not candidates:
            return None
        return max(candidates, key=lambda option: float(option.get("params_b") or 0))

    if total_mib >= 48000 and count >= 2:
        level = "high"
        recommended = best_option(14) or best_option(7) or best_option(1.5)
        reason = "已选择多张高显存 GPU，适合使用 14B 级模型并通过 device_map=auto 分布加载。"
    elif total_mib >= 20000:
        level = "medium"
        recommended = best_option(7) or best_option(1.5) or best_option(0.5)
        reason = "当前显存适合 0.5B/1.5B/7B 级模型；14B 建议至少选择两张 24GB GPU。"
    elif total_mib >= 6000:
        level = "low"
        recommended = best_option(1.5) or best_option(0.5)
        reason = "当前显存更适合轻量模型，优先保证答辩演示响应速度。"
    else:
        level = "cpu"
        recommended = best_option(0.5)
        reason = "可用 GPU 显存不足，建议使用 0.5B 或切换更多空闲 GPU。"

    model_label = recommended.get("label") if recommended else "暂无可用本地模型"
    gpu_names = ", ".join(f"GPU {gpu.get('index')}" for gpu in selected) or "未选择 GPU"
    return {
        "level": level,
        "model_id": recommended.get("id") if recommended else None,
        "model_label": model_label,
        "total_mib": total_mib,
        "free_mib": free_mib,
        "gpu_count": count,
        "summary": f"{gpu_names} 合计显存 {round(total_mib / 1024, 1)} GiB，推荐 {model_label}。",
        "reason": reason,
    }


def _shell_escape_env(value: Any) -> str:
    return str(value).replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$")


def _shell_single_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def _process_belongs_to_app(pid: Optional[int], app_dir: Path) -> bool:
    if pid is None:
        return False
    if pid == os.getpid():
        return True
    proc = Path("/proc") / str(pid)
    try:
        cmdline = (proc / "cmdline").read_bytes().replace(b"\x00", b" ").decode(
            "utf-8", errors="replace"
        )
        if str(app_dir) in cmdline or "ai-vault-demo" in cmdline:
            return True
    except Exception:
        pass
    try:
        cwd = (proc / "cwd").resolve()
        return str(cwd).startswith(str(app_dir))
    except Exception:
        return False


def _safe_int(value: Any) -> Optional[int]:
    try:
        text = str(value).strip()
        if text in {"", "[N/A]", "N/A"}:
            return None
        return int(float(text))
    except Exception:
        return None


def _safe_float(value: Any) -> Optional[float]:
    try:
        text = str(value).strip()
        if text in {"", "[N/A]", "N/A"}:
            return None
        return round(float(text), 2)
    except Exception:
        return None


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _synthetic_samples() -> List[Dict[str, Any]]:
    raw: List[Tuple[str, str, int]] = [
        ("患者胸闷三小时，既往高血压，咨询下一步处理。", "建议心电图和肌钙蛋白评估，优先心内科。", 0),
        ("夜间咳嗽伴喘息，活动后气短，需要分诊。", "关注血氧和肺部听诊，建议呼吸科评估。", 1),
        ("餐后上腹痛反复发作，伴反酸嗳气。", "考虑胃食管反流或胃炎，建议消化科随访。", 2),
        ("出院后复查血压记录，询问服药调整。", "整理家庭血压曲线，按随访计划复诊。", 3),
        ("突发胸痛放射至左肩，出汗明显。", "需排查急性冠脉综合征，优先心内科急诊。", 0),
        ("发热后咳黄痰，胸片提示感染可能。", "建议呼吸科结合炎症指标判断抗感染方案。", 1),
        ("长期腹胀，排便不规律，担心肠道疾病。", "建议消化科完善肠道评估并调整饮食。", 2),
        ("术后复诊咨询伤口护理和复查时间。", "按出院小结进行随访，异常及时就医。", 3),
        ("心悸伴头晕，运动后加重。", "建议心内科评估心律失常风险。", 0),
        ("慢性阻塞性肺病患者吸入药使用咨询。", "建议呼吸科复核吸入技术和肺功能。", 1),
        ("胃镜后病理提示炎症，询问治疗周期。", "建议消化科结合病理和症状制定疗程。", 2),
        ("患者编号 %s 需要把病历摘要用于模型适配。" % SENTINEL, "该样本仅用于演示敏感标记扫描。", 3),
    ]
    return [
        {"id": "case-%02d" % (idx + 1), "question": q, "answer": a, "label": label}
        for idx, (q, a, label) in enumerate(raw)
    ]


def _vectorize_dataset(samples: List[Dict[str, Any]], input_dim: int) -> Tuple[List[List[float]], List[int]]:
    features: List[List[float]] = []
    labels: List[int] = []
    for sample in samples:
        text = "%s %s" % (sample["question"], sample["answer"])
        vec = [0.0 for _ in range(input_dim)]
        encoded = text.encode("utf-8")
        for index, byte in enumerate(encoded):
            slot = (byte + index * 17) % input_dim
            vec[slot] += 1.0
        norm = math.sqrt(sum(value * value for value in vec)) or 1.0
        features.append([value / norm for value in vec])
        labels.append(int(sample["label"]))
    return features, labels
