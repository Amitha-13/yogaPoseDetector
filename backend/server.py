import asyncio
import csv
import json
import signal
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Set
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from websockets.asyncio.server import ServerConnection, serve
from websockets.exceptions import ConnectionClosed
from zeroconf import IPVersion, ServiceInfo
from zeroconf.asyncio import AsyncZeroconf


MODULE_LABELS = {
    1: "Left Wrist",
    2: "Right Wrist",
    3: "Left Elbow",
    4: "Right Elbow",
    5: "Left Ankle",
    6: "Right Ankle",
    7: "Left Knee",
    8: "Right Knee",
    9: "Upper Back",
    10: "Lower Back",
}

OUTPUT_DIR = Path(__file__).resolve().parent / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def iso_utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sanitize_name(value: str, fallback: str = "participant") -> str:
    cleaned = "".join(ch if ch.isalnum() else "_" for ch in (value or "").strip())
    cleaned = "_".join(part for part in cleaned.split("_") if part)
    return cleaned[:80] if cleaned else fallback


@dataclass
class ModuleConnection:
    connection: ServerConnection
    module_ids: Set[int]


class SessionStartRequest(BaseModel):
    participantId: Optional[str] = None
    participantName: Optional[str] = None
    sessionId: Optional[str] = None


class SessionManager:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self.active: bool = False
        self.participant_id: str = "unknown_participant"
        self.participant_name: str = "participant"
        self.session_id: str = ""
        self.started_at: str = ""
        self.frames: list[dict[str, Any]] = []
        self.frames_seen_modules: Set[int] = set()
        self.last_export: Optional[dict[str, Any]] = None

    async def start(self, payload: SessionStartRequest) -> dict[str, Any]:
        async with self._lock:
            self.active = True
            self.started_at = iso_utc_now()
            self.participant_id = sanitize_name(payload.participantId or "unknown_participant")
            self.participant_name = sanitize_name(payload.participantName or "participant")
            self.session_id = sanitize_name(payload.sessionId or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S"))
            self.frames = []
            self.frames_seen_modules = set()
            self.last_export = None
            return {
                "active": self.active,
                "participantId": self.participant_id,
                "participantName": self.participant_name,
                "sessionId": self.session_id,
                "startedAt": self.started_at,
            }

    async def append_frame(self, frame: dict[str, Any]) -> None:
        async with self._lock:
            if not self.active:
                return
            module_ids = [int(mid) for mid in frame.get("modules", {}).keys()]
            self.frames_seen_modules.update(module_ids)
            self.frames.append(frame)

    async def stop(self) -> dict[str, Any]:
        async with self._lock:
            was_active = self.active
            self.active = False
            if not was_active:
                return {"active": False, "export": self.last_export}
            export = self._export_csv_zip()
            self.last_export = export
            return {"active": False, "export": export}

    def _export_csv_zip(self) -> dict[str, Any]:
        ended_at = iso_utc_now()
        if not self.frames:
            return {
                "status": "empty",
                "participantId": self.participant_id,
                "sessionId": self.session_id,
                "startedAt": self.started_at,
                "endedAt": ended_at,
                "frameCount": 0,
            }

        module_ids = sorted(self.frames_seen_modules)
        header = ["timestamp"]
        for mid in module_ids:
            header.extend([f"m{mid}_qr", f"m{mid}_qi", f"m{mid}_qj", f"m{mid}_qk", f"m{mid}_v", f"m{mid}_soc", f"m{mid}_rssi"])

        base_name = f"{self.participant_name}_{self.participant_id}_{self.session_id}"
        csv_path = OUTPUT_DIR / f"{base_name}.csv"
        zip_path = OUTPUT_DIR / f"{base_name}.zip"

        with csv_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(header)
            for frame in self.frames:
                row = [frame.get("timestamp", iso_utc_now())]
                modules = frame.get("modules", {})
                for mid in module_ids:
                    module = modules.get(str(mid)) or {}
                    row.extend(
                        [
                            module.get("qr"),
                            module.get("qi"),
                            module.get("qj"),
                            module.get("qk"),
                            module.get("v"),
                            module.get("soc"),
                            module.get("rssi"),
                        ]
                    )
                writer.writerow(row)

        with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zf:
            zf.write(csv_path, arcname=csv_path.name)

        return {
            "status": "ready",
            "participantId": self.participant_id,
            "participantName": self.participant_name,
            "sessionId": self.session_id,
            "startedAt": self.started_at,
            "endedAt": ended_at,
            "frameCount": len(self.frames),
            "moduleIds": module_ids,
            "csvPath": str(csv_path),
            "zipPath": str(zip_path),
            "zipFileName": zip_path.name,
        }


class YogaHardwareBridge:
    def __init__(self) -> None:
        self.state_lock = asyncio.Lock()
        self.module_state: Dict[int, dict[str, Any]] = {}
        self.connection_to_modules: Dict[ServerConnection, ModuleConnection] = {}
        self.ui_clients: Set[WebSocket] = set()
        self.session = SessionManager()
        self.aggregate_task: Optional[asyncio.Task] = None

    async def register_ui_client(self, ws: WebSocket) -> None:
        self.ui_clients.add(ws)
        await self.send_status(ws)

    def unregister_ui_client(self, ws: WebSocket) -> None:
        self.ui_clients.discard(ws)

    async def _broadcast_ui(self, payload: dict[str, Any]) -> None:
        stale: list[WebSocket] = []
        for ws in self.ui_clients:
            try:
                await ws.send_json(payload)
            except Exception:
                stale.append(ws)
        for ws in stale:
            self.ui_clients.discard(ws)

    async def handle_imu_connection(self, websocket: ServerConnection) -> None:
        module_conn = ModuleConnection(connection=websocket, module_ids=set())
        async with self.state_lock:
            self.connection_to_modules[websocket] = module_conn
        try:
            async for message in websocket:
                await self._handle_imu_packet(websocket, message)
        except ConnectionClosed:
            pass
        finally:
            await self._cleanup_disconnected_connection(websocket)

    async def _handle_imu_packet(self, websocket: ServerConnection, message: str) -> None:
        try:
            packet = json.loads(message)
        except json.JSONDecodeError:
            return
        if not isinstance(packet, dict):
            return
        if "id" not in packet:
            return
        try:
            module_id = int(packet["id"])
        except (TypeError, ValueError):
            return

        normalized = {
            "id": module_id,
            "ts": packet.get("ts"),
            "qr": packet.get("qr"),
            "qi": packet.get("qi"),
            "qj": packet.get("qj"),
            "qk": packet.get("qk"),
            "v": packet.get("v"),
            "soc": packet.get("soc"),
            "rssi": packet.get("rssi"),
            "updatedAt": iso_utc_now(),
            "bodyPart": MODULE_LABELS.get(module_id, f"Module {module_id}"),
        }

        async with self.state_lock:
            self.module_state[module_id] = normalized
            conn = self.connection_to_modules.get(websocket)
            if conn:
                conn.module_ids.add(module_id)

    async def _cleanup_disconnected_connection(self, websocket: ServerConnection) -> None:
        async with self.state_lock:
            conn = self.connection_to_modules.pop(websocket, None)
            if not conn:
                return
            for module_id in conn.module_ids:
                self.module_state.pop(module_id, None)
        await self._broadcast_ui_status()

    async def _snapshot_modules(self) -> Dict[str, Any]:
        async with self.state_lock:
            modules = {
                str(mid): data
                for mid, data in sorted(self.module_state.items(), key=lambda x: x[0])
            }
        return modules

    async def _broadcast_ui_status(self) -> None:
        modules = await self._snapshot_modules()
        payload = {
            "type": "status",
            "timestamp": iso_utc_now(),
            "moduleCount": len(modules),
            "modules": modules,
            "sessionActive": self.session.active,
        }
        await self._broadcast_ui(payload)

    async def send_status(self, ws: WebSocket) -> None:
        modules = await self._snapshot_modules()
        await ws.send_json(
            {
                "type": "status",
                "timestamp": iso_utc_now(),
                "moduleCount": len(modules),
                "modules": modules,
                "sessionActive": self.session.active,
            }
        )

    async def start_aggregation_loop(self) -> None:
        while True:
            modules = await self._snapshot_modules()
            frame = {
                "type": "frame",
                "timestamp": iso_utc_now(),
                "modules": modules,
            }
            await self.session.append_frame(frame)
            await self._broadcast_ui(frame)
            await self._broadcast_ui_status()
            await asyncio.sleep(0.05)


bridge = YogaHardwareBridge()
api = FastAPI(title="Yoga Hardware Backend")
api.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@api.get("/health")
async def health() -> dict[str, Any]:
    modules = await bridge._snapshot_modules()
    return {
        "ok": True,
        "moduleCount": len(modules),
        "sessionActive": bridge.session.active,
    }


@api.get("/status")
async def status() -> dict[str, Any]:
    modules = await bridge._snapshot_modules()
    return {
        "moduleCount": len(modules),
        "modules": modules,
        "sessionActive": bridge.session.active,
        "lastExport": bridge.session.last_export,
    }


@api.post("/session/start")
async def session_start(payload: SessionStartRequest) -> dict[str, Any]:
    info = await bridge.session.start(payload)
    await bridge._broadcast_ui({"type": "session_started", **info})
    return {"ok": True, **info}


@api.post("/session/stop")
async def session_stop() -> dict[str, Any]:
    result = await bridge.session.stop()
    await bridge._broadcast_ui({"type": "session_stopped", **result})
    if result.get("export", {}).get("status") == "ready":
        await bridge._broadcast_ui({"type": "session_ready", **result["export"]})
    return {"ok": True, **result}


@api.websocket("/ws")
async def websocket_ui(ws: WebSocket) -> None:
    await ws.accept()
    await bridge.register_ui_client(ws)
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "ping":
                await ws.send_json({"type": "pong", "timestamp": iso_utc_now()})
            elif msg.get("type") == "start_session":
                payload = SessionStartRequest(
                    participantId=msg.get("participantId"),
                    participantName=msg.get("participantName"),
                    sessionId=msg.get("sessionId"),
                )
                info = await bridge.session.start(payload)
                await bridge._broadcast_ui({"type": "session_started", **info})
            elif msg.get("type") == "stop_session":
                result = await bridge.session.stop()
                await bridge._broadcast_ui({"type": "session_stopped", **result})
                if result.get("export", {}).get("status") == "ready":
                    await bridge._broadcast_ui({"type": "session_ready", **result["export"]})
    except WebSocketDisconnect:
        bridge.unregister_ui_client(ws)
    except Exception:
        bridge.unregister_ui_client(ws)


async def start_mdns() -> tuple[AsyncZeroconf, ServiceInfo]:
    zc = AsyncZeroconf(ip_version=IPVersion.V4Only)
    hostname = "yoga-server.local."
    info = ServiceInfo(
        type_="_ws._tcp.local.",
        name="yoga-server._ws._tcp.local.",
        addresses=[b"\x7f\x00\x00\x01"],
        port=5000,
        properties={"path": "/imu", "service": "yoga-imu-ingest"},
        server=hostname,
    )
    await zc.async_register_service(info)
    return zc, info


async def run_api_server() -> None:
    import uvicorn

    config = uvicorn.Config(api, host="0.0.0.0", port=5001, log_level="info")
    server = uvicorn.Server(config)
    await server.serve()


async def run_imu_server() -> None:
    async def handler(ws: ServerConnection) -> None:
        if ws.request.path != "/imu":
            await ws.close(code=1008, reason="Invalid path")
            return
        await bridge.handle_imu_connection(ws)

    async with serve(handler, host="0.0.0.0", port=5000):
        await asyncio.Future()


async def main() -> None:
    zc, info = await start_mdns()
    stop_event = asyncio.Event()

    def _request_stop() -> None:
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, _request_stop)

    imu_task = asyncio.create_task(run_imu_server(), name="imu-server")
    api_task = asyncio.create_task(run_api_server(), name="api-server")
    bridge.aggregate_task = asyncio.create_task(bridge.start_aggregation_loop(), name="aggregate-loop")

    await stop_event.wait()

    for task in (imu_task, api_task, bridge.aggregate_task):
        if task:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    await zc.async_unregister_service(info)
    await zc.async_close()


if __name__ == "__main__":
    asyncio.run(main())
