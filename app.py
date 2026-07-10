from __future__ import annotations

from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from vault_demo.engine import DemoEngine


APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"

engine = DemoEngine(APP_DIR)
app = FastAPI(title="AI 数据保险箱 Demo", version="1.0.0")
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class DemoRunRequest(BaseModel):
    document_ids: List[str] = []


class DocumentUploadRequest(BaseModel):
    filename: str
    content: str


class ModelAskRequest(BaseModel):
    question: str
    document_ids: List[str] = []
    mode: str = "vault"


class RuntimeApplyRequest(BaseModel):
    gpu_ids: List[int]
    model_id: str
    device_map: str = "auto"


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/styles.css")
def root_styles() -> FileResponse:
    return FileResponse(STATIC_DIR / "styles.css")


@app.get("/app.js")
def root_app_js() -> FileResponse:
    return FileResponse(STATIC_DIR / "app.js")


@app.get("/api/hardware")
def hardware():
    return engine.get_hardware()


@app.get("/api/model/status")
def model_status():
    return engine.get_model_status()


@app.get("/api/runtime/config")
def runtime_config():
    return engine.get_runtime_config()


@app.post("/api/runtime/apply")
def apply_runtime_config(payload: RuntimeApplyRequest):
    try:
        return engine.apply_runtime_config(payload.gpu_ids, payload.model_id, payload.device_map)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.get("/api/documents")
def documents():
    return {"documents": engine.list_documents()}


@app.post("/api/documents")
def upload_document(payload: DocumentUploadRequest):
    try:
        return engine.save_document(payload.filename, payload.content)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/api/documents/{document_id}")
def delete_document(document_id: str):
    try:
        return engine.delete_document(document_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="document not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/model/ask")
def ask_model(payload: ModelAskRequest):
    try:
        return engine.ask_model(payload.question, payload.document_ids, payload.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/demo/baseline")
def run_baseline(payload: Optional[DemoRunRequest] = None):
    return engine.start_run("baseline", (payload.document_ids if payload else []))


@app.post("/api/demo/vault")
def run_vault(payload: Optional[DemoRunRequest] = None):
    return engine.start_run("vault", (payload.document_ids if payload else []))


@app.get("/api/demo/{run_id}/events")
def run_events(run_id: str):
    try:
        return engine.get_events(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="run_id not found")


@app.get("/api/demo/{run_id}/report")
def run_report(run_id: str):
    try:
        return engine.get_report(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="report not ready")


@app.post("/api/demo/{run_id}/verify")
def verify_run(run_id: str):
    try:
        return engine.verify_run(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="report not ready")


@app.get("/api/demo/latest-report")
def latest_report():
    report = engine.get_latest_report()
    if report is None:
        return {"status": "empty"}
    return report


@app.get("/api/demo/latest-reports")
def latest_reports():
    return engine.get_latest_reports_by_mode()
