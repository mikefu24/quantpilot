"""X/Twitter 过滤流监听器（Filtered Stream, API v2）。

用官方 filtered stream 长连接实时收推。相比轮询，延迟更低（突发新闻更快）。
需要 Bearer Token（Twitter/X 开发者账号），并预先在账号里配置好 rules（关键词/账号）。

容错要点：
- 长连接会被服务端周期性断开——捕获后自动重连并指数退避。
- 心跳空行/半包：逐行解析，坏行跳过。
若你无法拿到 X API，可直接停用本监听，只用 NewsAPI；二者是并联的。
"""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

try:
    import aiohttp
except ImportError:
    aiohttp = None

from core.logger import get_logger
from core.models import NewsEvent
from listeners.base import BaseListener

log = get_logger("listener.twitter")

STREAM_URL = "https://api.twitter.com/2/tweets/search/stream"


class TwitterListener(BaseListener):
    def __init__(self, bearer_token: str, keywords: list[str] | None = None) -> None:
        super().__init__(keywords)
        self.bearer_token = bearer_token

    async def stream(self) -> AsyncIterator[NewsEvent]:
        if aiohttp is None:
            log.error("未安装 aiohttp，Twitter 监听不可用。")
            return
        if not self.bearer_token:
            log.error("缺少 TWITTER_BEARER_TOKEN，Twitter 监听不启动。")
            return

        headers = {"Authorization": f"Bearer {self.bearer_token}"}
        params = {"tweet.fields": "created_at,lang", "expansions": "author_id"}
        backoff = 1.0

        while True:  # 外层：断线重连
            try:
                timeout = aiohttp.ClientTimeout(total=None, sock_read=90)
                async with aiohttp.ClientSession(headers=headers, timeout=timeout) as session:
                    async with session.get(STREAM_URL, params=params) as resp:
                        if resp.status == 429:
                            backoff = min(backoff * 2, 60)
                            log.warning(f"Twitter 限流(429)，退避 {backoff:.0f}s")
                            await asyncio.sleep(backoff)
                            continue
                        resp.raise_for_status()
                        backoff = 1.0
                        log.info("Twitter filtered stream 已连接。")

                        async for raw_line in resp.content:
                            line = raw_line.decode("utf-8").strip()
                            if not line:  # 心跳
                                continue
                            try:
                                payload = json.loads(line)
                                ev = self._to_event(payload)
                            except Exception as e:
                                log.debug(f"跳过异常推文行：{e}")
                                continue
                            if not self._match_keywords(ev.text):
                                continue
                            if not self.deduper.is_new(ev):
                                continue
                            yield ev

            except asyncio.CancelledError:
                raise
            except Exception as e:
                backoff = min(backoff * 2, 60)
                log.warning(f"Twitter 流断开，{backoff:.0f}s 后重连：{e!r}")
                await asyncio.sleep(backoff)

    @staticmethod
    def _to_event(payload: dict) -> NewsEvent:
        data = payload.get("data", {})
        return NewsEvent(
            source="twitter",
            text=data.get("text", ""),
            author=data.get("author_id", ""),
            raw_id=data.get("id", ""),
            lang=data.get("lang", ""),
            url=f"https://x.com/i/web/status/{data.get('id', '')}",
        )
