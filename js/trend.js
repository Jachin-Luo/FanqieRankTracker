document.addEventListener('DOMContentLoaded', () => {
    const categoryButtons = document.getElementById('trend-category-buttons');
    const subtitle = document.getElementById('trend-subtitle');
    const rangeButtons = document.querySelectorAll('.range-btn');
    const boardTabs = document.getElementById('board-tabs');

    let boards = [];
    let currentSlug = Boards.DEFAULT_SLUG;
    let P = Boards.paths(currentSlug);

    let categories = [];
    let trendRows = [];
    let latestData = null;
    let marketSummaryData = null;
    let selectedCategory = '';
    let selectedDays = 7;

    const els = {
        marketSummary: document.getElementById('market-summary'),
        marketSource: document.getElementById('market-source'),
        hotGenres: document.getElementById('hot-genre-list'),
        hotTypes: document.getElementById('hot-type-list'),
        hotThemes: document.getElementById('hot-theme-list'),
        newBooks: document.getElementById('new-books-list'),
        risers: document.getElementById('risers-list'),
        reads: document.getElementById('reads-list'),
        summaries: document.getElementById('summary-feed'),
    };

    bindRangeEvents();
    bootstrap();

    function bootstrap() {
        Boards.loadBoards().then(list => {
            boards = list;
            currentSlug = Boards.currentSlug(boards.map(b => b.slug));
            Boards.setSlug(currentSlug);
            P = Boards.paths(currentSlug);
            renderBoardTabs();
            loadBoardData();
        });
    }

    function renderBoardTabs() {
        if (!boardTabs) return;
        Boards.renderTabs(boardTabs, boards, currentSlug, slug => {
            if (slug === currentSlug) return;
            currentSlug = slug;
            Boards.setSlug(slug);
            P = Boards.paths(slug);
            selectedCategory = '';
            renderBoardTabs();
            loadBoardData();
        });
        const back = document.querySelector('.back-link');
        if (back) back.href = `index.html?board=${encodeURIComponent(currentSlug)}`;
    }

    async function loadBoardData() {
        try {
            const [dateIndex, latestIndex, latestAll, marketSummary] = await Promise.all([
                Boards.fetchJson(P.dates).catch(() => ({ dates: [] })),
                Boards.fetchJson(P.apiIndex).catch(() => null),
                Boards.fetchJson(P.apiAll).catch(() => Boards.fetchJson(P.latest)),
                Boards.fetchJson(P.market).catch(() => null),
            ]);
            latestData = latestAll;
            marketSummaryData = marketSummary;

            categories = latestIndex && latestIndex.types
                ? latestIndex.types.filter(item => item.type !== 'all').map(item => item.type)
                : (latestAll.categories || []).map(cat => cat.name);

            const dates = (dateIndex.dates || []).slice().sort();
            const trendDates = dates.slice(1);
            const trendFiles = await Promise.all(
                trendDates.map(date => Boards.fetchJson(P.trend(date)).catch(() => null))
            );
            trendRows = trendFiles
                .filter(Boolean)
                .map(item => ({ date: item.date, prevDate: item.prev_date, trends: item.trends || {} }))
                .sort((a, b) => a.date.localeCompare(b.date));

            if (categories.length === 0) {
                renderEmpty('暂无可分析的数据。');
                return;
            }

            selectedCategory = getInitialCategory();
            renderCategoryButtons();
            render();
        } catch (err) {
            console.error(err);
            renderEmpty('趋势数据加载失败，请稍后刷新重试。');
        }
    }

    function bindRangeEvents() {
        rangeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                rangeButtons.forEach(item => item.classList.remove('active'));
                btn.classList.add('active');
                selectedDays = btn.dataset.days === 'all' ? 'all' : Number(btn.dataset.days);
                render();
            });
        });
    }

    function getInitialCategory() {
        const params = new URLSearchParams(window.location.search);
        const type = params.get('type');
        return categories.includes(type) ? type : categories[0];
    }

    function renderCategoryButtons() {
        categoryButtons.innerHTML = categories.map(name => `
            <button class="category-chip${name === selectedCategory ? ' active' : ''}" type="button" data-type="${escapeAttr(name)}">
                ${escapeHtml(name)}
            </button>
        `).join('');

        categoryButtons.querySelectorAll('.category-chip').forEach(btn => {
            btn.addEventListener('click', () => selectCategory(btn.dataset.type));
        });
    }

    function selectCategory(type) {
        if (!categories.includes(type)) return;
        selectedCategory = type;
        const url = new URL(window.location.href);
        url.searchParams.set('type', selectedCategory);
        history.replaceState(null, '', url);
        renderCategoryButtons();
        render();
    }

    function render() {
        renderMarketBoard();

        const rows = getWindowRows()
            .map(row => ({
                date: row.date,
                prevDate: row.prevDate,
                trend: row.trends[selectedCategory] || null,
            }))
            .filter(row => row.trend);

        subtitle.textContent = rows.length
            ? `${selectedCategory} · ${rows[0].date} 至 ${rows[rows.length - 1].date} · ${rows.length} 个观察日`
            : `${selectedCategory} · 暂无趋势数据`;

        renderList(els.reads, collectReads(rows));
        renderList(els.newBooks, collectNewBooks(rows));
        renderList(els.risers, collectRisers(rows));
        renderSummaries(rows);
    }

    function getWindowRows() {
        if (selectedDays === 'all') return trendRows;
        return trendRows.slice(-selectedDays);
    }

    // ========== 全站热点：直接渲染 build 算好的 market_summary（按周期）==========
    function renderMarketBoard() {
        const periodKey = selectedDays === 'all' ? 'all' : String(selectedDays);
        const periodLabel = selectedDays === 'all' ? '全部样本' : `近 ${selectedDays} 日`;
        const data = marketSummaryData && marketSummaryData.periods
            ? marketSummaryData.periods[periodKey]
            : null;

        const hotGenres = (data && data.hot_genres) || [];
        const hotTypes = (data && data.hot_types) || [];
        const hotThemes = (data && data.hot_themes) || [];

        if (!hotTypes.length) {
            els.marketSummary.textContent = (data && data.summary) || '暂无足够数据判断全站热点。';
            els.marketSource.textContent = data && data.source === 'ai'
                ? `AI 总结 · ${data.period || periodLabel}` : '暂无数据';
            els.hotGenres.innerHTML = '<p class="muted-line">暂无数据。</p>';
            els.hotTypes.innerHTML = '<p class="muted-line">暂无数据。</p>';
            els.hotThemes.innerHTML = '<p class="muted-line">暂无数据。</p>';
            return;
        }

        els.marketSummary.textContent = data.summary || data.fallback_summary || '';
        els.marketSource.textContent = data.source === 'ai'
            ? `AI 总结 · ${data.period || periodLabel}`
            : `规则统计 · ${data.period || periodLabel}`;

        els.hotGenres.innerHTML = hotGenres.slice(0, 5).map((item, index) => `
            <div class="hot-type-row hot-type-row-static genre-row">
                <span>${index + 1}</span>
                <strong>${escapeHtml(item.name)}</strong>
                <small>${escapeHtml((item.categories || []).join(' / '))} · 新增在读 ${formatReads(item.read_growth_total)} · 增长作品 ${item.read_count || 0}</small>
                <em>${formatReads(item.read_growth_total)}</em>
            </div>
        `).join('');

        els.hotTypes.innerHTML = hotTypes.slice(0, 6).map((item, index) => `
            <button class="hot-type-row" type="button" data-type="${escapeAttr(item.name)}">
                <span>${index + 1}</span>
                <strong>${escapeHtml(item.name)}</strong>
                <small>新增在读 ${formatReads(item.read_growth_total)} · 增长作品 ${item.read_count || 0}</small>
                <em>${formatReads(item.read_growth_total)}</em>
            </button>
        `).join('');

        els.hotTypes.querySelectorAll('.hot-type-row').forEach(btn => {
            btn.addEventListener('click', () => selectCategory(btn.dataset.type));
        });

        els.hotThemes.innerHTML = hotThemes.slice(0, 14).map(item => `
            <span class="theme-chip" title="新书 ${item.count} 本，覆盖 ${item.category_count || 0} 个类型">
                ${escapeHtml(item.name)} <small>${item.count}</small>
            </span>
        `).join('');
    }

    function buildLatestBookMap() {
        const bookMap = new Map();
        const latestCategories = latestData && latestData.categories ? latestData.categories : [];
        latestCategories.forEach(cat => {
            (cat.books || []).forEach(book => {
                if (book.title) bookMap.set(book.title, book);
            });
        });
        return bookMap;
    }

    function extractBookId(url) {
        const match = String(url || '').match(/\/page\/(\d+)/);
        return match ? match[1] : '';
    }

    function collectNewBooks(rows) {
        const items = [];
        rows.slice().reverse().forEach(row => {
            (row.trend.new_books || []).forEach(title => {
                items.push({ title, meta: row.date, value: '新上榜' });
            });
        });
        return items.slice(0, 12);
    }

    function collectRisers(rows) {
        const scoreMap = new Map();
        rows.forEach(row => {
            (row.trend.top_risers || []).forEach(item => {
                const current = scoreMap.get(item.title) || { title: item.title, score: 0, dates: [] };
                current.score += parseChange(item.change);
                current.dates.push(`${row.date} ${item.change}`);
                scoreMap.set(item.title, current);
            });
        });
        return Array.from(scoreMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map(item => ({ title: item.title, meta: item.dates.slice(-2).join(' / '), value: `+${item.score}` }));
    }

    function collectReads(rows) {
        const scoreMap = new Map();
        rows.forEach(row => {
            (row.trend.reads_growth || []).forEach(item => {
                const current = scoreMap.get(item.title) || { title: item.title, score: 0, dates: [] };
                current.score += parseReadsGrowth(item.growth);
                current.dates.push(`${row.date} ${item.growth}`);
                scoreMap.set(item.title, current);
            });
        });
        return Array.from(scoreMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, 10)
            .map(item => ({ title: item.title, meta: item.dates.slice(-2).join(' / '), value: formatReads(item.score) }));
    }

    function renderList(container, items) {
        if (!items.length) {
            container.innerHTML = '<p class="muted-line">暂无明显信号。</p>';
            return;
        }

        const latestBookMap = buildLatestBookMap();

        container.innerHTML = items.map(item => {
            const book = latestBookMap.get(item.title) || {};
            const bookId = extractBookId(book.url);
            const detailUrl = bookId
                ? `book.html?board=${encodeURIComponent(currentSlug)}&id=${encodeURIComponent(bookId)}`
                : `book.html?board=${encodeURIComponent(currentSlug)}&title=${encodeURIComponent(item.title)}`;

            return `
            <a class="compact-row compact-row-link" href="${detailUrl}" target="_blank" rel="noopener noreferrer">
                <div>
                    <strong>${escapeHtml(item.title)}</strong>
                    <small>${escapeHtml(item.meta)}</small>
                </div>
                <span>${escapeHtml(item.value)}</span>
            </a>
        `;
        }).join('');
    }

    function renderSummaries(rows) {
        const rowsWithSummary = rows
            .slice()
            .reverse()
            .filter(row => row.trend.summary)
            .slice(0, 10);

        if (!rowsWithSummary.length) {
            els.summaries.innerHTML = '<p class="muted-line">暂无摘要数据。</p>';
            return;
        }

        els.summaries.innerHTML = rowsWithSummary.map(row => `
            <article class="summary-item">
                <time>${escapeHtml(row.date)}</time>
                <div>${renderMarkdown(row.trend.summary)}</div>
            </article>
        `).join('');
    }

    function renderEmpty(message) {
        subtitle.textContent = message;
        els.marketSummary.textContent = message;
        els.marketSource.textContent = '暂无数据';
        els.hotGenres.innerHTML = '<p class="muted-line">暂无数据。</p>';
        els.hotTypes.innerHTML = '<p class="muted-line">暂无数据。</p>';
        els.hotThemes.innerHTML = '<p class="muted-line">暂无数据。</p>';
        [els.newBooks, els.risers, els.reads, els.summaries].forEach(el => {
            el.innerHTML = '<p class="muted-line">暂无数据。</p>';
        });
    }

    function parseChange(value) {
        return Number(String(value || '0').replace('+', '')) || 0;
    }

    function parseReadsGrowth(value) {
        const raw = String(value || '0').replace('+', '').replace(',', '').trim();
        const num = parseFloat(raw);
        if (Number.isNaN(num)) return 0;
        return raw.includes('万') ? num * 10000 : num;
    }

    function formatReads(value) {
        const num = Number(value || 0);
        if (num >= 10000) return `+${(num / 10000).toFixed(1)}万`;
        return `+${Math.round(num)}`;
    }

    function renderMarkdown(text) {
        let html = escapeHtml(text);
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/《(.+?)》/g, '<span class="book-mark">《$1》</span>');
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    function escapeHtml(str) {
        return String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    function escapeAttr(str) {
        return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
});
