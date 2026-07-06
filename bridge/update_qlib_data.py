# -*- coding: utf-8 -*-
"""
Qlib A股数据更新 —— 每日新鲜数据(社区源 chenditc/investment_data)
==============================================================
官方 Yahoo 示例数据停更于 2020-09;本脚本改用社区维护、GitHub Actions
每日自动发版的 qlib bin 格式数据(https://github.com/chenditc/investment_data),
数据来源为 TuShare 等,含日线 OHLCV 与复权因子。

用法(在你本机):
  python bridge/update_qlib_data.py                 # 下载最新数据到 ~/.qlib/qlib_data/cn_data
  python bridge/update_qlib_data.py --check         # 只查看本地数据新鲜度
  python bridge/update_qlib_data.py --dir 自定义目录

更新完成后重启 qlib_bridge.py,并用新日期训练,例如:
  curl -X POST http://127.0.0.1:9529/train -H "Content-Type: application/json" \
       -d '{"instruments":"csi300","start":"2018-01-01","end":"<脚本输出的最新日期>","split":"<最新日期前一年>"}'

⚠️ 社区数据仅供研究,实盘决策前请抽样与券商行情核对。
"""
import argparse
import datetime as dt
import os
import shutil
import sys
import tarfile
import tempfile
import urllib.request

URL = "https://github.com/chenditc/investment_data/releases/latest/download/qlib_bin.tar.gz"
DEFAULT_DIR = os.path.expanduser("~/.qlib/qlib_data/cn_data")


def freshness(target_dir: str):
    """读取 calendars/day.txt 最后一行 = 数据最新交易日"""
    cal = os.path.join(target_dir, "calendars", "day.txt")
    if not os.path.exists(cal):
        return None
    with open(cal, "rb") as f:
        try:
            f.seek(-64, os.SEEK_END)
        except OSError:
            f.seek(0)
        last = f.read().decode().strip().splitlines()[-1]
    return last


def download(target_dir: str):
    os.makedirs(target_dir, exist_ok=True)
    print(f"↓ 下载最新数据包(数百MB,取决于网速)…\n  {URL}")
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        tmp_path = tmp.name

    def hook(n, bs, total):
        if total > 0 and n % 50 == 0:
            done = min(n * bs / total * 100, 100)
            print(f"\r  {done:5.1f}%  {n * bs / 1e6:.0f}MB", end="", flush=True)

    urllib.request.urlretrieve(URL, tmp_path, reporthook=hook)
    print("\n✓ 下载完成,解压中…")

    # 旧数据备份一份(仅一代)
    old = freshness(target_dir)
    if old:
        bak = target_dir.rstrip("/") + ".bak"
        shutil.rmtree(bak, ignore_errors=True)
        shutil.move(target_dir, bak)
        os.makedirs(target_dir, exist_ok=True)
        print(f"  旧数据({old})已备份到 {bak}")

    # 包内顶层目录为 qlib_bin/,剥掉一层解压
    with tarfile.open(tmp_path, "r:gz") as tar:
        members = tar.getmembers()
        top = members[0].name.split("/")[0]
        for m in members:
            if m.name == top:
                continue
            m.name = m.name.split("/", 1)[1] if "/" in m.name else m.name
            tar.extract(m, target_dir)
    os.unlink(tmp_path)
    print(f"✓ 解压完成 → {target_dir}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dir", default=DEFAULT_DIR)
    p.add_argument("--check", action="store_true", help="只检查本地数据新鲜度")
    args = p.parse_args()

    if args.check:
        last = freshness(args.dir)
        print(f"本地数据最新交易日: {last or '无数据'}")
        sys.exit(0)

    download(args.dir)
    last = freshness(args.dir)
    if not last:
        print("⚠️ 未找到 calendars/day.txt,解压可能不完整")
        sys.exit(1)

    split = (dt.datetime.strptime(last, "%Y-%m-%d") - dt.timedelta(days=365)).strftime("%Y-%m-%d")
    print(f"""
✅ 数据已更新,最新交易日: {last}

下一步:重启桥接并用新日期训练:
  python bridge/qlib_bridge.py --port 9529
  curl -X POST http://127.0.0.1:9529/train -H "Content-Type: application/json" \\
       -d '{{"instruments":"csi300","start":"2018-01-01","end":"{last}","split":"{split}"}}'
""")


if __name__ == "__main__":
    main()
