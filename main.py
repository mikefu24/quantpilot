"""事件侦听 → AI 决策 → 自动执行 主循环。

管线：
  [多个监听器并联] → NewsEvent 队列
        → 拉取目标市场实时盘口(MarketQuote)
        → AI 决策引擎(Decision)
        → 风控/滑点(Order 或 拒单)
        → Polymarket 执行(默认 DRY_RUN 空跑)

设计原则：
- 全异步，监听不阻塞决策。
- 每一步都 try-except，单条新闻处理失败不影响整体运行（不漏后续单）。
- 默认空跑：没有显式 LIVE_TRADING=true，绝不真实下单。
"""
from __future__ import annotations

import asyncio

from core.config import AppConfig
from core.logger import get_logger
from core.models import Action, MarketQuote, NewsEvent
from decision.ai_engine import AIDecisionEngine
from decision.providers import build_provider
from execution.polymarket import PolymarketExecutor
from listeners.news_api_listener import NewsAPIListener
from listeners.twitter_listener import TwitterListener
from risk.slippage import RiskManager

log = get_logger("main")


class TradingBot:
    def __init__(self, cfg: AppConfig) -> None:
        self.cfg = cfg
        self.queue: asyncio.Queue[NewsEvent] = asyncio.Queue(maxsize=1000)

        # —— 决策引擎（provider 可换）——
        provider = build_provider(cfg.llm_provider, cfg.llm_api_key, cfg.llm_model, cfg.llm_base_url)
        self.engine = AIDecisionEngine(
            provider=provider,
            market_desc=cfg.target_market_id or "（未配置目标市场描述）",
            min_edge=cfg.risk.min_edge,
            min_confidence=cfg.risk.min_confidence,
        )

        self.risk = RiskManager(cfg.risk)
        self.executor = PolymarketExecutor(cfg)

        # 目标市场的 token id（真实使用时从 Polymarket 市场页/Gamma API 获取后填入）
        self.yes_token_id = ""
        self.no_token_id = ""
        # DRY_RUN 下若没接 CLOB，可用一个占位盘口让全链路跑通演示
        self._demo_quote = MarketQuote(
            market_id=cfg.target_market_id or "demo-market",
            yes_token_id="YES_TOKEN", no_token_id="NO_TOKEN",
            yes_bid=0.40, yes_ask=0.42, no_bid=0.58, no_ask=0.60,
            yes_ask_depth={0.42: 300.0, 0.43: 500.0, 0.44: 800.0},
        )

    # —— 监听协程：把各源新闻塞进队列 ——
    async def _run_listener(self, listener) -> None:
        try:
            async for ev in listener.stream():
                try:
                    self.queue.put_nowait(ev)
                except asyncio.QueueFull:
                    log.warning("新闻队列已满，丢弃最旧策略——跳过本条以防积压。")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.error(f"监听器异常退出：{e!r}")

    # —— 消费协程：决策 + 风控 + 执行 ——
    async def _consume(self) -> None:
        while True:
            ev = await self.queue.get()
            try:
                await self._handle_event(ev)
            except Exception as e:   # 单条失败不影响后续
                log.error(f"处理新闻异常：{e!r}")
            finally:
                self.queue.task_done()

    async def _handle_event(self, ev: NewsEvent) -> None:
        log.info(f"📥 新闻[{ev.source}] {ev.text[:80]}")

        # 1) 拉实时盘口（同步调用放到线程，避免阻塞事件循环）
        quote = await asyncio.to_thread(
            self.executor.fetch_quote, self._demo_quote,
            self.yes_token_id, self.no_token_id,
            self.cfg.target_market_id or "demo-market",
        )
        if quote is None:
            log.warning("盘口不可用，跳过本条（不误下单）。")
            return

        # 2) AI 决策
        decision = await asyncio.to_thread(self.engine.evaluate, ev, quote)
        log.info(f"🤖 决策 {decision.action.value} | 概率{decision.prob_estimate:.2f} "
                 f"置信{decision.confidence:.2f} edge{decision.edge:+.3f} | {decision.reason}")

        if decision.action in (Action.HOLD, Action.ABSTAIN, Action.SELL):
            return

        # 3) 风控/滑点 → Order
        order = self.risk.build_order(decision, quote)
        if order is None:
            return

        # 4) 执行（默认空跑）
        report = await asyncio.to_thread(self.executor.place_order, order)
        if report.ok and not report.dry_run:
            filled_usd = report.filled_size * report.avg_price
            if self.risk.verify_fill_price(order.limit_price, report.avg_price):
                self.risk.on_filled(order, filled_usd)

    async def run(self) -> None:
        listeners = []
        if self.cfg.news_api_key:
            listeners.append(NewsAPIListener(self.cfg.news_api_key, self.cfg.watch_keywords,
                                             self.cfg.poll_interval_sec))
        if self.cfg.twitter_bearer_token:
            listeners.append(TwitterListener(self.cfg.twitter_bearer_token, self.cfg.watch_keywords))

        if not listeners:
            log.warning("未配置任何监听源（NEWS_API_KEY / TWITTER_BEARER_TOKEN），"
                        "将只启动消费循环用于演示。")

        mode = "DRY_RUN 空跑" if self.cfg.dry_run else "⚠️ LIVE 真实交易"
        log.info(f"启动交易机器人 | 模式：{mode} | provider：{self.cfg.llm_provider}")

        tasks = [asyncio.create_task(self._run_listener(l)) for l in listeners]
        tasks.append(asyncio.create_task(self._consume()))
        try:
            await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            pass


def main() -> None:
    cfg = AppConfig.load()
    bot = TradingBot(cfg)
    try:
        asyncio.run(bot.run())
    except KeyboardInterrupt:
        log.info("收到中断，退出。")


if __name__ == "__main__":
    main()
