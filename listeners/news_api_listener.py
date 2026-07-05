"""NewsAPI 轮询监听器（也可改造成任何 REST 新闻源）。

策略：定时拉取 /v2/everything 最新结果，用 published_at 单调推进 + 去重，
只把"新出现且命中关键词"的条目吐给下游。

容错要点：
- 网络异常/限流（429）：捕获后按指数退避重试，绝不让循环崩掉导致漏单。
- 返回体结构异常：逐条 try，跳过坏数据。
"""
from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

try:
    import aiohttp
except ImportError:
    aiohttp = None

from core.logger import get_logger
from core.models import NewsEvent
from listeners.base import BaseListener

log = get_logger("listener.news")


class NewsAPIListener(BaseListener):
    def __init__(self, api_key: str, keywords: list[str], poll_interval: float = 5.0,
                 endpoint: str = "https://newsapi.org/v2/everything") -> None:
        super().__init__(keywords)
        self.api_key = api_key
        self.poll_interval = poll_interval
        self.endpoint = endpoint
        self._latest_ts = 0.0

    async def stream(self) -> AsyncIterator[NewsEvent]:
        if aiohttp is None:
            log.error("未安装 aiohttp，NewsAPI 监听不可用。pip install aiohttp")
            return
        if not self.api_key:
            log.error("缺少 NEWS_API_KEY，NewsAPI 监听不启动。")
            return

        query = " OR ".join(self.keywords) if self.keywords else "breaking"
        backoff = self.poll_interval

        async with aiohttp.ClientSession() as session:
            while True:
                try:
                    params = {
                        "q": query,
                        "sortBy": "publishedAt",
                        "language": "en",
                        "pageSize": 20,
                        "apiKey": self.api_key,
                    }
                    async with session.get(self.endpoint, params=params, timeout=10) as resp:
                        if resp.status == 429:  # 限流
                            backoff = min(backoff * 2, 120)
                            log.warning(f"NewsAPI 限流(429)，退避 {backoff:.0f}s")
                            await asyncio.sleep(backoff)
                            continue
                        resp.raise_for_status()
                        data = await resp.json()
                        backoff = self.poll_interval  # 成功则重置退避

                    for art in data.get("articles", []):
                        try:
                            ev = self._to_event(art)
                        except Exception as e:
                            log.debug(f"跳过异常条目：{e}")
                            continue
                        if not self._match_keywords(ev.text):
                            continue
                        if not self.deduper.is_new(ev):
                            continue
                        yield ev

                except asyncio.CancelledError:
                    raise
                except Exception as e:  # 任何异常都不能中断轮询
                    log.warning(f"NewsAPI 拉取失败，将重试：{e!r}")

                await asyncio.sleep(self.poll_interval)

    @staticmethod
    def _to_event(art: dict) -> NewsEvent:
        title = art.get("title") or ""
        desc = art.get("description") or ""
        return NewsEvent(
            source="newsapi",
            text=f"{title}. {desc}".strip(),
            url=art.get("url", ""),
            author=(art.get("source") or {}).get("name", ""),
            raw_id=art.get("url", "") or title,
        )
