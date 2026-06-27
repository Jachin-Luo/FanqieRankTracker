"""
番茄榜单发现脚本 —— 在国内可访问 fanqienovel.com 的机器上运行。

用途：
  自动打开番茄榜单页，dump 出所有榜单/频道导航的「名称 + /rank/ URL」，
  以及每个榜单下的分类列表，输出成可直接粘贴回 boards_config.py 的片段。

为什么需要它：
  男频新书榜 / 热销榜 / 完结榜 的榜单 ID 无法离线确定，必须对着真站抓取。
  女频新书榜已知是 /rank/0_1_1139。

用法：
  pip install playwright && playwright install chromium
  python discover_boards.py

  把控制台输出（尤其 === 榜单候选 === 与 === 建议配置 === 两段）整段贴回，
  即可据此填充 boards_config.py。
"""
import json
import re
import time
from datetime import datetime

from playwright.sync_api import sync_playwright

# 榜单页入口。番茄榜单首页通常会在侧边/顶部列出全部榜单与频道入口。
ENTRY_URLS = [
    "https://fanqienovel.com/rank",
    "https://fanqienovel.com/rank/0_1_1139",  # 已知女频新书榜，作兜底入口
]

# /rank/ 路由形如 /rank/<a>_<b>_<c>：经验上 <a>_<b> 编码频道+榜单类型，<c> 为分类 ID。
RANK_HREF_RE = re.compile(r"/rank/(\d+)_(\d+)_(\d+)")


def dump_rank_links(page):
    """抓取页面上所有 /rank/ 链接的文本与 href。"""
    js = """
    () => {
        const out = [];
        document.querySelectorAll('a').forEach(a => {
            const href = a.getAttribute('href') || '';
            if (href.includes('/rank/')) {
                out.push({
                    text: (a.innerText || a.textContent || '').trim(),
                    href: href,
                    // 记录祖先文本，便于人工判断这个链接属于哪个榜单分组
                    ctx: (a.closest('[class*="rank"],[class*="tab"],[class*="nav"],aside,header')
                          || {}).className || ''
                });
            }
        });
        return out;
    }
    """
    try:
        return page.evaluate(js)
    except Exception as e:
        print(f"  ⚠️  提取链接失败: {e}")
        return []


def dump_nav_tabs(page):
    """尝试抓取顶部/侧边的榜单切换 Tab（可能不是 <a>，而是带点击事件的 div/span）。"""
    js = """
    () => {
        const out = [];
        const sel = '[class*="tab"],[class*="rank-type"],[class*="channel"],[role="tab"],li,button';
        document.querySelectorAll(sel).forEach(el => {
            const text = (el.innerText || '').trim();
            if (text && text.length <= 12 &&
                /榜|频|新书|热销|完结|畅销|排行/.test(text)) {
                out.push({ text, tag: el.tagName, cls: el.className });
            }
        });
        // 去重
        const seen = new Set();
        return out.filter(x => {
            const k = x.text + '|' + x.cls;
            if (seen.has(k)) return false;
            seen.add(k); return true;
        });
    }
    """
    try:
        return page.evaluate(js)
    except Exception:
        return []


def slugify_guess(name: str) -> str:
    """给榜单名猜一个英文 slug（仅供参考，可手改）。"""
    mapping = {
        "女频": "female", "男频": "male",
        "新书": "new", "热销": "bestseller", "畅销": "bestseller",
        "完结": "completed", "新书榜": "new", "排行": "rank",
    }
    parts = []
    for zh, en in mapping.items():
        if zh in name:
            parts.append(en)
    return "-".join(dict.fromkeys(parts)) or "board"


def main():
    print("=" * 60)
    print("番茄榜单发现脚本启动")
    print(f"时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    all_links = []
    all_tabs = []

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(headless=True, channel="chrome")
        except Exception:
            browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                        "AppleWebKit/537.36 (KHTML, like Gecko) "
                        "Chrome/120.0.0.0 Safari/537.36")
        )
        page = context.new_page()

        for url in ENTRY_URLS:
            print(f"\n[访问] {url}")
            try:
                page.goto(url, wait_until="load", timeout=20000)
                # 等 SPA 渲染，并滚动触发懒加载导航
                time.sleep(3)
                for _ in range(3):
                    page.evaluate("window.scrollBy(0, window.innerHeight)")
                    time.sleep(1)
            except Exception as e:
                print(f"  ⚠️  打开失败: {e}")
                continue

            links = dump_rank_links(page)
            tabs = dump_nav_tabs(page)
            print(f"  → 找到 {len(links)} 个 /rank/ 链接, {len(tabs)} 个疑似榜单 Tab")
            all_links.extend(links)
            all_tabs.extend(tabs)

        browser.close()

    # 去重链接
    uniq = {}
    for l in all_links:
        uniq[l["href"]] = l
    links = list(uniq.values())

    # 按 <a>_<b> 前缀聚类（同一榜单+频道的分类会共享前缀）
    groups = {}
    for l in links:
        m = RANK_HREF_RE.search(l["href"])
        if not m:
            continue
        prefix = f"{m.group(1)}_{m.group(2)}"
        groups.setdefault(prefix, []).append({
            "text": l["text"], "href": l["href"], "cat_id": m.group(3),
        })

    print("\n" + "=" * 60)
    print("=== 榜单候选（按 /rank/<a>_<b>_ 前缀聚类）===")
    print("=" * 60)
    print("说明：每个前缀 = 一个「频道+榜单类型」组合；下面列出它包含的分类。\n")
    for prefix, items in sorted(groups.items()):
        print(f"\n▼ 前缀 {prefix}_*  （{len(items)} 个分类）")
        for it in items[:30]:
            label = it["text"] or "(无文字)"
            print(f"    {prefix}_{it['cat_id']:<8}  {label}")

    print("\n" + "=" * 60)
    print("=== 疑似榜单切换 Tab（可能含频道/榜单名）===")
    print("=" * 60)
    seen = set()
    for t in all_tabs:
        if t["text"] in seen:
            continue
        seen.add(t["text"])
        print(f"    [{t['tag']}] {t['text']}")

    # 生成建议配置片段
    print("\n" + "=" * 60)
    print("=== 建议配置片段（粘贴回 boards_config.py 后人工核对）===")
    print("=" * 60)
    suggestions = []
    for prefix, items in sorted(groups.items()):
        # 用该前缀第一个分类作为 init_url
        first = items[0]
        init_url = "https://fanqienovel.com" + first["href"]
        sample_names = "、".join(it["text"] for it in items[:4] if it["text"])
        suggestions.append({
            "prefix": prefix,
            "init_url": init_url,
            "category_count": len(items),
            "sample_categories": sample_names,
        })
        print(f"""
# 前缀 {prefix} —— 含分类: {sample_names or '(无文字，需人工确认)'}
{{
    "slug": "{slugify_guess(sample_names)}",   # ← 按实际榜单名修改，如 female-new / male-new / bestseller / completed
    "name": "请填写榜单中文名",                  # ← 如「女频新书榜」
    "channel": "female 或 male",
    "init_url": "{init_url}",
    "enabled": True,
}},""")

    # 同时写一份 JSON 到磁盘，方便直接发给我
    out = {
        "discovered_at": datetime.now().isoformat(),
        "groups": groups,
        "tabs": [t["text"] for t in all_tabs],
        "suggestions": suggestions,
    }
    with open("discovered_boards.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\n\n✅ 完整结果已写入 discovered_boards.json —— 可直接把这个文件发给我。")


if __name__ == "__main__":
    main()
