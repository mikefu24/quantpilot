# -*- coding: utf-8 -*-
"""
Qlib 研究后端桥接 —— 微软 Qlib(Alpha158 因子库 + LightGBM)接入 QuantPilot
=====================================================================
在你的 Mac/PC 本机运行(参考实现,需自行验证):

  # 1) 安装(需 Python 3.10/3.11,系统 3.13+ 不支持;推荐 uv:
  #    uv venv --python 3.11 bridge/.venv && uv pip install --python bridge/.venv/bin/python pyqlib flask lightgbm)
  pip install pyqlib flask lightgbm

  # 2) 下载 A股数据包(约500MB,一次即可;数据到 ~/.qlib/qlib_data/cn_data)
  #    注意:官方示例数据为 Yahoo 社区数据,截止 2020-09-25,已停更
  python -c "from qlib.tests.data import GetData; GetData().qlib_data(target_dir='~/.qlib/qlib_data/cn_data', region='cn')"

  # 3) 启动
  python bridge/qlib_bridge.py --port 9529

接口:
  GET  /health                      就绪状态
  POST /train   {"instruments":"csi300","start":"2018-01-01","end":"2024-12-31"}
                用 Alpha158 因子 + LightGBM 训练排序模型(几分钟)
  GET  /signal?symbol=sh600519      返回该股最新模型评分(越高越看多)
  GET  /topk?k=10                   返回全池评分 TopK

QuantPilot 侧用法:浏览器 DevTools 或自定义策略里
  await fetch('http://127.0.0.1:9529/signal?symbol=sh600519').then(r=>r.json())

⚠️ 仅研究参考,不构成投资建议。
"""
import argparse
import os

# MLflow 3.x 默认禁用文件存储后端,qlib 训练日志依赖它
os.environ.setdefault("MLFLOW_ALLOW_FILE_STORE", "true")

from flask import Flask, request, jsonify

app = Flask(__name__)
STATE = {"ready": False, "pred": None, "err": None, "qlib_inited": False}


def to_qlib_code(symbol: str) -> str:
    """sh600519 -> SH600519 / sz000001 -> SZ000001"""
    return symbol.upper() if symbol[:2].lower() in ("sh", "sz") else symbol


@app.get("/health")
def health():
    return jsonify(ok=True, ready=STATE["ready"], err=STATE["err"])


@app.post("/train")
def train():
    cfg = request.get_json(force=True) or {}
    try:
        import qlib
        from qlib.constant import REG_CN
        from qlib.utils import init_instance_by_config
        import pandas as pd

        if not STATE["qlib_inited"]:  # qlib 禁止在 Recorder 激活后重复 init
            qlib.init(provider_uri="~/.qlib/qlib_data/cn_data", region=REG_CN)
            STATE["qlib_inited"] = True

        # 默认区间匹配官方示例数据(截止 2020-09-25);换新数据源时用请求参数覆盖
        instruments = cfg.get("instruments", "csi300")
        start = cfg.get("start", "2015-01-01")
        end = cfg.get("end", "2020-09-25")
        split = cfg.get("split", "2020-01-01")

        dataset = init_instance_by_config({
            "class": "DatasetH",
            "module_path": "qlib.data.dataset",
            "kwargs": {
                "handler": {
                    "class": "Alpha158",
                    "module_path": "qlib.contrib.data.handler",
                    "kwargs": {
                        "instruments": instruments,
                        "start_time": start, "end_time": end,
                        "fit_start_time": start, "fit_end_time": split,
                    },
                },
                "segments": {
                    "train": (start, split),
                    "test": (split, end),
                },
            },
        })
        model = init_instance_by_config({
            "class": "LGBModel",
            "module_path": "qlib.contrib.model.gbdt",
            "kwargs": {"loss": "mse", "num_leaves": 128, "learning_rate": 0.05,
                       "num_boost_round": 200, "early_stopping_rounds": 30},
        })
        model.fit(dataset)
        pred = model.predict(dataset, segment="test")  # Series: (datetime, instrument) -> score
        if hasattr(pred, "to_frame"):
            pred = pred.to_frame("score")
        if len(pred) == 0:
            raise ValueError(f"测试段 {split}~{end} 无预测数据,请确认日期在数据范围内")
        latest_date = pred.index.get_level_values(0).max()
        STATE["pred"] = pred.xs(latest_date, level=0)["score"].sort_values(ascending=False)
        STATE["ready"] = True
        STATE["err"] = None
        return jsonify(ok=True, samples=int(len(pred)), asof=str(latest_date)[:10],
                       universe=int(len(STATE["pred"])))
    except Exception as e:  # noqa: BLE001
        STATE["err"] = str(e)
        return jsonify(ok=False, msg=str(e)), 500


@app.get("/signal")
def signal():
    if not STATE["ready"]:
        return jsonify(ok=False, msg="模型未训练,先 POST /train"), 400
    code = to_qlib_code(request.args.get("symbol", ""))
    s = STATE["pred"]
    if code not in s.index:
        return jsonify(ok=False, msg=f"{code} 不在训练股票池内"), 404
    rank = int((s.index.get_indexer([code]))[0]) + 1
    return jsonify(ok=True, symbol=code, score=float(s[code]),
                   rank=rank, universe=int(len(s)),
                   percentile=round(100 * (1 - rank / len(s)), 1))


@app.get("/topk")
def topk():
    if not STATE["ready"]:
        return jsonify(ok=False, msg="模型未训练,先 POST /train"), 400
    k = int(request.args.get("k", 10))
    top = STATE["pred"].head(k)
    return jsonify(ok=True, top=[{"symbol": i, "score": float(v)} for i, v in top.items()])


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--port", type=int, default=9529)
    args = p.parse_args()
    print("Qlib 桥接启动: http://127.0.0.1:%d  (先 POST /train 训练)" % args.port)
    app.run(host="127.0.0.1", port=args.port)
