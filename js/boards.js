/**
 * 多榜单共享工具：榜单列表加载、当前榜单解析(?board)、按 slug 生成数据路径。
 *
 * 数据布局（build_latest.py 产出）：
 *   data/<slug>/dates.json
 *   data/<slug>/latest_ranks.json
 *   data/<slug>/market_summary.json
 *   data/<slug>/snapshots/ranks_YYYYMMDD.json
 *   data/<slug>/trends/YYYY-MM-DD.json
 *   api/<slug>/lastest.json, api/<slug>/lastest/all.json
 *   api/boards.json  —— 仅含已有数据的榜单
 *
 * 两级 Tab 结构：channel(female/male) × type(new/read) → slug "<channel>-<type>"。
 */
(function (global) {
    'use strict';

    const DEFAULT_SLUG = 'female-new';
    const STORAGE_KEY = 'fq_board';
    const cacheBuster = `v=${Math.floor(Date.now() / 600000)}`;

    // slug 拆解 + 中文标签。两级 Tab 用到。
    const CHANNELS = [
        { key: 'female', label: '女频' },
        { key: 'male', label: '男频' },
    ];
    const TYPES = [
        { key: 'new', label: '新书榜' },
        { key: 'read', label: '阅读榜' },
    ];

    function slugOf(channel, type) {
        return `${channel}-${type}`;
    }

    function fetchJson(url) {
        return fetch(url).then(r => {
            if (!r.ok) throw new Error(`Failed to load ${url}`);
            return r.json();
        });
    }

    /** 读取 api/boards.json；失败时退化为只有默认女频新书榜。 */
    function loadBoards() {
        return fetchJson(`api/boards.json?${cacheBuster}`)
            .then(data => (data && Array.isArray(data.boards) && data.boards.length)
                ? data.boards
                : [{ slug: DEFAULT_SLUG, name: '女频新书榜', channel: 'female' }])
            .catch(() => [{ slug: DEFAULT_SLUG, name: '女频新书榜', channel: 'female' }]);
    }

    /** 当前选中的 slug：优先 URL ?board，其次 localStorage，最后默认。 */
    function currentSlug(availableSlugs) {
        const params = new URLSearchParams(global.location.search);
        const fromUrl = params.get('board');
        const fromStore = safeGet(STORAGE_KEY);
        const candidates = [fromUrl, fromStore, DEFAULT_SLUG];
        if (availableSlugs && availableSlugs.length) {
            for (const c of candidates) {
                if (c && availableSlugs.includes(c)) return c;
            }
            return availableSlugs[0];
        }
        return fromUrl || fromStore || DEFAULT_SLUG;
    }

    /** 切换 slug：同步 URL（不刷新历史）+ 记忆。 */
    function setSlug(slug) {
        safeSet(STORAGE_KEY, slug);
        const url = new URL(global.location.href);
        url.searchParams.set('board', slug);
        global.history.replaceState(null, '', url);
    }

    /** 把当前 board 透传到目标链接（如 book.html）。 */
    function withBoard(href, slug) {
        const url = new URL(href, global.location.href);
        url.searchParams.set('board', slug);
        return url.pathname.split('/').pop() + url.search + url.hash;
    }

    /** 路径工厂：所有数据/接口路径按 slug 命名空间。 */
    function paths(slug) {
        const base = `data/${slug}`;
        return {
            dates: `${base}/dates.json?${cacheBuster}`,
            latest: `${base}/latest_ranks.json?${cacheBuster}`,
            market: `${base}/market_summary.json?${cacheBuster}`,
            snapshot: dateStr => `${base}/snapshots/ranks_${String(dateStr).replace(/-/g, '')}.json?${cacheBuster}`,
            trend: dateStr => `${base}/trends/${dateStr}.json?${cacheBuster}`,
            apiIndex: `api/${slug}/lastest.json?${cacheBuster}`,
            apiAll: `api/${slug}/lastest/all.json?${cacheBuster}`,
        };
    }

    function safeGet(key) {
        try { return global.localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, val) {
        try { global.localStorage.setItem(key, val); } catch (e) { /* ignore */ }
    }

    /**
     * 渲染两级 Tab 到指定容器。
     * @param {HTMLElement} container 挂载点
     * @param {Array} boards api/boards.json 的 boards
     * @param {string} activeSlug 当前选中
     * @param {(slug:string)=>void} onSelect 选择回调
     */
    function renderTabs(container, boards, activeSlug, onSelect) {
        const available = new Set(boards.map(b => b.slug));
        const active = activeSlug.split('-');
        const activeChannel = active[0];
        const activeType = active[1];

        const channelRow = CHANNELS.map(ch => {
            const enabled = TYPES.some(t => available.has(slugOf(ch.key, t.key)));
            const isActive = ch.key === activeChannel;
            return `<button class="board-tab board-tab-channel${isActive ? ' active' : ''}"
                type="button" data-channel="${ch.key}"${enabled ? '' : ' disabled'}>${ch.label}</button>`;
        }).join('');

        const typeRow = TYPES.map(t => {
            const slug = slugOf(activeChannel, t.key);
            const enabled = available.has(slug);
            const isActive = t.key === activeType;
            return `<button class="board-tab board-tab-type${isActive ? ' active' : ''}"
                type="button" data-type="${t.key}"${enabled ? '' : ' disabled'}>${t.label}</button>`;
        }).join('');

        container.innerHTML = `
            <div class="board-tab-row board-tab-channels">${channelRow}</div>
            <div class="board-tab-row board-tab-types">${typeRow}</div>
        `;

        container.querySelectorAll('.board-tab-channel').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                const ch = btn.dataset.channel;
                // 切频道后，沿用当前榜单类型；若该类型在新频道无数据，回退到该频道首个可用类型
                let type = activeType;
                if (!available.has(slugOf(ch, type))) {
                    const firstType = TYPES.find(t => available.has(slugOf(ch, t.key)));
                    type = firstType ? firstType.key : type;
                }
                onSelect(slugOf(ch, type));
            });
        });
        container.querySelectorAll('.board-tab-type').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                onSelect(slugOf(activeChannel, btn.dataset.type));
            });
        });
    }

    global.Boards = {
        DEFAULT_SLUG,
        cacheBuster,
        fetchJson,
        loadBoards,
        currentSlug,
        setSlug,
        withBoard,
        paths,
        renderTabs,
        boardName(boards, slug) {
            const b = boards.find(x => x.slug === slug);
            return b ? b.name : slug;
        },
    };
})(window);
