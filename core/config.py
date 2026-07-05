"""配置加载。

优先级：环境变量（.env）> config.yaml > 代码默认值。
敏感信息（私钥、API key）只从环境变量读，绝不写进 yaml/代码。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

try:
    import yaml  # PyYAML
except ImportError:  # 允许没装 yaml 时也能靠环境变量跑
    yaml = None

try:
    from dotenv import load_dotenv
    load_dotenv()  # 自动加载同目录 .env
except ImportError:
    pass


def _get_bool(key: str, default: bool) -> bool:
    val = os.getenv(key)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _get_float(key: str, default: float) -> float:
    try:
        return float(os.getenv(key, default))
    except (TypeError, ValueError):
        return default


@dataclass
class RiskConfig:
    """风控参数——全部可被环境变量覆盖。"""
    max_slippage: float = 0.02        # 最大可接受滑点（绝对价差，价格单位）
    max_spread: float = 0.05          # 盘口价差超过此值视为流动性不足，拒单
    min_depth_shares: float = 50.0    # 目标价位内最少可成交份额，防插针
    max_position_usd: float = 100.0   # 单市场最大名义敞口
    max_order_usd: float = 25.0       # 单笔最大下单金额
    min_edge: float = 0.08            # 模型概率相对市场价的最小优势，低于则不交易
    min_confidence: float = 0.65      # 模型最低置信度
    cooldown_sec: float = 60.0        # 同一市场两次下单最小间隔，防连环误触发


@dataclass
class AppConfig:
    """全局配置。"""
    # —— 安全总开关 ——
    # 默认 DRY_RUN=True：只打印"将要下的单"，绝不真实下单。
    # 只有显式设置环境变量 LIVE_TRADING=true 才会真实下单。
    dry_run: bool = True

    # —— LLM ——
    llm_provider: str = "claude"      # claude / deepseek / openai / custom
    llm_model: str = "claude-sonnet-4-5"
    llm_api_key: str = ""
    llm_base_url: str = ""            # 自建/兼容 OpenAI 协议时填（DeepSeek 等）

    # —— 数据监听 ——
    news_api_key: str = ""
    twitter_bearer_token: str = ""
    poll_interval_sec: float = 5.0    # 轮询类监听的间隔
    watch_keywords: list[str] = field(default_factory=list)

    # —— Polymarket ——
    poly_clob_url: str = "https://clob.polymarket.com"
    poly_private_key: str = ""        # Polygon 钱包私钥（仅环境变量）
    poly_api_key: str = ""            # CLOB API 凭证（L2）
    poly_api_secret: str = ""
    poly_api_passphrase: str = ""
    poly_funder: str = ""             # 代理钱包地址（如用 email/magic 登录）
    target_market_id: str = ""        # 主攻的那个事件市场

    risk: RiskConfig = field(default_factory=RiskConfig)

    @classmethod
    def load(cls, yaml_path: str = "config.yaml") -> "AppConfig":
        data: dict = {}
        if yaml and os.path.exists(yaml_path):
            try:
                with open(yaml_path, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
            except Exception as e:  # 配置损坏不该让程序崩，退化到环境变量
                print(f"[config] 读取 {yaml_path} 失败，改用环境变量：{e}")

        risk_data = data.get("risk", {})
        risk = RiskConfig(
            max_slippage=_get_float("MAX_SLIPPAGE", risk_data.get("max_slippage", 0.02)),
            max_spread=_get_float("MAX_SPREAD", risk_data.get("max_spread", 0.05)),
            min_depth_shares=_get_float("MIN_DEPTH_SHARES", risk_data.get("min_depth_shares", 50.0)),
            max_position_usd=_get_float("MAX_POSITION_USD", risk_data.get("max_position_usd", 100.0)),
            max_order_usd=_get_float("MAX_ORDER_USD", risk_data.get("max_order_usd", 25.0)),
            min_edge=_get_float("MIN_EDGE", risk_data.get("min_edge", 0.08)),
            min_confidence=_get_float("MIN_CONFIDENCE", risk_data.get("min_confidence", 0.65)),
            cooldown_sec=_get_float("COOLDOWN_SEC", risk_data.get("cooldown_sec", 60.0)),
        )

        return cls(
            dry_run=not _get_bool("LIVE_TRADING", False),  # 关键：默认空跑
            llm_provider=os.getenv("LLM_PROVIDER", data.get("llm_provider", "claude")),
            llm_model=os.getenv("LLM_MODEL", data.get("llm_model", "claude-sonnet-4-5")),
            llm_api_key=os.getenv("LLM_API_KEY", ""),
            llm_base_url=os.getenv("LLM_BASE_URL", data.get("llm_base_url", "")),
            news_api_key=os.getenv("NEWS_API_KEY", ""),
            twitter_bearer_token=os.getenv("TWITTER_BEARER_TOKEN", ""),
            poll_interval_sec=_get_float("POLL_INTERVAL_SEC", data.get("poll_interval_sec", 5.0)),
            watch_keywords=data.get("watch_keywords", []),
            poly_clob_url=os.getenv("POLY_CLOB_URL", data.get("poly_clob_url", "https://clob.polymarket.com")),
            poly_private_key=os.getenv("POLY_PRIVATE_KEY", ""),
            poly_api_key=os.getenv("POLY_API_KEY", ""),
            poly_api_secret=os.getenv("POLY_API_SECRET", ""),
            poly_api_passphrase=os.getenv("POLY_API_PASSPHRASE", ""),
            poly_funder=os.getenv("POLY_FUNDER", ""),
            target_market_id=os.getenv("TARGET_MARKET_ID", data.get("target_market_id", "")),
            risk=risk,
        )
