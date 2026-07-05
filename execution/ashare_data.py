"""A股辅助市场——数据侧（AkShare）。

定位：A股是"辅助/参考"市场，受 T+1、涨跌停、政策与'小作文'驱动。
本模块只做**数据获取与信号提示**，不做自动下单（券商无统一开放交易 API，
且 T+1 使得事件驱动的即时执行意义有限）。真正下单请人工在券商端完成。

依赖：pip install akshare
"""
from __future__ import annotations

from core.logger import get_logger

log = get_logger("exec.ashare")


class AShareData:
    def __init__(self) -> None:
        try:
            import akshare as ak
            self.ak = ak
        except ImportError:
            self.ak = None
            log.warning("未安装 akshare，A股数据功能不可用。pip install akshare")

    def realtime_quote(self, symbol: str) -> dict | None:
        """获取单只股票实时行情快照。symbol 如 '600519'（贵州茅台）。"""
        if self.ak is None:
            return None
        try:
            df = self.ak.stock_zh_a_spot_em()   # 全市场快照
            row = df[df["代码"] == symbol]
            if row.empty:
                log.info(f"未找到 {symbol} 的行情。")
                return None
            r = row.iloc[0]
            return {
                "symbol": symbol,
                "name": r.get("名称"),
                "price": float(r.get("最新价", 0) or 0),
                "pct_change": float(r.get("涨跌幅", 0) or 0),
                "turnover_rate": float(r.get("换手率", 0) or 0),
                "amount": float(r.get("成交额", 0) or 0),
            }
        except Exception as e:
            log.warning(f"获取 {symbol} 行情失败：{e!r}")
            return None

    def news_flash(self) -> list[dict]:
        """获取财经快讯（'小作文'/突发政策的信息源之一）。"""
        if self.ak is None:
            return []
        try:
            df = self.ak.stock_info_global_em()   # 全球财经快讯
            out = []
            for _, r in df.head(30).iterrows():
                out.append({"title": str(r.get("标题", "")), "content": str(r.get("摘要", "")),
                            "time": str(r.get("发布时间", ""))})
            return out
        except Exception as e:
            log.warning(f"获取财经快讯失败：{e!r}")
            return []

    @staticmethod
    def t_plus_1_warning(symbol: str) -> str:
        """T+1 提示：当日买入次日才能卖，事件驱动策略需据此调整持仓周期。"""
        return (f"[{symbol}] A股 T+1：当日买入次日方可卖出，"
                f"且有 ±10%（科创/创业板 ±20%）涨跌停限制，"
                f"事件驱动信号只作人工决策参考，不自动下单。")
