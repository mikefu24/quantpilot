"""Polymarket 执行接口（官方 CLOB API 封装）。

底层用官方 py-clob-client：`pip install py-clob-client`。
Polymarket 是链上 CLOB：订单在链下撮合、链上（Polygon）结算，
下单需要用你的钱包私钥对订单做 EIP-712 签名。资金是 Polygon 上的 USDC。

本模块职责：
1. 拉取目标市场实时盘口 → MarketQuote（供决策与风控用）。
2. 把风控产出的 Order 真正发出去（限价/市价），带滑点保护与重试。
3. 默认 DRY_RUN：只打印将要下的单，不真实发送。只有 LIVE_TRADING=true 才真下。

⚠️ 安全：私钥仅从环境变量读取，绝不落盘。真实交易前请在小额、测试市场充分验证。
本代码为骨架，字段名/方法名以你安装的 py-clob-client 版本为准，可能需微调。
"""
from __future__ import annotations

from core.logger import get_logger
from core.config import AppConfig
from core.models import ExecReport, MarketQuote, Order

log = get_logger("exec.poly")


class PolymarketExecutor:
    def __init__(self, cfg: AppConfig) -> None:
        self.cfg = cfg
        self.dry_run = cfg.dry_run
        self.client = None
        if not self.dry_run:
            self._init_client()
        else:
            log.warning("Polymarket 执行器处于 DRY_RUN（空跑）模式，不会真实下单。")

    def _init_client(self) -> None:
        """初始化 CLOB 客户端。真实下单模式才会走到这里。"""
        try:
            from py_clob_client.client import ClobClient
            from py_clob_client.clob_types import ApiCreds

            creds = None
            if self.cfg.poly_api_key:
                creds = ApiCreds(
                    api_key=self.cfg.poly_api_key,
                    api_secret=self.cfg.poly_api_secret,
                    api_passphrase=self.cfg.poly_api_passphrase,
                )
            # signature_type / funder 视你的登录方式（EOA 私钥 or 代理钱包）而定
            self.client = ClobClient(
                host=self.cfg.poly_clob_url,
                key=self.cfg.poly_private_key,     # Polygon 钱包私钥
                chain_id=137,                      # Polygon 主网
                creds=creds,
                funder=self.cfg.poly_funder or None,
            )
            # 若没有 L2 creds，可现场派生：self.client.set_api_creds(self.client.create_or_derive_api_creds())
            if creds is None:
                self.client.set_api_creds(self.client.create_or_derive_api_creds())
            log.info("Polymarket CLOB 客户端已初始化。")
        except Exception as e:
            log.error(f"CLOB 客户端初始化失败，强制切回 DRY_RUN：{e!r}")
            self.dry_run = True
            self.client = None

    # ————— 行情 —————
    def fetch_quote(self, market: MarketQuote | None, yes_token_id: str,
                    no_token_id: str, market_id: str) -> MarketQuote | None:
        """拉取实时盘口。失败返回 None（上层据此跳过本轮，不误下单）。"""
        if self.client is None:
            # DRY_RUN 且未接客户端时，若外部已注入了一个 market 快照就直接用
            return market
        try:
            yes_book = self.client.get_order_book(yes_token_id)
            no_book = self.client.get_order_book(no_token_id)

            yes_bid, yes_ask, yes_ask_depth = self._top_of_book(yes_book)
            no_bid, no_ask, _ = self._top_of_book(no_book)

            return MarketQuote(
                market_id=market_id,
                yes_token_id=yes_token_id,
                no_token_id=no_token_id,
                yes_bid=yes_bid, yes_ask=yes_ask,
                no_bid=no_bid, no_ask=no_ask,
                yes_ask_depth=yes_ask_depth,
            )
        except Exception as e:
            log.warning(f"拉取盘口失败：{e!r}")
            return None

    @staticmethod
    def _top_of_book(book) -> tuple[float, float, dict[float, float]]:
        """从订单簿对象解析最优买卖价 + 卖侧深度字典。

        py-clob-client 的 book 通常有 .bids / .asks，元素含 price/size。
        用 getattr 兜底不同版本命名差异。
        """
        bids = getattr(book, "bids", []) or []
        asks = getattr(book, "asks", []) or []

        def _p(x):
            return float(getattr(x, "price", getattr(x, "0", 0)) if not isinstance(x, dict) else x.get("price", 0))

        def _s(x):
            return float(getattr(x, "size", 0) if not isinstance(x, dict) else x.get("size", 0))

        best_bid = max((_p(b) for b in bids), default=0.0)
        best_ask = min((_p(a) for a in asks), default=1.0)
        ask_depth = {round(_p(a), 3): _s(a) for a in asks}
        return best_bid, best_ask, ask_depth

    # ————— 下单 —————
    def place_order(self, order: Order) -> ExecReport:
        """发送订单。DRY_RUN 只打印；LIVE 真实签名并提交，带重试。"""
        human = (f"[下单] {order.side.value} token={order.token_id[:10]}… "
                 f"size={order.size} limit={order.limit_price} type={order.order_type}")

        if self.dry_run or self.client is None:
            log.info(f"DRY_RUN ▶ 将要发送：{human}（未真实下单）")
            return ExecReport(ok=True, order_id="dry-run", filled_size=0.0,
                              avg_price=order.limit_price, message="dry-run", dry_run=True)

        for attempt in range(3):  # 网络抖动重试，防漏单
            try:
                from py_clob_client.clob_types import OrderArgs
                from py_clob_client.order_builder.constants import BUY, SELL

                args = OrderArgs(
                    token_id=order.token_id,
                    price=order.limit_price,       # 限价即滑点上限
                    size=order.size,
                    side=BUY if order.side.value == "BUY" else SELL,
                )
                signed = self.client.create_order(args)
                # GTC=挂限价单；FOK=立即全成或取消（更接近"市价+滑点保护"）
                resp = self.client.post_order(signed, order.order_type)

                oid = str(resp.get("orderID") or resp.get("orderId") or "")
                log.info(f"LIVE ✔ 已提交订单 {oid}：{human}")
                return ExecReport(ok=True, order_id=oid, filled_size=order.size,
                                  avg_price=order.limit_price, message="submitted", dry_run=False)
            except Exception as e:
                log.warning(f"下单失败（第{attempt + 1}次）：{e!r}")

        log.error(f"下单三次均失败，放弃：{human}")
        return ExecReport(ok=False, message="submit failed after retries", dry_run=False)

    def cancel_all(self, market_id: str = "") -> None:
        """紧急撤单（风控熔断时调用）。"""
        if self.dry_run or self.client is None:
            log.info("DRY_RUN ▶ 将要撤销全部挂单（未真实执行）")
            return
        try:
            self.client.cancel_all()
            log.info("已撤销全部挂单。")
        except Exception as e:
            log.error(f"撤单失败：{e!r}")
