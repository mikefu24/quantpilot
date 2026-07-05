"""监听器基类 + 去重。

所有数据源（NewsAPI、Twitter、RSS…）都产出统一的 NewsEvent 异步流。
用 async generator 让上层能 `async for ev in listener.stream(): ...`。
"""
from __future__ import annotations

import abc
import collections
from collections.abc import AsyncIterator

from core.models import NewsEvent


class Deduper:
    """基于滑动窗口的去重，避免同一条新闻反复触发下单。"""

    def __init__(self, maxlen: int = 5000) -> None:
        self._seen: collections.deque[str] = collections.deque(maxlen=maxlen)
        self._set: set[str] = set()

    def is_new(self, ev: NewsEvent) -> bool:
        key = ev.dedup_key()
        if key in self._set:
            return False
        if len(self._seen) >= self._seen.maxlen:
            old = self._seen.popleft()
            self._set.discard(old)
        self._seen.append(key)
        self._set.add(key)
        return True


class BaseListener(abc.ABC):
    """监听器抽象基类。子类实现 stream()。"""

    def __init__(self, keywords: list[str] | None = None) -> None:
        self.keywords = [k.lower() for k in (keywords or [])]
        self.deduper = Deduper()

    def _match_keywords(self, text: str) -> bool:
        """无关键词=全放行；否则命中任一关键词才放行，减少无关噪音。"""
        if not self.keywords:
            return True
        low = text.lower()
        return any(k in low for k in self.keywords)

    @abc.abstractmethod
    def stream(self) -> AsyncIterator[NewsEvent]:
        """产出 NewsEvent 的异步流。子类实现。"""
        raise NotImplementedError
