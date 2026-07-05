// ============ 券商适配器层 ============
// 统一下单接口。Mac 上券商无官方 API,实盘路径:
//   A股: 本机/局域网 Windows 机器运行「桥接端」(QMT-miniQMT 或 easytrader 驱动同花顺客户端),
//        暴露 HTTP 接口,本适配器转发。仓库 bridge/ 目录提供桥接端参考实现。
//   Polymarket: 官方 CLOB API(需钱包私钥签名,建议在 Tauri 桌面版使用)。
import { paperBroker } from './paper.js';
import { getSettings } from '../core/store.js';
import { notify } from './notify.js';

/**
 * @typedef {Object} BrokerAdapter
 * @property {string} id
 * @property {string} name
 * @property {string} status 'ready'|'unconfigured'|'error'
 * @property {(order:{symbol:string,name?:string,side:'BUY'|'SELL',qty:number,price:number})=>Promise<{ok:boolean,msg:string,order?:Object}>} place
 */

/** 模拟盘(默认) */
export const paperAdapter = {
  id: 'paper', name: '模拟盘', status: 'ready',
  async place(order) { return paperBroker.place(order); },
};

/** QMT/miniQMT 桥接(Windows 侧 http 服务) */
export const qmtAdapter = {
  id: 'qmt', name: '财通 QMT 桥接',
  get status() { return getSettings().qmtBridgeUrl ? 'ready' : 'unconfigured'; },
  async place(order) {
    const url = getSettings().qmtBridgeUrl;
    if (!url) return { ok: false, msg: '未配置 QMT 桥接地址(设置→券商接入)' };
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...order, token: getSettings().qmtBridgeToken || '' }),
        signal: AbortSignal.timeout(10000),
      });
      const j = await r.json();
      return j.ok ? { ok: true, msg: `QMT 实盘委托成功 #${j.orderId}`, order: j } : { ok: false, msg: j.msg || 'QMT 拒单' };
    } catch (e) { return { ok: false, msg: 'QMT 桥接不可达: ' + e.message }; }
  },
};

/** easytrader/同花顺客户端桥接(Windows 侧) */
export const thsAdapter = {
  id: 'ths', name: '同花顺客户端桥接',
  get status() { return getSettings().thsBridgeUrl ? 'ready' : 'unconfigured'; },
  async place(order) {
    const url = getSettings().thsBridgeUrl;
    if (!url) return { ok: false, msg: '未配置同花顺桥接地址(设置→券商接入)' };
    try {
      const r = await fetch(url.replace(/\/$/, '') + '/order', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(order), signal: AbortSignal.timeout(10000),
      });
      const j = await r.json();
      return j.ok ? { ok: true, msg: '同花顺实盘委托成功', order: j } : { ok: false, msg: j.msg || '委托失败' };
    } catch (e) { return { ok: false, msg: '同花顺桥接不可达: ' + e.message }; }
  },
};

/** Polymarket(实盘需私钥签名,web 版仅提示;模拟走 paper) */
export const polymarketAdapter = {
  id: 'polymarket', name: 'Polymarket CLOB',
  get status() { return getSettings().pmPrivateKey ? 'ready' : 'unconfigured'; },
  async place(order) {
    if (!getSettings().pmPrivateKey) return { ok: false, msg: '未配置 Polygon 私钥;当前以模拟盘记录。' };
    return { ok: false, msg: 'CLOB 实盘签名下单请使用桌面版并确认风险(默认关闭)' };
  },
};

export const BROKERS = [paperAdapter, qmtAdapter, thsAdapter, polymarketAdapter];

/** 统一下单入口:根据设置路由到实盘/模拟,失败自动回落模拟盘并通知 */
export async function placeOrder(order) {
  const s = getSettings();
  const live = s.liveTrading === true;
  let res;
  if (live) {
    const adapter = BROKERS.find(b => b.id === (s.activeBroker || 'qmt')) || paperAdapter;
    res = await adapter.place(order);
    if (!res.ok) {
      const fallback = paperBroker.place(order);
      res = { ...fallback, msg: `[实盘失败→已转模拟] ${res.msg}` };
    }
  } else {
    res = paperBroker.place(order);
  }
  if (res.ok) notify(`📈 ${res.msg}`, `账户权益变动,来源:${live ? '实盘' : '模拟盘'}`);
  return res;
}
