"""AI 决策引擎。

输入：一条突发新闻 + 目标 Polymarket 市场的实时盘口。
过程：构造 prompt → 调用大模型 → 解析结构化 JSON → 计算 edge → 产出 Decision。
输出：BUY_YES / BUY_NO / SELL / HOLD / ABSTAIN + 置信度 + 概率估计。

关键设计：
- 强约束模型只输出 JSON，便于机器执行；解析失败时安全降级为 ABSTAIN。
- edge = 模型概率 - 市场隐含概率；只有 edge 和置信度都够大，才可能触发交易
  （最终能否下单还要过 risk 层，本引擎只给"意见"）。
- 调用带重试，网络抖动不至于漏掉重大新闻。
"""
from __future__ import annotations

import json
import re
import time

from core.logger import get_logger
from core.models import Action, Decision, MarketQuote, NewsEvent
from decision.providers import LLMProvider

log = get_logger("engine")

SYSTEM_PROMPT = """你是一名事件驱动型量化交易分析师。你的任务是评估一条突发新闻对某个\
二元预测市场（Polymarket）结果概率的影响，并给出交易意见。

市场价格区间为 0~1，等于市场对"该事件发生(YES)"的隐含概率。

你必须只输出一个 JSON 对象，不要任何多余文字，字段如下：
{
  "prob_estimate": 0.0~1.0,   // 你独立评估的"事件发生"真实概率
  "confidence": 0.0~1.0,      // 你对本次判断的置信度
  "action": "BUY_YES|BUY_NO|SELL|HOLD|ABSTAIN",
  "reason": "一句话理由（中文，40字内）"
}

判断纪律：
- 新闻与该市场无关、或只是情绪噪音 → action=ABSTAIN，confidence 给低。
- 只有当你的 prob_estimate 明显偏离市场价、且你有较高 confidence 时，才给 BUY_YES/BUY_NO。
- 不确定就 ABSTAIN。宁可错过，不可乱下。你不对未经证实的传闻下重注。"""

USER_TEMPLATE = """【目标市场】{market_desc}
市场当前隐含概率(YES中间价)：{yes_mid:.3f}
盘口：YES 买{yes_bid:.3f}/卖{yes_ask:.3f}，价差{spread:.3f}

【突发新闻】
来源：{source}  作者：{author}
时间：{ptime}
正文：{text}

请评估这条新闻对该市场结果的影响，并按系统要求只输出 JSON。"""


class AIDecisionEngine:
    def __init__(self, provider: LLMProvider, market_desc: str,
                 min_edge: float, min_confidence: float, max_retries: int = 2) -> None:
        self.provider = provider
        self.market_desc = market_desc
        self.min_edge = min_edge
        self.min_confidence = min_confidence
        self.max_retries = max_retries

    def evaluate(self, news: NewsEvent, quote: MarketQuote) -> Decision:
        """核心：新闻 + 盘口 → Decision。任何异常都安全降级为 ABSTAIN。"""
        user = USER_TEMPLATE.format(
            market_desc=self.market_desc,
            yes_mid=quote.yes_mid,
            yes_bid=quote.yes_bid,
            yes_ask=quote.yes_ask,
            spread=quote.spread,
            source=news.source,
            author=news.author or "-",
            ptime=time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(news.published_at)),
            text=news.text[:1500],   # 截断超长文本，控成本
        )

        raw = ""
        for attempt in range(self.max_retries + 1):
            try:
                raw = self.provider.complete(SYSTEM_PROMPT, user)
                break
            except Exception as e:
                log.warning(f"LLM 调用失败（第{attempt + 1}次）：{e!r}")
                time.sleep(1.5 * (attempt + 1))
        else:
            log.error("LLM 多次失败，降级 ABSTAIN。")
            return Decision(Action.ABSTAIN, 0.0, quote.yes_mid, 0.0, "LLM不可用", 0.0, "")

        return self._parse(raw, quote)

    def _parse(self, raw: str, quote: MarketQuote) -> Decision:
        """解析模型 JSON。容忍模型偶尔多输出文字，用正则抠出 JSON 段。"""
        try:
            m = re.search(r"\{.*\}", raw, re.DOTALL)
            obj = json.loads(m.group(0)) if m else json.loads(raw)
        except Exception as e:
            log.warning(f"解析模型输出失败，降级 ABSTAIN：{e!r} | 原文：{raw[:200]}")
            return Decision(Action.ABSTAIN, 0.0, quote.yes_mid, 0.0, "解析失败", 0.0, raw)

        try:
            prob = float(obj.get("prob_estimate", quote.yes_mid))
            conf = float(obj.get("confidence", 0.0))
            action = Action(str(obj.get("action", "ABSTAIN")).upper())
            reason = str(obj.get("reason", ""))[:80]
        except Exception as e:
            log.warning(f"字段非法，降级 ABSTAIN：{e!r}")
            return Decision(Action.ABSTAIN, 0.0, quote.yes_mid, 0.0, "字段非法", 0.0, raw)

        prob = min(max(prob, 0.0), 1.0)
        conf = min(max(conf, 0.0), 1.0)

        # edge：买 YES 时用 (prob - yes_ask)，买 NO 时用 ((1-prob) - no_ask)
        if action == Action.BUY_YES:
            edge = prob - quote.yes_ask
        elif action == Action.BUY_NO:
            edge = (1.0 - prob) - quote.no_ask
        else:
            edge = 0.0

        decision = Decision(action, conf, prob, edge, reason, 0.0, raw)

        # 引擎级前置过滤：edge/置信度不达标，直接降级为 HOLD（不交易）
        if action in (Action.BUY_YES, Action.BUY_NO):
            if edge < self.min_edge or conf < self.min_confidence:
                log.info(f"意见 {action.value} 但 edge={edge:.3f}/conf={conf:.2f} 未达阈值 → HOLD")
                decision.action = Action.HOLD
        return decision
