"""
迁移脚本：把旧的扁平女频数据迁移到新的多榜单目录结构。

旧结构（单榜单）：
  data/fanqie_female_new_ranks_YYYYMMDD.json   每日快照
  data/trends/YYYY-MM-DD.json                  趋势归档
  data/task_state_YYYYMMDD.json                抓取状态

新结构（多榜单，slug=female-new）：
  data/female-new/snapshots/ranks_YYYYMMDD.json
  data/female-new/trends/YYYY-MM-DD.json
  data/female-new/task_state_YYYYMMDD.json

迁移采用「复制」而非「移动」，旧文件保留不动，便于回滚校验。
迁移后运行 build_latest.py 即可基于迁移历史重建多周期趋势。

用法：
  python scripts/migrate_to_boards.py          # 执行迁移
  python scripts/migrate_to_boards.py --dry-run  # 仅打印将要迁移的文件
"""
import os
import re
import shutil
import glob
import argparse

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
TARGET_SLUG = "female-new"


def migrate(dry_run: bool = False):
    target_dir = os.path.join(DATA_DIR, TARGET_SLUG)
    snap_dir = os.path.join(target_dir, "snapshots")
    trends_dir = os.path.join(target_dir, "trends")

    if not dry_run:
        os.makedirs(snap_dir, exist_ok=True)
        os.makedirs(trends_dir, exist_ok=True)

    moved = {"snapshots": 0, "trends": 0, "states": 0}

    # 1. 每日快照 fanqie_female_new_ranks_YYYYMMDD.json -> snapshots/ranks_YYYYMMDD.json
    for src in sorted(glob.glob(os.path.join(DATA_DIR, "fanqie_female_new_ranks_*.json"))):
        m = re.search(r"(\d{8})\.json$", os.path.basename(src))
        if not m:
            continue
        dst = os.path.join(snap_dir, f"ranks_{m.group(1)}.json")
        print(f"  快照: {os.path.basename(src)} -> {TARGET_SLUG}/snapshots/{os.path.basename(dst)}")
        if not dry_run:
            shutil.copy2(src, dst)
        moved["snapshots"] += 1

    # 2. 趋势归档 data/trends/*.json -> female-new/trends/*.json
    old_trends_dir = os.path.join(DATA_DIR, "trends")
    if os.path.isdir(old_trends_dir):
        for src in sorted(glob.glob(os.path.join(old_trends_dir, "*.json"))):
            dst = os.path.join(trends_dir, os.path.basename(src))
            print(f"  趋势: trends/{os.path.basename(src)} -> {TARGET_SLUG}/trends/{os.path.basename(src)}")
            if not dry_run:
                shutil.copy2(src, dst)
            moved["trends"] += 1

    # 3. 抓取状态 task_state_YYYYMMDD.json -> female-new/
    for src in sorted(glob.glob(os.path.join(DATA_DIR, "task_state_*.json"))):
        dst = os.path.join(target_dir, os.path.basename(src))
        print(f"  状态: {os.path.basename(src)} -> {TARGET_SLUG}/{os.path.basename(src)}")
        if not dry_run:
            shutil.copy2(src, dst)
        moved["states"] += 1

    print(f"\n{'[DRY-RUN] 将迁移' if dry_run else '✅ 已迁移'}: "
          f"{moved['snapshots']} 快照, {moved['trends']} 趋势, {moved['states']} 状态")
    if dry_run:
        print("加 --execute 或去掉 --dry-run 实际执行。")
    else:
        print(f"\n下一步：python scripts/build_latest.py --board {TARGET_SLUG}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="迁移女频数据到多榜单结构")
    parser.add_argument("--dry-run", action="store_true", help="仅打印不实际复制")
    args = parser.parse_args()
    migrate(dry_run=args.dry_run)
