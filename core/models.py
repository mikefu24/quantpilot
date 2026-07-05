"""核心数据模型（Python 3.10+ dataclass）。

全流程用这些结构化对象在模块间传递，避免到处传 dict 出错。
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


class Side(str, Enum):
    """交易方向。Polymarket 是二元市场，买 YES 份额 = 看多该事件发生。"""
    BUY = "BUY"
    SELL = "SELL"


class Outcome(str, Enum):
    """二元预测市场的两个结果 token。"""
    YES = "YES"
    NO = "NO"


class Action(str, Enum):
    """AI 决策引擎的输出动作。"""
    BUY_YES = "BUY_YES"      # 买入 YES（看多事件发生）
    BUY_NO = "BUY_NO"        # 买入 NO（看空事件发生）
    SELL = "SELL"            # 平掉现有仓位
    HOLD = "HOLD"            # 不动
    ABSTAIN = "ABSTAIN"      # 弃权（信息不足/噪音）


@dataclass(slots=True)
class NewsEvent:
    """一条被监听到的突发新闻/社媒消息。"""
    source: str                    # 来源：newsapi / twitter / ...
    text: str                      # 正文（标题+摘要或推文全文）
    url: str = ""
    author: str = ""
    published_at: float = field(default_factory=time.time)  # unix 时间戳
    raw_id: str = ""               # 原始唯一 ID，用于去重
    lang: str = ""

    def dedup_key(self) -> str:
        """去重键：优先用原始 ID，退化到 source+text 哈希。"""
        if self.raw_id:
            return f"{self.source}:{self.raw_id}"
        return f"{self.source}:{hash(self.text)}"


@dataclass(slots=True)
class MarketQuote:
    """Polymarket 某个市场的实时盘口快照。

    价格区间恒为 [0, 1]，代表市场隐含概率。YES + NO ≈ 1。
    """
    market_id: str                 # condition_id / market slug
    yes_token_id: str              # YES 结果的 ERC1155 token id
    no_token_id: str
    yes_bid: float                 # YES 最优买价（你卖出 YES 能拿到的价）
    yes_ask: float                 # YES 最优卖价（你买入 YES 要付的价）
    no_bid: float
    no_ask: float
    # 盘口深度：价位 -> 该价位可成交的份额数量，用于滑点/流动性评估
    yes_ask_depth: dict[float, float] = field(default_factory=dict)
    yes_bid_depth: dict[float, float] = field(default_factory=dict)
    ts: float = field(default_factory=time.time)

    @property
    def yes_mid(self) -> float:
        """YES 中间价 = 市场对该事件发生概率的即时估计。"""
        return (self.yes_bid + self.yes_ask) / 2.0

    @property
    def spread(self) -> float:
        """买卖价差，衡量流动性紧张程度。"""
        return max(0.0, self.yes_ask - self.yes_bid)


@dataclass(slots=True)
class Decision:
    """AI 决策引擎的结构化输出。"""
    action: Action
    confidence: float              # 0~1，模型对该判断的置信度
    prob_estimate: float           # 模型估计的"事件发生"真实概率（0~1）
    edge: float                    # 模型概率 - 市场隐含概率，正=有优势
    reason: str                    # 简短理由（用于日志与复盘）
    target_size_usd: float = 0.0   # 建议下单名义金额（美元），由风控二次约束
    raw: str = ""                  # 模型原始返回，便于审计


@dataclass(slots=True)
class Order:
    """标准化下单请求。"""
    market_id: str
    token_id: str                  # 要买/卖的具体 token（YES 或 NO）
    side: Side
    size: float                    # 份额数量（不是美元）
    limit_price: float             # 限价（0~1）。市价单时为可接受的最差价
    order_type: str = "GTC"        # GTC 限价 / FOK 市价立即成交或取消
    client_id: str = ""            # 幂等键，防重复下单


@dataclass(slots=True)
class ExecReport:
    """下单结果回执。"""
    ok: bool
    order_id: str = ""
    filled_size: float = 0.0
    avg_price: float = 0.0
    message: str = ""
    dry_run: bool = True
