"""
WebSocket hub — multi-tenant real-time connection manager.
Subscribes to Redis Pub/Sub channels and broadcasts to tenant clients.
"""
import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, status as http_status
from redis.asyncio import Redis

from app.core.redis import get_redis
from app.core.security import decode_token

logger = logging.getLogger(__name__)
router = APIRouter(tags=["WebSocket"])

HEARTBEAT_INTERVAL = 30  # seconds


class TenantHub:
    """
    Manages WebSocket connections grouped by tenant_id.
    Subscribes to Redis Pub/Sub pattern 'pubsub:tenant:*' and broadcasts
    incoming messages to all live connections in the matching tenant pool.
    """

    def __init__(self):
        # tenant_id → set of active WebSocket connections
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._pubsub_task: asyncio.Task | None = None

    async def connect(self, websocket: WebSocket, tenant_id: str) -> None:
        await websocket.accept()
        self._connections[tenant_id].add(websocket)
        logger.info("WS connected tenant=%s total=%d", tenant_id, len(self._connections[tenant_id]))

    async def disconnect(self, websocket: WebSocket, tenant_id: str) -> None:
        self._connections[tenant_id].discard(websocket)
        logger.info("WS disconnected tenant=%s remaining=%d", tenant_id, len(self._connections[tenant_id]))

    async def broadcast(self, tenant_id: str, payload: Any) -> None:
        message = json.dumps(payload) if not isinstance(payload, str) else payload
        dead: set[WebSocket] = set()
        for ws in self._connections.get(tenant_id, set()):
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self._connections[tenant_id].discard(ws)

    async def start_redis_listener(self, redis: Redis) -> None:
        """
        Long-running coroutine that subscribes to all tenant Pub/Sub channels
        and dispatches messages to the correct tenant connection pool.
        """
        pubsub = redis.pubsub()
        await pubsub.psubscribe("pubsub:tenant:*")
        logger.info("Redis Pub/Sub listener started on pattern pubsub:tenant:*")

        async for message in pubsub.listen():
            if message["type"] not in ("pmessage", "message"):
                continue
            channel: bytes = message.get("channel") or message.get("pattern", b"")
            if isinstance(channel, bytes):
                channel = channel.decode()
            # Extract tenant_id from channel name
            # Channel format: pubsub:tenant:{tenant_id}
            parts = channel.rsplit(":", 1)
            tenant_id = parts[-1] if len(parts) == 2 else None
            if not tenant_id:
                continue
            data = message["data"]
            if isinstance(data, bytes):
                data = data.decode()
            await self.broadcast(tenant_id, data)


# Singleton hub instance
hub = TenantHub()


@router.websocket("/ws")
async def websocket_endpoint(
    websocket: WebSocket,
    redis: Redis = Depends(get_redis),
):
    # 1. Authenticate via JWT token in query parameter
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing authentication token")
        return

    try:
        claims = decode_token(token)
    except Exception:
        await websocket.close(code=4001, reason="Invalid or expired token")
        return

    tenant_id: str = claims.get("tenant_id", "")
    if not tenant_id:
        await websocket.close(code=4002, reason="Token missing tenant_id")
        return

    await hub.connect(websocket, tenant_id)

    # 2. Send initial connection acknowledgement
    await websocket.send_json({
        "type": "connection.established",
        "tenant_id": tenant_id,
        "message": "Connected to fleet update channel",
    })

    try:
        while True:
            # Heartbeat: wait for ping from client or timeout
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=HEARTBEAT_INTERVAL * 2)
                if data.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except asyncio.TimeoutError:
                # Client silent for too long — close connection
                await websocket.close(code=1001, reason="Client timeout")
                break
    except WebSocketDisconnect:
        pass
    finally:
        await hub.disconnect(websocket, tenant_id)
