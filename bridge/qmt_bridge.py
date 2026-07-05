# -*- coding: utf-8 -*-
"""
QMT(miniQMT) 实盘桥接端 —— 在 Windows + 财通证券 QMT 环境运行
========================================================
QuantPilot app 的 A股实盘执行端。前提:
  1. 向财通证券申请开通 QMT/miniQMT 权限
  2. Windows 机器安装 QMT 客户端并登录,勾选「极简模式」
  3. pip install xtquant flask
  4. python qmt_bridge.py --port 9527 --token 你的口令
然后在 QuantPilot「设置 → 券商接入」填入 http://<本机局域网IP>:9527

⚠️ 风险声明:实盘接口,资金安全自负。默认仅监听局域网,勿暴露公网。
"""
import argparse
from flask import Flask, request, jsonify

try:
    from xtquant import xtconstant
    from xtquant.xttrader import XtQuantTrader
    from xtquant.xttype import StockAccount
    HAS_XT = True
except ImportError:
    HAS_XT = False

app = Flask(__name__)
trader = None
account = None
TOKEN = ''


def to_xt_symbol(symbol: str) -> str:
    """sh600519 -> 600519.SH / sz000001 -> 000001.SZ"""
    if symbol.startswith('sh'):
        return symbol[2:] + '.SH'
    if symbol.startswith('sz'):
        return symbol[2:] + '.SZ'
    raise ValueError('QMT 桥接仅支持 A股代码: ' + symbol)


@app.post('/order')
def order():
    data = request.get_json(force=True)
    if TOKEN and data.get('token') != TOKEN:
        return jsonify(ok=False, msg='token 校验失败'), 403
    if not HAS_XT or trader is None:
        return jsonify(ok=False, msg='xtquant 未就绪(需在 QMT 环境运行)'), 500
    try:
        code = to_xt_symbol(data['symbol'])
        side = xtconstant.STOCK_BUY if data['side'] == 'BUY' else xtconstant.STOCK_SELL
        order_id = trader.order_stock(
            account, code, side, int(data['qty']),
            xtconstant.FIX_PRICE, float(data['price']))
        return jsonify(ok=order_id >= 0, orderId=order_id,
                       msg='已提交' if order_id >= 0 else '下单被拒')
    except Exception as e:  # noqa: BLE001
        return jsonify(ok=False, msg=str(e)), 400


@app.get('/health')
def health():
    return jsonify(ok=True, ready=HAS_XT and trader is not None)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--port', type=int, default=9527)
    p.add_argument('--token', default='')
    p.add_argument('--qmt-path', default=r'C:\国金证券QMT交易端\userdata_mini')
    p.add_argument('--account', default='', help='资金账号')
    args = p.parse_args()
    TOKEN = args.token

    if HAS_XT and args.account:
        trader = XtQuantTrader(args.qmt_path, session_id=20260704)
        trader.start()
        trader.connect()
        account = StockAccount(args.account)
        trader.subscribe(account)
        print('✅ QMT 已连接,账号', args.account)
    else:
        print('⚠️ 演示模式:xtquant 未安装或未提供账号,/order 将返回错误')

    app.run(host='0.0.0.0', port=args.port)
