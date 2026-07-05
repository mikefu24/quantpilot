# -*- coding: utf-8 -*-
"""
同花顺客户端桥接端(easytrader) —— 在 Windows 运行
=================================================
通过 easytrader 驱动同花顺下单客户端(xiadan.exe),适配财通证券等券商。
  1. Windows 安装同花顺「网上股票交易系统」独立下单程序并登录
  2. pip install easytrader flask
  3. python ths_bridge.py --port 9528 --exe "C:/同花顺软件/xiadan.exe"
然后在 QuantPilot「设置 → 券商接入」填入 http://<本机局域网IP>:9528

⚠️ 基于 GUI 自动化,请保持下单程序前台可见;实盘风险自负,勿暴露公网。
"""
import argparse
from flask import Flask, request, jsonify

try:
    import easytrader
    HAS_ET = True
except ImportError:
    HAS_ET = False

app = Flask(__name__)
client = None


def to_code(symbol: str) -> str:
    """sh600519 -> 600519"""
    return symbol[2:] if symbol[:2] in ('sh', 'sz') else symbol


@app.post('/order')
def order():
    if not HAS_ET or client is None:
        return jsonify(ok=False, msg='easytrader 未就绪(需在 Windows+同花顺环境运行)'), 500
    data = request.get_json(force=True)
    try:
        code = to_code(data['symbol'])
        if data['side'] == 'BUY':
            r = client.buy(code, price=float(data['price']), amount=int(data['qty']))
        else:
            r = client.sell(code, price=float(data['price']), amount=int(data['qty']))
        return jsonify(ok=True, msg='已提交', result=str(r))
    except Exception as e:  # noqa: BLE001
        return jsonify(ok=False, msg=str(e)), 400


@app.get('/health')
def health():
    return jsonify(ok=True, ready=HAS_ET and client is not None)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--port', type=int, default=9528)
    p.add_argument('--exe', default=r'C:\同花顺软件\同花顺\xiadan.exe')
    args = p.parse_args()

    if HAS_ET:
        client = easytrader.use('universal_client')
        client.connect(args.exe)
        print('✅ 同花顺下单程序已连接')
    else:
        print('⚠️ 演示模式:easytrader 未安装,/order 将返回错误')

    app.run(host='0.0.0.0', port=args.port)
