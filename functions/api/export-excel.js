/**
 * Cloudflare Pages Function — /api/export-excel
 *
 * HOW TO DEPLOY:
 *   1. In your GitHub repo, create the folder:  functions/api/
 *   2. Drop this file in as:                    functions/api/export-excel.js
 *   3. Push to GitHub — Cloudflare auto-deploys it
 *   4. It will be live at:                      https://ranksorcery.com/api/export-excel
 *
 * NO npm install needed. Zero dependencies. Works natively in Cloudflare.
 */

export async function onRequestPost(context) {
  try {
    const { results = [], auditDate } = await context.request.json();
    const today = auditDate || new Date().toISOString().slice(0, 10);
    const dateLabel = new Date(today).toLocaleDateString('en-AU', { year: 'numeric', month: 'long', day: 'numeric' });

    // ── Stats ────────────────────────────────────────────────────────────────
    const done     = results.filter(r => r.status === 'done');
    const errored  = results.filter(r => r.status === 'error');
    const scores   = done.map(r => parseInt(r.score)).filter(s => !isNaN(s));
    const avgScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
    const gradeA   = scores.filter(s => s >= 90).length;
    const gradeB   = scores.filter(s => s >= 80 && s < 90).length;
    const gradeC   = scores.filter(s => s >= 70 && s < 80).length;
    const gradeD   = scores.filter(s => s >= 60 && s < 70).length;
    const gradeF   = scores.filter(s => s < 60).length;
    const totalIss = results.reduce((s, r) => s + (r.data?.suggestions?.length || 0), 0);
    const avgIss   = done.length ? Math.round(totalIss / done.length) : 0;

    const issueCounts = {};
    results.forEach(r => {
      (r.data?.suggestions || []).filter(s => s.priority === 'high').slice(0, 3).forEach(s => {
        const t = s.title || s.text || '';
        if (t) issueCounts[t] = (issueCounts[t] || 0) + 1;
      });
    });
    const topIssues = Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    // ── Colours ──────────────────────────────────────────────────────────────
    // ARGB hex strings for openpyxl-style fills
    const C = {
      DARK:     'FF080C12', DARK2:    'FF0F1622', DARK3:    'FF182035', DARK4:    'FF1E2A45',
      GOLD:     'FFE8B84B', MUTED:    'FF8A93A8', WHITE:    'FFECF0F8',
      TEAL:     'FF0ABFBC',
      GREEN_T:  'FF1A7A4A', GREEN_L:  'FFE6F7EF', GREEN_B:  'FF2DBD85',
      GREEN_B2: 'FFD1F0E2',
      RED_T:    'FFC0392B', RED_L:    'FFFEF0F0',
      AMBER_T:  'FF92640A', AMBER_L:  'FFFFF8E6', AMBER_B:  'FFFFF3D6',
      BLUE_T:   'FF1A5FB4',
      BODY:     'FF1A1A2E', MUTED2:   'FF444444',
      GREY_ROW: 'FFF4F6FA', GREY_ALT: 'FFFAFBFD',
      SECTION:  'FFEEF1F8', SPACER:   'FFF0F2F7',
      WHITE2:   'FFFFFFFF',
    };

    function scoreStyle(score) {
      const s = parseInt(score);
      if (isNaN(s)) return { tc: C.MUTED, bg: 'FFF0F0F0', grade: '—' };
      if (s >= 90)  return { tc: C.GREEN_T, bg: C.GREEN_L,  grade: 'A' };
      if (s >= 80)  return { tc: C.GREEN_T, bg: C.GREEN_B2, grade: 'B' };
      if (s >= 70)  return { tc: C.AMBER_T, bg: C.AMBER_L,  grade: 'C' };
      if (s >= 60)  return { tc: C.AMBER_T, bg: C.AMBER_B,  grade: 'D' };
      return               { tc: C.RED_T,   bg: C.RED_L,    grade: 'F' };
    }

    // ── XLSX builder (pure JS, no deps) ──────────────────────────────────────
    // xlsx = a ZIP containing XML files. We build each XML string manually.

    // Shared strings table (dedup all string values)
    const sharedStrings = [];
    const ssMap = {};
    function ss(str) {
      const s = String(str ?? '');
      if (ssMap[s] === undefined) { ssMap[s] = sharedStrings.length; sharedStrings.push(s); }
      return ssMap[s];
    }

    // Style helpers — we'll build a styles.xml with indexed fills/fonts/borders
    // For simplicity we encode colour directly via inline styles using xf/dxf
    // Instead: use a pre-built styles.xml with named styles and reference by index

    // Cell reference helper
    function colLetter(n) { // 1-based
      let s = '';
      while (n > 0) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
      return s;
    }
    function cellRef(col, row) { return colLetter(col) + row; }

    // ── Build worksheet XML ───────────────────────────────────────────────────
    // Each cell: { v: value, t: type ('s'=shared string,'n'=number,'b'=bool), s: styleIdx, href: url }
    // We'll build a styles array and reference by index

    // ══ STYLES.XML ════════════════════════════════════════════════════════════
    // Pre-define all the styles we need as indexed xf entries
    // numFmtId 0=General, 164=custom date
    // We define fills, fonts, borders, then xf combos

    const stylesXml = buildStylesXml();

    // Style index constants (must match order in buildStylesXml)
    const S = {
      DEFAULT:      0,
      HDR_TITLE:    1,  // gold bold large on dark
      HDR_SUB:      2,  // muted italic on dark
      HDR_COL:      3,  // white bold on dark3
      KPI_LABEL:    4,  // muted small on dark3
      KPI_VALUE_TEAL:5,
      KPI_VALUE_GOLD:6,
      KPI_VALUE_RED: 7,
      KPI_VALUE_AMB: 8,
      KPI_DESC:     9,
      SECTION_HDR:  10,
      GRADE_A:      11,
      GRADE_B:      12,
      GRADE_C:      13,
      GRADE_D:      14,
      GRADE_F:      15,
      GREEN_BOLD:   16,
      RED_BOLD:     17,
      AMBER_BOLD:   18,
      MUTED_CENTER: 19,
      BODY_LEFT:    20,
      BODY_CENTER:  21,
      BODY_RIGHT:   22,
      URL_CELL:     23,
      TTFB_GREEN:   24,
      TTFB_AMBER:   25,
      TTFB_RED:     26,
      ISSUES_GREEN: 27,
      ISSUES_AMBER: 28,
      ISSUES_RED:   29,
      HIGH_CELL:    30,
      MED_CELL:     31,
      LOW_CELL:     32,
      ISSUE_TXT:    33,
      SPACER:       34,
      SECTION_BG:   35,
      ALT_ROW:      36,
      HTTPS_YES:    37,
      HTTPS_NO:     38,
      GUIDE_LABEL:  39,
      GUIDE_SECTION:40,
      GUIDE_DESC:   41,
      DARK_LEFT:    42,
      DATE_CELL:    43,
    };

    // ══ SHEET 1: Summary ══════════════════════════════════════════════════════
    function buildSummarySheet() {
      const rows = [];

      function r(rowNum, cells) { rows.push({ r: rowNum, cells }); }
      function c(col, val, styleIdx, isNum) {
        return { col, val, s: styleIdx, isNum: !!isNum };
      }

      // Row 1: Title
      r(1, [c(1, `⚡  RankSorcery — Bulk SEO Audit Report`, S.HDR_TITLE)]);
      // Row 2: Subtitle
      r(2, [c(1, `  Generated: ${dateLabel}  ·  ${done.length} sites audited  ·  Powered by RankSorcery AI`, S.HDR_SUB)]);
      // Row 3: spacer (no cells needed, just styled via sheetFormatPr)
      r(3, [c(1, '', S.SPACER)]);

      // Rows 4-6: KPI cards — B/D/F/H cols (2,4,6,8)
      const kpiStyles = [S.KPI_VALUE_TEAL, S.KPI_VALUE_GOLD, S.KPI_VALUE_RED, S.KPI_VALUE_AMB];
      const kpiLabels = ['Sites Audited', 'Avg SEO Score', 'Total Issues', 'Avg Issues/Site'];
      const kpiVals   = [done.length, avgScore, totalIss, avgIss];
      const kpiDescs  = ['Successfully scanned', 'Average across all sites', 'Issues across all sites', 'Average per site'];
      [2,4,6,8].forEach((col, i) => {
        r(4, [c(col, kpiLabels[i], S.KPI_LABEL)]);
        r(5, [c(col, kpiVals[i],   kpiStyles[i], true)]);
        r(6, [c(col, kpiDescs[i],  S.KPI_DESC)]);
      });

      // Row 7: spacer
      r(7, [c(1, '', S.SPACER)]);

      // Row 8: Score Breakdown header
      r(8, [c(1, '  SCORE BREAKDOWN', S.SECTION_HDR)]);

      const breakdown = [
        { label: '🟢  Grade A  (90–100)', count: gradeA, gs: S.GRADE_A },
        { label: '🟢  Grade B  (80–89)',  count: gradeB, gs: S.GRADE_B },
        { label: '🟡  Grade C  (70–79)',  count: gradeC, gs: S.GRADE_C },
        { label: '🟡  Grade D  (60–69)',  count: gradeD, gs: S.GRADE_D },
        { label: '🔴  Grade F  (0–59)',   count: gradeF, gs: S.GRADE_F },
      ];
      breakdown.forEach(({ label, count, gs }, i) => {
        r(9 + i, [c(1, label, gs), c(3, count, gs, true)]);
      });

      // Spacer + Top issues
      r(15, [c(1, '', S.SPACER)]);
      r(16, [c(1, '  TOP RECURRING ISSUES (High Priority)', S.SECTION_HDR)]);
      topIssues.forEach(([issue, count], i) => {
        const bg = i % 2 === 0 ? S.BODY_LEFT : S.ALT_ROW;
        r(17 + i, [c(1, `  ${issue}`, bg), c(8, `${count} sites`, S.HIGH_CELL)]);
      });

      return sheetXml(rows, [
        { min:1, max:1, width:3  },
        { min:2, max:2, width:24 },
        { min:3, max:3, width:3  },
        { min:4, max:4, width:24 },
        { min:5, max:5, width:3  },
        { min:6, max:6, width:24 },
        { min:7, max:7, width:3  },
        { min:8, max:8, width:24 },
        { min:9, max:9, width:3  },
      ], [
        { ref: 'A1:I1', ht: 52 },
        { ref: 'A2:I2', ht: 24 },
        { ref: 'A3:I3', ht: 10 },
        { ref: 'A4:I4', ht: 18 },
        { ref: 'A5:I5', ht: 48 },
        { ref: 'A6:I6', ht: 20 },
        { ref: 'A7:I7', ht: 14 },
        { ref: 'A8:I8', ht: 28 },
      ], [
        // merges
        'A1:I1','A2:I2','A3:I3',
        'A8:I8',
        'A9:B9','A10:B10','A11:B11','A12:B12','A13:B13',
        'A15:I15','A16:I16',
        'A17:G17','A18:G18','A19:G19','A20:G20','A21:G21',
        // KPI merges across spacer cols
      ]);
    }

    // ══ SHEET 2: Audit Data ═══════════════════════════════════════════════════
    function buildAuditSheet() {
      const rows = [];
      function r(rowNum, cells) { rows.push({ r: rowNum, cells }); }
      function c(col, val, styleIdx, isNum, href) {
        return { col, val, s: styleIdx, isNum: !!isNum, href };
      }

      const headers = [
        '#','Website URL','SEO Score','Grade','CMS / Platform','HTTPS','Mobile Ready',
        'TTFB (ms)','Word Count','Title Length','Meta Desc Length',
        'Total Issues','🔴 High','🟡 Medium','🟢 Low',
        'Top Issue #1','Top Issue #2','Top Issue #3','Audit Date'
      ];

      // Row 1: title
      r(1, [c(1, '  📋  Full Audit Data — All Sites', S.HDR_TITLE)]);
      // Row 2: headers
      r(2, headers.map((h, i) => c(i + 1, h, S.HDR_COL)));

      results.forEach((res, idx) => {
        const rowNum = idx + 3;
        const bg = rowNum % 2 === 0 ? S.ALT_ROW : S.BODY_CENTER;
        const bgL = rowNum % 2 === 0 ? S.ALT_ROW : S.BODY_LEFT;
        const pd = res.pageData || {};
        const suggs = res.data?.suggestions || [];
        const highs = suggs.filter(s => s.priority === 'high');
        const meds  = suggs.filter(s => s.priority === 'medium');
        const lows  = suggs.filter(s => s.priority === 'low');
        const { tc, bg: scoreBg, grade } = scoreStyle(res.score);
        const scoreStyleIdx = res.score >= 90 ? S.GRADE_A : res.score >= 80 ? S.GRADE_B
          : res.score >= 70 ? S.GRADE_C : res.score >= 60 ? S.GRADE_D : S.GRADE_F;

        const httpsYes = pd.isHttps !== false;
        const mobYes   = !!pd.hasViewport;
        const ttfb     = pd.ttfb;
        const ttfbS    = ttfb < 800 ? S.TTFB_GREEN : ttfb < 1800 ? S.TTFB_AMBER : (ttfb ? S.TTFB_RED : bg);
        const tot      = suggs.length;
        const totS     = tot >= 15 ? S.ISSUES_RED : tot >= 10 ? S.ISSUES_AMBER : tot <= 5 ? S.ISSUES_GREEN : bg;

        r(rowNum, [
          c(1,  idx + 1,                                           S.MUTED_CENTER, true),
          c(2,  res.url,                                           S.URL_CELL, false, res.url),
          c(3,  res.status === 'error' ? 'ERROR' : (res.score ?? '—'), scoreStyleIdx, !isNaN(parseInt(res.score))),
          c(4,  res.status === 'error' ? '—' : grade,             scoreStyleIdx),
          c(5,  res.cms?.cms || '—',                              bg),
          c(6,  httpsYes ? 'Yes' : 'No',                          httpsYes ? S.HTTPS_YES : S.HTTPS_NO),
          c(7,  mobYes   ? 'Yes' : 'No',                          mobYes   ? S.HTTPS_YES : S.HTTPS_NO),
          c(8,  ttfb || '',                                        ttfbS, true),
          c(9,  pd.wordCount || '',                                bg, true),
          c(10, pd.title?.length || '',                            bg, true),
          c(11, pd.metaDesc?.length || '',                         bg, true),
          c(12, tot,                                               totS, true),
          c(13, highs.length, highs.length > 0 ? S.HIGH_CELL : bg, true),
          c(14, meds.length,  meds.length  > 0 ? S.MED_CELL  : bg, true),
          c(15, lows.length,  lows.length  > 0 ? S.LOW_CELL  : bg, true),
          c(16, highs[0]?.title || highs[0]?.text || '',           S.ISSUE_TXT),
          c(17, highs[1]?.title || highs[1]?.text || '',           S.ISSUE_TXT),
          c(18, highs[2]?.title || highs[2]?.text || '',           S.ISSUE_TXT),
          c(19, today,                                             S.DATE_CELL),
        ]);
      });

      const colWidths = [5,36,11,8,18,9,10,11,12,13,15,12,10,10,10,40,40,40,13].map((w,i) => ({
        min: i+1, max: i+1, width: w
      }));
      const rowHeights = [
        { ref:'A1:S1', ht:36 },
        { ref:'A2:S2', ht:36 },
      ];
      results.forEach((_, i) => rowHeights.push({ ref:`A${i+3}:S${i+3}`, ht:22 }));

      return sheetXml(rows, colWidths, rowHeights, [], 'A2', results.length + 2);
    }

    // ══ SHEET 3: Quick Wins ════════════════════════════════════════════════════
    function buildQuickWinsSheet() {
      const rows = [];
      function r(rowNum, cells) { rows.push({ r: rowNum, cells }); }
      function c(col, val, s, isNum, href) { return { col, val, s, isNum: !!isNum, href }; }

      r(1, [c(1, '  🎯  Quick Wins — Fix These First', S.HDR_TITLE)]);
      r(2, [c(1, '  Sites with High Priority issues — sorted by most critical first', S.HDR_SUB)]);
      r(3, ['#','URL','SEO Score','High Issues','Top Issue'].map((h, i) => c(i+1, h, S.HDR_COL)));

      const highSites = results
        .filter(r => (r.data?.suggestions || []).filter(s => s.priority === 'high').length > 0)
        .sort((a, b) => {
          const ah = (a.data?.suggestions||[]).filter(s=>s.priority==='high').length;
          const bh = (b.data?.suggestions||[]).filter(s=>s.priority==='high').length;
          return bh - ah;
        });

      highSites.forEach((res, idx) => {
        const rowNum = idx + 4;
        const bg = rowNum % 2 === 0 ? S.ALT_ROW : S.BODY_CENTER;
        const highs = (res.data?.suggestions||[]).filter(s=>s.priority==='high');
        const ss2 = res.score >= 90 ? S.GRADE_A : res.score >= 80 ? S.GRADE_B
          : res.score >= 70 ? S.GRADE_C : res.score >= 60 ? S.GRADE_D : S.GRADE_F;
        r(rowNum, [
          c(1, idx+1,             S.MUTED_CENTER, true),
          c(2, res.url,           S.URL_CELL, false, res.url),
          c(3, res.score ?? '—',  ss2, !isNaN(parseInt(res.score))),
          c(4, highs.length,      S.HIGH_CELL, true),
          c(5, highs[0]?.title||highs[0]?.text||'', S.ISSUE_TXT),
        ]);
      });

      const colWidths = [{min:1,max:1,width:4},{min:2,max:2,width:36},{min:3,max:3,width:11},{min:4,max:4,width:12},{min:5,max:5,width:42}];
      return sheetXml(rows, colWidths, [{ref:'A1:E1',ht:36},{ref:'A2:E2',ht:22},{ref:'A3:E3',ht:32}], []);
    }

    // ══ SHEET 4: Guide ═════════════════════════════════════════════════════════
    function buildGuideSheet() {
      const rows = [];
      function r(rowNum, cells) { rows.push({ r: rowNum, cells }); }
      function c(col, val, s) { return { col, val, s }; }

      r(1, [c(1, '  ℹ️  How To Read This Report', S.HDR_TITLE)]);
      const guide = [
        ['',       '',                    ''],
        ['SCORES', 'Grade A  (90–100)',   'Excellent — site is fully optimised. Focus on content strategy.'],
        ['',       'Grade B  (80–89)',    'Good — minor technical fixes needed. Review medium issues.'],
        ['',       'Grade C  (70–79)',    'Fair — moderate gaps. Prioritise all High Priority issues first.'],
        ['',       'Grade D  (60–69)',    'Needs Work — significant issues. Fix all High issues urgently.'],
        ['',       'Grade F  (<60)',      'Poor — site needs a full SEO overhaul. Start immediately.'],
        ['',       '',                    ''],
        ['PRIORITY','🔴 High',            'Fix immediately — these issues actively suppress your rankings.'],
        ['',       '🟡 Medium',           'Fix this week — meaningful improvements to rankings and UX.'],
        ['',       '🟢 Low',              'Nice to have — smaller optimisation gains after High/Med.'],
        ['',       '',                    ''],
        ['COLUMNS','TTFB (ms)',            'Time To First Byte. Green <800ms · Amber <1800ms · Red 1800ms+'],
        ['',       'Title Length',         'Ideal: 50–60 characters for best Google SERP display.'],
        ['',       'Meta Desc Length',     'Ideal: 120–155 characters. Longer gets cut off in Google.'],
        ['',       'Word Count',           'Content pages should aim for 600+ words minimum.'],
        ['',       'HTTPS',                'Green = secure. Red = no SSL — critical issue, fix immediately.'],
        ['',       'Mobile Ready',         'Green = mobile-optimised. Red = no viewport meta tag.'],
        ['',       '',                    ''],
        ['EXPORT', 'How to export',        'Run audit at ranksorcery.com/bulk-audit → click ⬇ Download Excel Report'],
        ['',       'Daily tracking',       'Save each export with the date in filename to track progress over time.'],
      ];
      guide.forEach(([sec, label, desc], i) => {
        const rowNum = i + 2;
        const bg = i % 2 === 0 ? S.ALT_ROW : S.BODY_LEFT;
        r(rowNum, [
          c(1, sec,   sec ? S.GUIDE_SECTION : bg),
          c(2, label, S.GUIDE_LABEL),
          c(3, desc,  S.GUIDE_DESC),
        ]);
      });
      const colWidths = [{min:1,max:1,width:10},{min:2,max:2,width:26},{min:3,max:3,width:56}];
      return sheetXml(rows, colWidths, [{ref:'A1:C1',ht:36}], []);
    }

    // ══ Generic sheetXml builder ══════════════════════════════════════════════
    function sheetXml(rowData, colWidths, rowHeights, merges, freezeRow, autoFilterMaxRow) {
      // Group cells by row
      const byRow = {};
      rowData.forEach(({ r, cells }) => {
        cells.forEach(cell => {
          if (!byRow[r]) byRow[r] = [];
          byRow[r].push(cell);
        });
      });

      const allRows = Object.keys(byRow).sort((a, b) => +a - +b);
      const rowHtMap = {};
      rowHeights.forEach(({ ref, ht }) => {
        const row = parseInt(ref.match(/\d+/));
        rowHtMap[row] = ht;
      });

      let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
           xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
`;
      // Freeze pane
      if (freezeRow) {
        xml += `<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>\n`;
      } else {
        xml += `<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>\n`;
      }

      // Column widths
      if (colWidths.length) {
        xml += `<cols>\n`;
        colWidths.forEach(({ min, max, width }) => {
          xml += `<col min="${min}" max="${max}" width="${width}" customWidth="1"/>\n`;
        });
        xml += `</cols>\n`;
      }

      xml += `<sheetData>\n`;
      allRows.forEach(rowNum => {
        const ht = rowHtMap[+rowNum] ? ` ht="${rowHtMap[+rowNum]}" customHeight="1"` : '';
        xml += `<row r="${rowNum}"${ht}>\n`;
        byRow[rowNum].sort((a, b) => a.col - b.col).forEach(({ col, val, s, isNum, href }) => {
          const ref = cellRef(col, rowNum);
          const str = String(val ?? '');
          if (str === '' && !isNum) {
            xml += `<c r="${ref}" s="${s}"><v></v></c>\n`;
            return;
          }
          if (isNum && !isNaN(parseFloat(str))) {
            xml += `<c r="${ref}" t="n" s="${s}"><v>${parseFloat(str)}</v></c>\n`;
          } else {
            const idx = ss(str);
            xml += `<c r="${ref}" t="s" s="${s}"><v>${idx}</v></c>\n`;
          }
        });
        xml += `</row>\n`;
      });
      xml += `</sheetData>\n`;

      // Merges
      if (merges && merges.length) {
        xml += `<mergeCells count="${merges.length}">\n`;
        merges.forEach(m => { xml += `<mergeCell ref="${m}"/>\n`; });
        xml += `</mergeCells>\n`;
      }

      // Autofilter
      if (autoFilterMaxRow) {
        xml += `<autoFilter ref="A2:S${autoFilterMaxRow}"/>\n`;
      }

      xml += `</worksheet>`;
      return xml;
    }

    // ══ styles.xml ════════════════════════════════════════════════════════════
    function buildStylesXml() {
      // We define all fonts, fills, borders, then xf combos
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="20">
  <font><sz val="10"/><name val="Arial"/><color rgb="FF1A1A2E"/></font>
  <font><b/><sz val="20"/><name val="Arial"/><color rgb="FFE8B84B"/></font>
  <font><sz val="10"/><name val="Arial"/><color rgb="FF8A93A8"/><i/></font>
  <font><b/><sz val="9"/><name val="Arial"/><color rgb="FFECF0F8"/></font>
  <font><b/><sz val="8"/><name val="Arial"/><color rgb="FF8A93A8"/></font>
  <font><b/><sz val="28"/><name val="Arial"/><color rgb="FF0ABFBC"/></font>
  <font><b/><sz val="28"/><name val="Arial"/><color rgb="FFE8B84B"/></font>
  <font><b/><sz val="28"/><name val="Arial"/><color rgb="FFE05555"/></font>
  <font><b/><sz val="28"/><name val="Arial"/><color rgb="FFF5A623"/></font>
  <font><sz val="8"/><name val="Arial"/><color rgb="FF8A93A8"/><i/></font>
  <font><b/><sz val="11"/><name val="Arial"/><color rgb="FF1A1A2E"/></font>
  <font><b/><sz val="11"/><name val="Arial"/><color rgb="FF1A7A4A"/></font>
  <font><b/><sz val="11"/><name val="Arial"/><color rgb="FF92640A"/></font>
  <font><b/><sz val="11"/><name val="Arial"/><color rgb="FFC0392B"/></font>
  <font><b/><sz val="10"/><name val="Arial"/><color rgb="FF1A7A4A"/></font>
  <font><b/><sz val="10"/><name val="Arial"/><color rgb="FFC0392B"/></font>
  <font><b/><sz val="10"/><name val="Arial"/><color rgb="FF92640A"/></font>
  <font><sz val="9"/><name val="Arial"/><color rgb="FF1A5FB4"/><u/></font>
  <font><sz val="8"/><name val="Arial"/><color rgb="FF8A93A8"/></font>
  <font><b/><sz val="10"/><name val="Arial"/><color rgb="FF8A93A8"/></font>
</fonts>
<fills count="30">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF080C12"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF182035"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF1E2A45"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE6F7EF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFD1F0E2"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E6"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFF3D6"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFEF0F0"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF4F6FA"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFAFBFD"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFEEF1F8"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFF0F2F7"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FF0F1622"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="44">
<!-- 0  DEFAULT      --><xf numFmtId="0" fontId="0"  fillId="15" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 1  HDR_TITLE    --><xf numFmtId="0" fontId="1"  fillId="2"  borderId="0" xfId="0"><alignment horizontal="left"   vertical="center"/></xf>
<!-- 2  HDR_SUB      --><xf numFmtId="0" fontId="2"  fillId="2"  borderId="0" xfId="0"><alignment horizontal="left"   vertical="center"/></xf>
<!-- 3  HDR_COL      --><xf numFmtId="0" fontId="3"  fillId="3"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<!-- 4  KPI_LABEL    --><xf numFmtId="0" fontId="4"  fillId="3"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 5  KPI_TEAL     --><xf numFmtId="0" fontId="5"  fillId="4"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 6  KPI_GOLD     --><xf numFmtId="0" fontId="6"  fillId="4"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 7  KPI_RED      --><xf numFmtId="0" fontId="7"  fillId="4"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 8  KPI_AMBER    --><xf numFmtId="0" fontId="8"  fillId="4"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 9  KPI_DESC     --><xf numFmtId="0" fontId="9"  fillId="3"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 10 SECTION_HDR  --><xf numFmtId="0" fontId="10" fillId="12" borderId="0" xfId="0"><alignment horizontal="left"   vertical="center"/></xf>
<!-- 11 GRADE_A      --><xf numFmtId="0" fontId="11" fillId="5"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 12 GRADE_B      --><xf numFmtId="0" fontId="11" fillId="6"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 13 GRADE_C      --><xf numFmtId="0" fontId="12" fillId="7"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 14 GRADE_D      --><xf numFmtId="0" fontId="12" fillId="8"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 15 GRADE_F      --><xf numFmtId="0" fontId="13" fillId="9"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 16 GREEN_BOLD   --><xf numFmtId="0" fontId="14" fillId="5"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 17 RED_BOLD     --><xf numFmtId="0" fontId="15" fillId="9"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 18 AMBER_BOLD   --><xf numFmtId="0" fontId="16" fillId="7"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 19 MUTED_CENTER --><xf numFmtId="0" fontId="18" fillId="15" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 20 BODY_LEFT    --><xf numFmtId="0" fontId="0"  fillId="15" borderId="1" xfId="0"><alignment horizontal="left"   vertical="center"/></xf>
<!-- 21 BODY_CENTER  --><xf numFmtId="0" fontId="0"  fillId="15" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 22 BODY_RIGHT   --><xf numFmtId="0" fontId="0"  fillId="15" borderId="1" xfId="0"><alignment horizontal="right"  vertical="center"/></xf>
<!-- 23 URL_CELL     --><xf numFmtId="0" fontId="17" fillId="15" borderId="1" xfId="0"><alignment horizontal="left"   vertical="center"/></xf>
<!-- 24 TTFB_GREEN   --><xf numFmtId="0" fontId="14" fillId="5"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 25 TTFB_AMBER   --><xf numFmtId="0" fontId="16" fillId="7"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 26 TTFB_RED     --><xf numFmtId="0" fontId="15" fillId="9"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 27 ISSUES_GREEN --><xf numFmtId="0" fontId="14" fillId="5"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 28 ISSUES_AMBER --><xf numFmtId="0" fontId="16" fillId="7"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 29 ISSUES_RED   --><xf numFmtId="0" fontId="15" fillId="9"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 30 HIGH_CELL    --><xf numFmtId="0" fontId="15" fillId="9"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 31 MED_CELL     --><xf numFmtId="0" fontId="16" fillId="7"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 32 LOW_CELL     --><xf numFmtId="0" fontId="14" fillId="5"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 33 ISSUE_TXT    --><xf numFmtId="0" fontId="0"  fillId="15" borderId="1" xfId="0"><alignment horizontal="left"   vertical="center"/></xf>
<!-- 34 SPACER       --><xf numFmtId="0" fontId="0"  fillId="13" borderId="0" xfId="0"></xf>
<!-- 35 SECTION_BG   --><xf numFmtId="0" fontId="0"  fillId="12" borderId="0" xfId="0"></xf>
<!-- 36 ALT_ROW      --><xf numFmtId="0" fontId="0"  fillId="10" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 37 HTTPS_YES    --><xf numFmtId="0" fontId="14" fillId="5"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 38 HTTPS_NO     --><xf numFmtId="0" fontId="15" fillId="9"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 39 GUIDE_LABEL  --><xf numFmtId="0" fontId="10" fillId="15" borderId="1" xfId="0"><alignment horizontal="left"   vertical="center"/></xf>
<!-- 40 GUIDE_SECTION--><xf numFmtId="0" fontId="3"  fillId="3"  borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
<!-- 41 GUIDE_DESC   --><xf numFmtId="0" fontId="0"  fillId="15" borderId="1" xfId="0"><alignment horizontal="left"   vertical="center" wrapText="1"/></xf>
<!-- 42 DARK_LEFT    --><xf numFmtId="0" fontId="0"  fillId="2"  borderId="0" xfId="0"><alignment horizontal="left"   vertical="center"/></xf>
<!-- 43 DATE_CELL    --><xf numFmtId="0" fontId="18" fillId="15" borderId="1" xfId="0"><alignment horizontal="center" vertical="center"/></xf>
</cellXfs>
</styleSheet>`;
    }

    // ── Shared strings XML ────────────────────────────────────────────────────
    // Call sheet builders first so all strings are registered
    const sheet1 = buildSummarySheet();
    const sheet2 = buildAuditSheet();
    const sheet3 = buildQuickWinsSheet();
    const sheet4 = buildGuideSheet();

    const ssXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
${sharedStrings.map(s => `<si><t xml:space="preserve">${escXml(s)}</t></si>`).join('\n')}
</sst>`;

    function escXml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    }

    // ── workbook.xml ──────────────────────────────────────────────────────────
    const wbXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>
<sheet name="📊 Summary"    sheetId="1" r:id="rId1"/>
<sheet name="📋 Audit Data" sheetId="2" r:id="rId2"/>
<sheet name="🎯 Quick Wins" sheetId="3" r:id="rId3"/>
<sheet name="ℹ️ Guide"      sheetId="4" r:id="rId4"/>
</sheets>
</workbook>`;

    const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/>
<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/>
<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

    const pkgRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml"  ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml"            ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml"   ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet2.xml"   ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet3.xml"   ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/worksheets/sheet4.xml"   ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/sharedStrings.xml"       ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
<Override PartName="/xl/styles.xml"              ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

    // ── ZIP builder (pure JS) ─────────────────────────────────────────────────
    function strToBytes(str) {
      return new TextEncoder().encode(str);
    }

    function buildZip(files) {
      // files: [{name, data: Uint8Array}]
      const enc = new TextEncoder();
      const localHeaders = [];
      const centralDirs  = [];
      let offset = 0;

      function crc32(buf) {
        let crc = 0xFFFFFFFF;
        const table = crc32.table || (crc32.table = (() => {
          const t = new Uint32Array(256);
          for (let i = 0; i < 256; i++) {
            let c = i;
            for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[i] = c;
          }
          return t;
        })());
        for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
      }

      function u16(n) { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; }
      function u32(n) { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; }

      function concat(...arrs) {
        const total = arrs.reduce((s, a) => s + a.length, 0);
        const out = new Uint8Array(total);
        let pos = 0;
        arrs.forEach(a => { out.set(a, pos); pos += a.length; });
        return out;
      }

      const parts = [];

      files.forEach(({ name, data }) => {
        const nameBytes = enc.encode(name);
        const crc = crc32(data);
        const local = concat(
          new Uint8Array([0x50,0x4B,0x03,0x04]), // sig
          u16(20), u16(0), u16(0),               // version, flags, method (stored)
          u16(0), u16(0),                        // mod time, mod date
          u32(crc), u32(data.length), u32(data.length),
          u16(nameBytes.length), u16(0),
          nameBytes, data
        );
        localHeaders.push({ name: nameBytes, crc, size: data.length, offset });
        parts.push(local);
        offset += local.length;
      });

      const cdStart = offset;
      localHeaders.forEach(({ name: nameBytes, crc, size, offset: loff }) => {
        const cd = concat(
          new Uint8Array([0x50,0x4B,0x01,0x02]),
          u16(20), u16(20), u16(0), u16(0),
          u16(0), u16(0),
          u32(crc), u32(size), u32(size),
          u16(nameBytes.length), u16(0), u16(0),
          u16(0), u16(0), u32(0),
          u32(loff), nameBytes
        );
        parts.push(cd);
        offset += cd.length;
      });

      const cdSize = offset - cdStart;
      const eocd = concat(
        new Uint8Array([0x50,0x4B,0x05,0x06]),
        u16(0), u16(0),
        u16(files.length), u16(files.length),
        u32(cdSize), u32(cdStart),
        u16(0)
      );
      parts.push(eocd);

      return concat(...parts);
    }

    const enc = str => new TextEncoder().encode(str);
    const zipFiles = [
      { name: '[Content_Types].xml',          data: enc(contentTypes) },
      { name: '_rels/.rels',                  data: enc(pkgRels) },
      { name: 'xl/workbook.xml',              data: enc(wbXml) },
      { name: 'xl/_rels/workbook.xml.rels',   data: enc(wbRels) },
      { name: 'xl/styles.xml',                data: enc(stylesXml) },
      { name: 'xl/sharedStrings.xml',         data: enc(ssXml) },
      { name: 'xl/worksheets/sheet1.xml',     data: enc(sheet1) },
      { name: 'xl/worksheets/sheet2.xml',     data: enc(sheet2) },
      { name: 'xl/worksheets/sheet3.xml',     data: enc(sheet3) },
      { name: 'xl/worksheets/sheet4.xml',     data: enc(sheet4) },
    ];

    const xlsxBytes = buildZip(zipFiles);
    const filename  = `RankSorcery-Bulk-SEO-Audit-${today}.xlsx`;

    return new Response(xlsxBytes, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': xlsxBytes.length.toString(),
        'Cache-Control': 'no-store',
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
