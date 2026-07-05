"""滑点控制与流动性风控。

这是防止"流动性不足被恶意插针"的核心。下单前必须过这一关：
1. 价差过宽 → 市场太薄，拒单。
2. 目标价位内的盘口深度不足 → 拒单或缩量。
3. 用限价（而非无脑市价）+ 最大可接受成交均价，把滑点钉死在阈值内。
4. 名义敞口/单笔金额上限、冷却时间，防连环误触发。
"""
from __future__ import annotations

import time

from core.logger import get_logger
from core.config import RiskConfig
from core.models import Action, Decision, MarketQuote, Order, Side

log = get_logger("risk")


class RiskManager:
    def __init__(self, cfg: RiskConfig) -> None:
        self.cfg = cfg
        self._last_order_ts: dict[str, float] = {}   # market_id -> 上次下单时间
        self._position_usd: dict[str, float] = {}     # market_id -> 当前名义敞口

    # —————— 对外主接口 ——————
    def build_order(self, decision: Decision, quote: MarketQuote) -> Order | None:
        """把 Decision 转成经过风控约束的 Order；不通过则返回 None（不下单）。"""
        if decision.action not in (Action.BUY_YES, Action.BUY_NO):
            return None

        mid = quote.market_id

        # 1) 冷却时间
        now = time.time()
        last = self._last_order_ts.get(mid, 0.0)
        if now - last < self.cfg.cooldown_sec:
            log.info(f"[{mid}] 处于冷却期（{self.cfg.cooldown_sec:.0f}s），跳过。")
            return None

        # 2) 价差 / 流动性
        if quote.spread > self.cfg.max_spread:
            log.warning(f"[{mid}] 价差 {quote.spread:.3f} > 上限 {self.cfg.max_spread}，流动性不足，拒单。")
            return None

        # 选择方向对应的 token、参考价、深度
        if decision.action == Action.BUY_YES:
            token_id = quote.yes_token_id
            ref_ask = quote.yes_ask
            depth = quote.yes_ask_depth
        else:  # BUY_NO
            token_id = quote.no_token_id
            ref_ask = quote.no_ask
            depth = {}   # 若未提供 NO 深度，则退化为只用价差+价保护

        if ref_ask <= 0 or ref_ask >= 1:
            log.warning(f"[{mid}] 参考价异常 {ref_ask}，拒单。")
            return None

        # 3) 限价 = 参考卖价 + 允许滑点，作为"最差可接受成交价"，把滑点钉死
        limit_price = round(min(ref_ask + self.cfg.max_slippage, 0.999), 3)

        # 4) 目标金额（受单笔上限 + 剩余敞口额度双重约束）
        target_usd = min(self.cfg.max_order_usd, decision.target_size_usd or self.cfg.max_order_usd)
        remaining = self.cfg.max_position_usd - self._position_usd.get(mid, 0.0)
        if remaining <= 1e-6:
            log.warning(f"[{mid}] 已达最大敞口 {self.cfg.max_position_usd}，拒单。")
            return None
        target_usd = min(target_usd, remaining)

        # 份额 = 金额 / 限价
        size = round(target_usd / limit_price, 2)

        # 5) 深度校验：目标限价内可成交份额是否足够（防插针）
        if depth:
            fillable = sum(q for px, q in depth.items() if px <= limit_price)
            if fillable < self.cfg.min_depth_shares:
                log.warning(f"[{mid}] 限价内可成交深度 {fillable:.1f} < 下限 "
                            f"{self.cfg.min_depth_shares}，疑似薄盘/插针，拒单。")
                return None
            # 不超过实际深度，避免吃穿盘口造成大滑点
            size = min(size, round(fillable, 2))

        if size <= 0:
            return None

        return Order(
            market_id=mid,
            token_id=token_id,
            side=Side.BUY,
            size=size,
            limit_price=limit_price,
            order_type="GTC",           # 限价挂单；若要立即成交可在执行层改 FOK
            client_id=f"{mid}-{int(now)}",
        )

    def on_filled(self, order: Order, filled_usd: float) -> None:
        """成交回报后更新敞口与冷却时间。"""
        self._position_usd[order.market_id] = self._position_usd.get(order.market_id, 0.0) + filled_usd
        self._last_order_ts[order.market_id] = time.time()

    def verify_fill_price(self, expected_limit: float, avg_price: float) -> bool:
        """成交后复核：实际均价不得劣于限价太多（二次防线）。"""
        if avg_price <= 0:
            return False
        if avg_price > expected_limit + 1e-6:
            log.error(f"实际成交均价 {avg_price:.3f} 劣于限价 {expected_limit:.3f}，触发滑点告警！")
            return False
        return True
