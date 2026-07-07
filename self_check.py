from __future__ import annotations

import json
import time
from pathlib import Path

from vault_demo.engine import DemoEngine


def wait_for_report(engine: DemoEngine, run_id: str):
    deadline = time.time() + 90
    while time.time() < deadline:
        events = engine.get_events(run_id)
        if events["status"] in {"completed", "failed"}:
            return engine.get_report(run_id)
        time.sleep(0.25)
    raise TimeoutError("run timed out: %s" % run_id)


def main() -> int:
    engine = DemoEngine(Path(__file__).resolve().parent)
    baseline = engine.start_run("baseline")
    baseline_report = wait_for_report(engine, baseline["run_id"])
    vault = engine.start_run("vault")
    vault_report = wait_for_report(engine, vault["run_id"])

    checks = {
        "baseline_detects_plaintext": bool(
            baseline_report["sentinel"]["host_plaintext_found"]
        ),
        "vault_blocks_plaintext": not bool(vault_report["sentinel"]["host_plaintext_found"]),
        "vault_wrong_key_fails": bool(
            vault_report["cache_encryption"]["wrong_key_decrypt_failed"]
        ),
        "vault_adapter_exists": Path(vault_report["training"]["adapter_path"]).exists(),
    }
    print(json.dumps({"checks": checks, "vault_run_id": vault["run_id"]}, ensure_ascii=False, indent=2))
    return 0 if all(checks.values()) else 1


if __name__ == "__main__":
    raise SystemExit(main())

