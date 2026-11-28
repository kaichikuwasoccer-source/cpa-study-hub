/**
 * CPA Study Hub - パーソナル改善コーチ 定量メトリクス計算エンジン（全55指標 M01〜M55 ＋ 教材3タイプ分類 ＋ 自己進化カスタム指標）
 * ゼロビルド（Vanilla JS / ES2020）構成。既存の 10パターンAPI（evaluateCpaCoachRules / computeCpaSessionMatrix）も後方互換維持。
 */
(function (global) {
  'use strict';

  // =========================================================================
  // 0. 共通ユーティリティ & 教材3タイプ自動分類ロジック
  // =========================================================================
  const MATERIAL_TYPE_META = {
    lecture: { key: 'lecture', label: '講義', fullLabel: '講義（受動インプット）', color: '#8b5cf6' },
    text: { key: 'text', label: 'テキスト・論証', fullLabel: 'テキスト・論証（精読・暗記）', color: '#0ea5e9' },
    drill: { key: 'drill', label: '回転教材', fullLabel: '回転教材（演習アウトプット）', color: '#10b981' }
  };

  const LECTURE_RE = /講義|web|動画|視聴|受講|入門|レギュラー/i;
  const DRILL_RE = /問題集|短答|計算|答練|過去問|個別|総合|一問一答|トレ/i;
  const TEXT_RE = /テキスト|コンサマ|論証|条文|基準|まとめ|板書/i;

  function classifyStudyMaterialType(subject, material, topic, memo, overrides) {
    const ov = overrides || {};
    const key1 = `${subject || ''}::${material || ''}`;
    const key2 = String(material || '');
    if (ov[key1] && MATERIAL_TYPE_META[ov[key1]]) return ov[key1];
    if (key2 && ov[key2] && MATERIAL_TYPE_META[ov[key2]]) return ov[key2];

    const matStr = String(material || '');
    const restStr = `${topic || ''} ${memo || ''}`;

    // まず教材名(material)で明示的判定
    if (matStr) {
      if (LECTURE_RE.test(matStr)) return 'lecture';
      if (DRILL_RE.test(matStr)) return 'drill';
      if (TEXT_RE.test(matStr)) return 'text';
    }
    // 次に topic + memo で判定
    if (restStr.trim()) {
      if (LECTURE_RE.test(restStr)) return 'lecture';
      if (DRILL_RE.test(restStr)) return 'drill';
      if (TEXT_RE.test(restStr)) return 'text';
    }
    // 該当なしは「テキスト・その他」
    return 'text';
  }

  function parseTimeToMins(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(min)) return null;
    return h * 60 + min;
  }

  function parseHourFromTimeStr(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) : null;
  }

  function ratingToCode(r) {
    const s = String(r || '');
    if (s.includes('◎')) return '◎';
    if (s.includes('○')) return '○';
    if (s.includes('△')) return '△';
    return '';
  }

  function ratingToScore(r) {
    const c = ratingToCode(r);
    if (c === '◎') return 3;
    if (c === '○') return 2;
    if (c === '△') return 1;
    return null;
  }

  function getTimeBand(hour) {
    if (hour === null) return 'day';
    if (hour >= 5 && hour <= 11) return 'morning';
    if (hour >= 12 && hour <= 17) return 'day';
    return 'night';
  }

  function defaultGetSubjectType(subject) {
    const s = String(subject || '');
    if (/計算|管理会計|租税法|数学|物理|化学/.test(s)) return 'calc';
    return 'theory';
  }

  function parseDateISO(dateStr) {
    if (!dateStr) return null;
    const norm = String(dateStr).replace(/\//g, '-').slice(0, 10);
    const d = new Date(`${norm}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }

  function fmtDateISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function diffDays(dateStrA, dateStrB) {
    const a = parseDateISO(dateStrA);
    const b = parseDateISO(dateStrB);
    if (!a || !b) return null;
    return Math.round((b - a) / 86400000);
  }

  function getWeekKey(dateStr) {
    const d = parseDateISO(dateStr);
    if (!d) return '';
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return fmtDateISO(d);
  }

  function parseDeviation(rankStr, score, maxScore) {
    const s = String(rankStr || '');
    const m = s.match(/偏差値\s*[:：]?\s*(\d+(?:\.\d+)?)/);
    if (m) return Number(m[1]);
    // 偏差値記載がない場合、素点率から簡易推定（60%≒偏差値50, ±10%≒±5）
    if (Number.isFinite(Number(score)) && Number(maxScore) > 0) {
      const pct = (Number(score) / Number(maxScore)) * 100;
      return Math.round((50 + (pct - 60) * 0.5) * 10) / 10;
    }
    return null;
  }

  function avg(arr) {
    if (!arr || !arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function round1(n) {
    return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
  }

  function pct(part, total) {
    if (!total) return null;
    return Math.round((part / total) * 1000) / 10;
  }

  function pearson(xs, ys) {
    if (!xs || xs.length < 3 || xs.length !== ys.length) return null;
    const mx = avg(xs);
    const my = avg(ys);
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < xs.length; i++) {
      const dx = xs[i] - mx;
      const dy = ys[i] - my;
      num += dx * dy;
      dx2 += dx * dx;
      dy2 += dy * dy;
    }
    if (dx2 === 0 || dy2 === 0) return null;
    return Math.round((num / Math.sqrt(dx2 * dy2)) * 100) / 100;
  }

  function formatTimeMin(mins) {
    if (!Number.isFinite(mins)) return '--:--';
    const norm = ((Math.round(mins) % 1440) + 1440) % 1440;
    return `${String(Math.floor(norm / 60)).padStart(2, '0')}:${String(norm % 60).padStart(2, '0')}`;
  }

  function topicMatches(textA, textB) {
    const a = String(textA || '').trim().toLowerCase();
    const b = String(textB || '').trim().toLowerCase();
    if (!a || !b) return false;
    if (a.includes(b) || b.includes(a)) return true;
    const tokensA = a.split(/[\s　・,、/（）()]+/).filter(t => t.length >= 2);
    return tokensA.some(t => b.includes(t));
  }

  // =========================================================================
  // 1. カテゴリ定義 & 分析濃度マッピング
  // =========================================================================
  const METRIC_CATEGORIES = [
    { id: 'A', name: '時間帯・生体リズムと集中度', metricIds: ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07'] },
    { id: 'B', name: '1クールの持続時間・疲労曲線', metricIds: ['M08', 'M09', 'M10', 'M11', 'M12', 'M13'] },
    { id: 'C', name: '計画（カレンダー予実）と見積もりの癖', metricIds: ['M14', 'M15', 'M16', 'M17', 'M18', 'M19', 'M20'] },
    { id: 'D', name: '学習内容の偏りと成績相関', metricIds: ['M21', 'M22', 'M23', 'M24', 'M25', 'M26', 'M27', 'M28', 'M29', 'M30', 'M31', 'M32', 'M33', 'M34', 'M35', 'M36'] },
    { id: 'E', name: '答練・模試での本番力と失点プロファイル', metricIds: ['M37', 'M38', 'M39', 'M40', 'M41', 'M42', 'M43'] },
    { id: 'F', name: '試験カウントダウン連動の勉強内容変化', metricIds: ['M44', 'M45', 'M46', 'M47', 'M48', 'M49'] },
    { id: 'G', name: '継続性・習慣・コンディション予兆', metricIds: ['M50', 'M51', 'M52', 'M53', 'M54', 'M55'] }
  ];

  const DEPTH_GROUPS = {
    daily: ['M01', 'M02', 'M03', 'M04', 'M05', 'M07', 'M08', 'M09', 'M10', 'M45', 'M53'],
    weekly: ['M06', 'M11', 'M12', 'M13', 'M14', 'M15', 'M16', 'M17', 'M18', 'M19', 'M20', 'M23', 'M25', 'M30', 'M31', 'M36', 'M42', 'M52'],
    monthly: ['M21', 'M22', 'M24', 'M26', 'M27', 'M28', 'M29', 'M32', 'M33', 'M34', 'M35', 'M44', 'M45', 'M46', 'M47', 'M48', 'M49', 'M50', 'M51', 'M54', 'M55'],
    latest_exam: ['M28', 'M29', 'M32', 'M34', 'M35', 'M37', 'M38', 'M39', 'M40', 'M41', 'M42', 'M43']
  };

  function getCategoryName(catId) {
    const found = METRIC_CATEGORIES.find(c => c.id === catId);
    return found ? found.name : 'カスタム指標';
  }

  function makeMetric(id, category, name, payload, weights) {
    const w = weights && weights[id] !== undefined ? Number(weights[id]) : 1.0;
    return {
      id,
      category,
      categoryName: getCategoryName(category),
      name,
      status: payload.status || 'insufficient_data',
      value: payload.value ?? null,
      summary: payload.summary || 'データ不足（記録が蓄積されると自動算出されます）',
      advice: payload.advice || '',
      weight: Number.isFinite(w) ? w : 1.0,
      actionHint: payload.actionHint || null
    };
  }

  // =========================================================================
  // 2. 全55指標（M01〜M55）＋ カスタム指標 自動計算エンジン
  // =========================================================================
  function computeAll55Metrics(input) {
    const getSubjectType = input.getSubjectType || defaultGetSubjectType;
    const overrides = input.materialTypeOverrides || (input.coachProfile && input.coachProfile.material_type_overrides) || {};
    const coachProfile = input.coachProfile || {};
    const weights = coachProfile.base_weights || {};

    const todayDate = input.now ? new Date(input.now) : new Date();
    todayDate.setHours(0, 0, 0, 0);
    const todayISO = fmtDateISO(todayDate);

    // 正規化ログ
    const logs = (input.logs || [])
      .filter(l => l && l.date && Number(l.minutes) > 0)
      .map(l => {
        const startMin = parseTimeToMins(l.start_time);
        const endMin = parseTimeToMins(l.end_time);
        const startHour = startMin !== null ? Math.floor(startMin / 60) % 24 : (endMin !== null ? Math.floor(endMin / 60) % 24 : null);
        const rCode = ratingToCode(l.rating);
        const mType = classifyStudyMaterialType(l.subject, l.material, l.topic, l.memo, overrides);
        return {
          date: String(l.date).replace(/\//g, '-').slice(0, 10),
          subject: String(l.subject || ''),
          material: String(l.material || ''),
          topic: String(l.topic || ''),
          memo: String(l.memo || ''),
          minutes: Number(l.minutes) || 0,
          ratingCode: rCode,
          ratingScore: ratingToScore(rCode),
          start_time: String(l.start_time || ''),
          end_time: String(l.end_time || ''),
          startMin,
          endMin,
          startHour,
          subjectType: getSubjectType(l.subject),
          materialType: mType,
          weekKey: getWeekKey(l.date)
        };
      })
      .sort((a, b) => `${a.date} ${a.start_time || '99:99'}`.localeCompare(`${b.date} ${b.start_time || '99:99'}`));

    // 正規化答練・成績
    const exams = (input.exams || [])
      .filter(e => e && e.date)
      .map(e => ({
        ...e,
        date: String(e.date).replace(/\//g, '-').slice(0, 10),
        score: Number(e.score) || 0,
        maxScore: Number(e.maxScore) || 100,
        deviation: parseDeviation(e.rank, e.score, e.maxScore || 100)
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const detailedExams = (input.examDetailedResults || [])
      .filter(e => e && e.date)
      .map(e => ({
        ...e,
        date: String(e.date).replace(/\//g, '-').slice(0, 10),
        score: Number(e.score) || 0,
        maxScore: Number(e.maxScore) || 100,
        deviation: parseDeviation(e.rank, e.score, e.maxScore || 100)
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const mistakes = (input.mistakes || []).filter(m => m && m.subject);
    const reviewedSet = new Set(input.reviewedMistakeIds || []);
    const calendarEvents = (input.calendarEvents || []).filter(ev => ev && ev.date && Number(ev.mins) > 0);
    const calendarDoneMap = input.calendarDoneMap || {};
    const subjects = (input.subjects && input.subjects.length)
      ? input.subjects
      : Array.from(new Set(logs.map(l => l.subject).filter(Boolean)));

    // 直近試験カウントダウン
    let nearestExam = null;
    let daysToExam = null;
    (input.countdowns || []).forEach(c => {
      const d = parseDateISO(c.date);
      if (!d) return;
      const diff = Math.ceil((d - todayDate) / 86400000);
      if (diff >= 0 && (daysToExam === null || diff < daysToExam)) {
        daysToExam = diff;
        nearestExam = { ...c, daysLeft: diff };
      }
    });

    // 日別集計
    const logsByDate = {};
    logs.forEach(l => {
      if (!logsByDate[l.date]) logsByDate[l.date] = [];
      logsByDate[l.date].push(l);
    });
    const activeDates = Object.keys(logsByDate).sort();
    const dailyTotals = {};
    activeDates.forEach(d => {
      dailyTotals[d] = logsByDate[d].reduce((s, l) => s + l.minutes, 0);
    });
    const avgDailyMins = activeDates.length ? avg(Object.values(dailyTotals)) : 0;

    // 科目別最新偏差値マップ
    const latestDevBySubject = {};
    const allExamsCombined = [...exams, ...detailedExams].sort((a, b) => a.date.localeCompare(b.date));
    allExamsCombined.forEach(ex => {
      if (ex.subject && ex.deviation !== null) {
        latestDevBySubject[ex.subject] = ex.deviation;
      }
    });

    // 3タイプ全体比率
    const typeTotals = { lecture: 0, text: 0, drill: 0 };
    logs.forEach(l => { typeTotals[l.materialType] = (typeTotals[l.materialType] || 0) + l.minutes; });
    const totalAllMins = logs.reduce((s, l) => s + l.minutes, 0);

    const ratedLogs = logs.filter(l => l.ratingCode !== '');
    const overallGreatRate = ratedLogs.length
      ? pct(ratedLogs.filter(l => l.ratingCode === '◎').length, ratedLogs.length)
      : null;

    const metrics = {};

    // =========================================================================
    // 【カテゴリA：時間帯・生体リズムと集中度（M01〜M07）】
    // =========================================================================
    // M01 ゴールデンタイム特定率
    (() => {
      const hourBuckets = {};
      logs.forEach(l => {
        if (l.startHour === null || !l.ratingCode) return;
        const slot = Math.floor(l.startHour / 2) * 2; // 2時間枠
        if (!hourBuckets[slot]) hourBuckets[slot] = { total: 0, great: 0, poor: 0 };
        hourBuckets[slot].total++;
        if (l.ratingCode === '◎') hourBuckets[slot].great++;
        if (l.ratingCode === '△') hourBuckets[slot].poor++;
      });
      const validSlots = Object.entries(hourBuckets)
        .filter(([, b]) => b.total >= 2)
        .map(([slot, b]) => ({
          slot: Number(slot),
          label: `${String(slot).padStart(2, '0')}:00〜${String((Number(slot) + 2) % 24).padStart(2, '0')}:00`,
          greatRate: pct(b.great, b.total),
          poorRate: pct(b.poor, b.total),
          count: b.total
        }))
        .sort((a, b) => b.greatRate - a.greatRate);

      if (!validSlots.length || overallGreatRate === null) {
        metrics.M01 = makeMetric('M01', 'A', 'ゴールデンタイム特定率', { status: 'insufficient_data' }, weights);
      } else {
        const best = validSlots[0];
        const diffPt = round1(best.greatRate - overallGreatRate);
        metrics.M01 = makeMetric('M01', 'A', 'ゴールデンタイム特定率', {
          status: diffPt >= 10 ? 'strength' : 'normal',
          value: { bestSlot: best.label, greatRate: best.greatRate, overallGreatRate, diffPt, count: best.count },
          summary: `${best.label}が◎率 ${best.greatRate}%（全体平均比 ${diffPt >= 0 ? '+' : ''}${diffPt}pt）`,
          advice: `最も深く集中できる${best.label}に、配点比重の高い回転教材や苦手論点を固定配置しましょう。`,
          actionHint: { type: 'calendar', suggestedTime: `${String(best.slot).padStart(2, '0')}:00`, label: `${best.label}に最重要科目を予約` }
        }, weights);
      }

      // M02 魔の失速時間帯（スランプゾーン）
      const slumpSorted = [...validSlots].sort((a, b) => b.poorRate - a.poorRate);
      if (!slumpSorted.length) {
        metrics.M02 = makeMetric('M02', 'A', '魔の失速時間帯（スランプゾーン）', { status: 'insufficient_data' }, weights);
      } else {
        const worst = slumpSorted[0];
        metrics.M02 = makeMetric('M02', 'A', '魔の失速時間帯（スランプゾーン）', {
          status: worst.poorRate >= 45 ? 'alert' : worst.poorRate >= 30 ? 'warning' : 'normal',
          value: { slumpSlot: worst.label, poorRate: worst.poorRate, count: worst.count },
          summary: `${worst.label}の△率が最高 ${worst.poorRate}%（${worst.count}件中）`,
          advice: worst.poorRate >= 30
            ? `${worst.label}は眠気・散漫が出やすい時間帯です。15分仮眠や軽めのインプット・計算反復に切り替えましょう。`
            : `大きな失速時間帯は見られず、時間帯コンディションは安定しています。`
        }, weights);
      }
    })();

    // M03 夜更かし翌日ペナルティ
    (() => {
      const lateDates = new Set();
      logs.forEach(l => {
        if (l.startHour !== null && l.startHour >= 0 && l.startHour <= 3) {
          lateDates.add(l.date);
        }
      });
      if (!lateDates.size || activeDates.length < 3) {
        metrics.M03 = makeMetric('M03', 'A', '夜更かし翌日ペナルティ', { status: 'insufficient_data' }, weights);
        return;
      }
      const morningMinsAfterLate = [], morningPoorAfterLate = [];
      const morningMinsNormal = [], morningPoorNormal = [];
      activeDates.forEach(d => {
        const dt = parseDateISO(d);
        const prev = new Date(dt.getTime() - 86400000);
        const prevISO = fmtDateISO(prev);
        // 深夜0-3時記録はその日自体の午前中に影響するケースと翌日ケースの両方を対象
        const isAfterLate = lateDates.has(d) || lateDates.has(prevISO);
        const amLogs = (logsByDate[d] || []).filter(l => l.startHour !== null && l.startHour >= 5 && l.startHour <= 11);
        const amMins = amLogs.reduce((s, l) => s + l.minutes, 0);
        const amRated = amLogs.filter(l => l.ratingCode);
        const amPoor = amRated.length ? pct(amRated.filter(l => l.ratingCode === '△').length, amRated.length) : null;
        if (isAfterLate) {
          morningMinsAfterLate.push(amMins);
          if (amPoor !== null) morningPoorAfterLate.push(amPoor);
        } else {
          morningMinsNormal.push(amMins);
          if (amPoor !== null) morningPoorNormal.push(amPoor);
        }
      });
      if (!morningMinsAfterLate.length || !morningMinsNormal.length) {
        metrics.M03 = makeMetric('M03', 'A', '夜更かし翌日ペナルティ', { status: 'insufficient_data' }, weights);
      } else {
        const avgLate = avg(morningMinsAfterLate);
        const avgNorm = avg(morningMinsNormal);
        const dropPct = avgNorm > 0 ? round1(((avgNorm - avgLate) / avgNorm) * 100) : 0;
        const poorDiff = (morningPoorAfterLate.length && morningPoorNormal.length)
          ? round1(avg(morningPoorAfterLate) - avg(morningPoorNormal))
          : 0;
        metrics.M03 = makeMetric('M03', 'A', '夜更かし翌日ペナルティ', {
          status: dropPct >= 30 || poorDiff >= 20 ? 'alert' : dropPct >= 15 ? 'warning' : 'normal',
          value: { lateDays: lateDates.size, morningDropPct: dropPct, poorRateIncreasePt: poorDiff },
          summary: `深夜学習の翌日午前は通常日比 ${dropPct >= 0 ? '-' : '+'}${Math.abs(dropPct)}% / △率 ${poorDiff >= 0 ? '+' : ''}${poorDiff}pt`,
          advice: dropPct >= 15
            ? '24時以降の追い込みが翌朝パフォーマンスを削っています。就寝デッドラインを23:30に固定しましょう。'
            : '深夜学習による翌日午前への悪影響は軽微です。'
        }, weights);
      }
    })();

    // M04 朝スタートダッシュ遅延時間
    (() => {
      const delays = [];
      const morningPlanByDate = {};
      calendarEvents.forEach(ev => {
        const sm = parseTimeToMins(ev.start);
        if (sm !== null && sm >= 300 && sm < 660) {
          if (morningPlanByDate[ev.date] === undefined || sm < morningPlanByDate[ev.date]) {
            morningPlanByDate[ev.date] = sm;
          }
        }
      });
      Object.entries(morningPlanByDate).forEach(([date, planMin]) => {
        const dayLogs = (logsByDate[date] || []).filter(l => l.startMin !== null && l.startMin >= 300);
        if (!dayLogs.length) return;
        const firstActual = Math.min(...dayLogs.map(l => l.startMin));
        delays.push(firstActual - planMin);
      });
      if (!delays.length) {
        metrics.M04 = makeMetric('M04', 'A', '朝スタートダッシュ遅延時間', { status: 'insufficient_data' }, weights);
      } else {
        const avgDelay = Math.round(avg(delays));
        metrics.M04 = makeMetric('M04', 'A', '朝スタートダッシュ遅延時間', {
          status: avgDelay >= 30 ? 'alert' : avgDelay >= 15 ? 'warning' : avgDelay <= 5 ? 'strength' : 'normal',
          value: { avgDelayMins: avgDelay, sampleDays: delays.length },
          summary: `朝予定からの平均遅延 ${avgDelay >= 0 ? '+' : ''}${avgDelay}分（${delays.length}日平均）`,
          advice: avgDelay >= 15
            ? '朝の着手が予定より遅れがちです。前夜にテキストを開いて机に置き、最初の15分は軽い暗記から始めましょう。'
            : '朝のスタートダッシュは非常に良好です。'
        }, weights);
      }
    })();

    // M05 計算脳・理論脳の最適時間帯ギャップ
    (() => {
      const calcHours = {}, theoryHours = {};
      logs.forEach(l => {
        if (l.startHour === null || !l.ratingCode) return;
        const slot = Math.floor(l.startHour / 2) * 2;
        const map = l.subjectType === 'calc' ? calcHours : theoryHours;
        if (!map[slot]) map[slot] = { total: 0, great: 0 };
        map[slot].total++;
        if (l.ratingCode === '◎') map[slot].great++;
      });
      const pickPeak = (map) => {
        const arr = Object.entries(map)
          .filter(([, b]) => b.total >= 1)
          .map(([s, b]) => ({ slot: Number(s), rate: pct(b.great, b.total), count: b.total }))
          .sort((a, b) => b.rate - a.rate || b.count - a.count);
        return arr[0] || null;
      };
      const cPeak = pickPeak(calcHours);
      const tPeak = pickPeak(theoryHours);
      if (!cPeak || !tPeak) {
        metrics.M05 = makeMetric('M05', 'A', '計算脳・理論脳の最適時間帯ギャップ', { status: 'insufficient_data' }, weights);
      } else {
        const gapHours = Math.abs(cPeak.slot - tPeak.slot);
        metrics.M05 = makeMetric('M05', 'A', '計算脳・理論脳の最適時間帯ギャップ', {
          status: 'normal',
          value: { calcPeakHour: cPeak.slot, calcGreatRate: cPeak.rate, theoryPeakHour: tPeak.slot, theoryGreatRate: tPeak.rate, gapHours },
          summary: `計算ピーク ${String(cPeak.slot).padStart(2, '0')}時台(◎${cPeak.rate}%) vs 理論ピーク ${String(tPeak.slot).padStart(2, '0')}時台(◎${tPeak.rate}%)（差${gapHours}時間）`,
          advice: gapHours >= 2
            ? `計算は${String(cPeak.slot).padStart(2, '0')}時台、理論は${String(tPeak.slot).padStart(2, '0')}時台に配置すると脳の切り替え効率が最大化します。`
            : '計算・理論ともに同じ時間帯がピークです。交互配置で集中力を維持しましょう。'
        }, weights);
      }
    })();

    // M06 週末・休日の生活リズム崩壊度
    (() => {
      const weekdayStarts = [], weekendStarts = [];
      activeDates.forEach(d => {
        const dt = parseDateISO(d);
        const dayLogs = (logsByDate[d] || []).filter(l => l.startMin !== null && l.startMin >= 240);
        if (!dt || !dayLogs.length) return;
        const firstMin = Math.min(...dayLogs.map(l => l.startMin));
        const dow = dt.getDay();
        if (dow === 0 || dow === 6) weekendStarts.push(firstMin);
        else weekdayStarts.push(firstMin);
      });
      if (!weekdayStarts.length || !weekendStarts.length) {
        metrics.M06 = makeMetric('M06', 'A', '週末・休日の生活リズム崩壊度', { status: 'insufficient_data' }, weights);
      } else {
        const wdAvg = avg(weekdayStarts);
        const weAvg = avg(weekendStarts);
        const diffMin = Math.round(weAvg - wdAvg);
        metrics.M06 = makeMetric('M06', 'A', '週末・休日の生活リズム崩壊度', {
          status: Math.abs(diffMin) >= 90 ? 'alert' : Math.abs(diffMin) >= 45 ? 'warning' : 'strength',
          value: { weekdayAvgStart: formatTimeMin(wdAvg), weekendAvgStart: formatTimeMin(weAvg), diffMins: diffMin },
          summary: `平日平均 ${formatTimeMin(wdAvg)} / 休日平均 ${formatTimeMin(weAvg)}（差 ${diffMin >= 0 ? '+' : ''}${diffMin}分）`,
          advice: Math.abs(diffMin) >= 45
            ? '休日の開始時刻が大きくズレています。土日も平日+30分以内に机に着くルーティンを作りましょう。'
            : '平日・休日ともに生活リズムが安定しています。'
        }, weights);
      }
    })();

    // M07 スキマ時間活用率と質
    (() => {
      if (!logs.length) {
        metrics.M07 = makeMetric('M07', 'A', 'スキマ時間活用率と質', { status: 'insufficient_data' }, weights);
      } else {
        const shortLogs = logs.filter(l => l.minutes < 30);
        const shortMins = shortLogs.reduce((s, l) => s + l.minutes, 0);
        const sharePct = pct(shortMins, totalAllMins);
        const ratedShort = shortLogs.filter(l => l.ratingCode);
        const shortGreatRate = ratedShort.length ? pct(ratedShort.filter(l => l.ratingCode === '◎').length, ratedShort.length) : null;
        metrics.M07 = makeMetric('M07', 'A', 'スキマ時間活用率と質', {
          status: sharePct >= 8 && (shortGreatRate === null || shortGreatRate >= 40) ? 'strength' : 'normal',
          value: { shortCount: shortLogs.length, shortMins, sharePct, shortGreatRate },
          summary: `30分未満の割合 ${sharePct}%（${shortLogs.length}回 / ◎率 ${shortGreatRate !== null ? shortGreatRate + '%' : '--'}）`,
          advice: sharePct < 5
            ? 'スキマ時間の記録が少なめです。移動・待ち時間にコンサマや一問一答を10分回すと総回転数が底上げされます。'
            : 'スキマ時間を上手に積み上げられています。'
        }, weights);
      }
    })();

    // =========================================================================
    // 【カテゴリB：1クールの持続時間・疲労曲線（M08〜M13）】
    // =========================================================================
    const durBands = [
      { key: '0-30', label: '〜30分', min: 1, max: 30 },
      { key: '31-45', label: '31〜45分', min: 31, max: 45 },
      { key: '46-60', label: '46〜60分', min: 46, max: 60 },
      { key: '61-90', label: '61〜90分', min: 61, max: 90 },
      { key: '91-120', label: '91〜120分', min: 91, max: 120 },
      { key: '121+', label: '121分〜', min: 121, max: 9999 }
    ];
    const bandStats = durBands.map(b => {
      const items = ratedLogs.filter(l => l.minutes >= b.min && l.minutes <= b.max);
      return {
        ...b,
        count: items.length,
        greatRate: items.length ? pct(items.filter(l => l.ratingCode === '◎').length, items.length) : null,
        poorRate: items.length ? pct(items.filter(l => l.ratingCode === '△').length, items.length) : null
      };
    });

    // M08 最適1クール時間（スイートスポット）
    (() => {
      const valid = bandStats.filter(b => b.count >= 2).sort((a, b) => b.greatRate - a.greatRate);
      if (!valid.length) {
        metrics.M08 = makeMetric('M08', 'B', '最適1クール時間（スイートスポット）', { status: 'insufficient_data' }, weights);
      } else {
        const best = valid[0];
        metrics.M08 = makeMetric('M08', 'B', '最適1クール時間（スイートスポット）', {
          status: 'strength',
          value: { sweetSpot: best.label, greatRate: best.greatRate, count: best.count, bands: bandStats },
          summary: `最適1クールは「${best.label}」（◎率 ${best.greatRate}% / ${best.count}件）`,
          advice: `最も集中が乗る「${best.label}」を標準ポモドーロ／タイマー単位として設計しましょう。`,
          actionHint: { type: 'timer', minutes: Math.min(90, Math.max(25, best.max === 9999 ? 90 : best.max)), label: `最適${best.label}タイマーを開始` }
        }, weights);
      }
    })();

    // M09 集中力ドロップオフ閾値
    (() => {
      const valid = bandStats.filter(b => b.count >= 1);
      if (valid.length < 2) {
        metrics.M09 = makeMetric('M09', 'B', '集中力ドロップオフ閾値', { status: 'insufficient_data' }, weights);
      } else {
        let thresholdBand = null;
        for (let i = 1; i < valid.length; i++) {
          if (valid[i].poorRate >= 35 && (valid[i].poorRate - valid[i - 1].poorRate) >= 15) {
            thresholdBand = valid[i];
            break;
          }
        }
        if (!thresholdBand) {
          const worst = [...valid].sort((a, b) => b.poorRate - a.poorRate)[0];
          thresholdBand = worst.poorRate >= 35 ? worst : null;
        }
        metrics.M09 = makeMetric('M09', 'B', '集中力ドロップオフ閾値', {
          status: thresholdBand ? 'warning' : 'strength',
          value: thresholdBand ? { thresholdMin: thresholdBand.min, label: thresholdBand.label, poorRate: thresholdBand.poorRate } : { thresholdMin: null },
          summary: thresholdBand ? `${thresholdBand.min}分超（${thresholdBand.label}）で△率が${thresholdBand.poorRate}%へ急増` : '長時間による明確なドロップオフ未検出',
          advice: thresholdBand
            ? `1クールが${thresholdBand.min}分を超えると集中力が落ちます。${Math.max(25, thresholdBand.min - 10)}分で強制休憩を入れましょう。`
            : '長めのクールでも集中力を維持できています。'
        }, weights);
      }
    })();

    // M10 連続セッション疲労蓄積率
    (() => {
      const firstScores = [], contScores = [];
      activeDates.forEach(d => {
        const dl = logsByDate[d].filter(l => l.startMin !== null && l.ratingCode);
        let streak = 1;
        for (let i = 0; i < dl.length; i++) {
          if (i > 0) {
            const prevEnd = dl[i - 1].endMin !== null ? dl[i - 1].endMin : (dl[i - 1].startMin + dl[i - 1].minutes);
            const gap = dl[i].startMin - prevEnd;
            streak = (gap >= 0 && gap < 15) ? streak + 1 : 1;
          }
          if (streak === 1) firstScores.push(dl[i].ratingCode === '◎' ? 100 : 0);
          else contScores.push(dl[i].ratingCode === '◎' ? 100 : 0);
        }
      });
      if (firstScores.length < 2 || contScores.length < 2) {
        metrics.M10 = makeMetric('M10', 'B', '連続セッション疲労蓄積率', { status: 'insufficient_data' }, weights);
      } else {
        const fRate = round1(avg(firstScores));
        const cRate = round1(avg(contScores));
        const dropPt = round1(fRate - cRate);
        metrics.M10 = makeMetric('M10', 'B', '連続セッション疲労蓄積率', {
          status: dropPt >= 25 ? 'alert' : dropPt >= 12 ? 'warning' : 'normal',
          value: { firstCoolGreatRate: fRate, continuousGreatRate: cRate, dropPt },
          summary: `休憩15分未満の連続で◎率が ${dropPt >= 0 ? '-' : '+'}${Math.abs(dropPt)}pt（1クール目${fRate}% → 連続${cRate}%）`,
          advice: dropPt >= 12
            ? '短い休憩で連続稼働すると疲労が蓄積しています。クール間に最低15分の完全離席休憩を挟みましょう。'
            : '連続セッションでも集中力の低下が少なくタフに継続できています。'
        }, weights);
      }
    })();

    // M11 長時間学習の翌日反動（燃え尽き指数）
    (() => {
      if (activeDates.length < 5 || avgDailyMins <= 0) {
        metrics.M11 = makeMetric('M11', 'B', '長時間学習の翌日反動（燃え尽き指数）', { status: 'insufficient_data' }, weights);
      } else {
        const threshold = avgDailyMins * 1.4;
        const nextDayMins = [];
        activeDates.forEach(d => {
          if (dailyTotals[d] >= threshold) {
            const nextDt = new Date(parseDateISO(d).getTime() + 86400000);
            const nextISO = fmtDateISO(nextDt);
            if (nextISO <= todayISO) {
              nextDayMins.push(dailyTotals[nextISO] || 0);
            }
          }
        });
        if (!nextDayMins.length) {
          metrics.M11 = makeMetric('M11', 'B', '長時間学習の翌日反動（燃え尽き指数）', { status: 'insufficient_data' }, weights);
        } else {
          const avgNext = avg(nextDayMins);
          const dropMins = Math.round(avgDailyMins - avgNext);
          const dropPct = round1(((avgDailyMins - avgNext) / avgDailyMins) * 100);
          metrics.M11 = makeMetric('M11', 'B', '長時間学習の翌日反動（燃え尽き指数）', {
            status: dropPct >= 35 ? 'alert' : dropPct >= 20 ? 'warning' : 'normal',
            value: { avgDailyMins: Math.round(avgDailyMins), nextDayAvgMins: Math.round(avgNext), dropMins, dropPct, count: nextDayMins.length },
            summary: `平均の1.4倍超の翌日は ${dropPct >= 0 ? '-' : '+'}${Math.abs(dropPct)}%（${dropMins >= 0 ? '-' : '+'}${Math.abs(dropMins)}分）`,
            advice: dropPct >= 20
              ? '無理な長時間学習の翌日に反動が出ています。1日の上限時間を決め、週トータルで安定稼働させましょう。'
              : '長時間学習の翌日もペースを維持できています。'
          }, weights);
        }
      }
    })();

    // M12 科目スイッチング回復効果
    (() => {
      const sameLong = [], switched = [];
      activeDates.forEach(d => {
        const dl = logsByDate[d].filter(l => l.ratingCode);
        let sameStreakMins = 0;
        for (let i = 0; i < dl.length; i++) {
          if (i === 0) {
            sameStreakMins = dl[i].minutes;
            continue;
          }
          if (dl[i].subject === dl[i - 1].subject) {
            sameStreakMins += dl[i].minutes;
            if (sameStreakMins >= 180) sameLong.push(dl[i].ratingCode === '◎' ? 100 : 0);
          } else {
            if (dl[i - 1].minutes <= 90 && dl[i].subjectType !== dl[i - 1].subjectType) {
              switched.push(dl[i].ratingCode === '◎' ? 100 : 0);
            }
            sameStreakMins = dl[i].minutes;
          }
        }
      });
      if (!sameLong.length || !switched.length) {
        metrics.M12 = makeMetric('M12', 'B', '科目スイッチング回復効果', { status: 'insufficient_data' }, weights);
      } else {
        const sRate = round1(avg(switched));
        const lRate = round1(avg(sameLong));
        const gainPt = round1(sRate - lRate);
        metrics.M12 = makeMetric('M12', 'B', '科目スイッチング回復効果', {
          status: gainPt >= 15 ? 'strength' : 'normal',
          value: { switchedGreatRate: sRate, sameLongGreatRate: lRate, gainPt },
          summary: `計算⇔理論切替の◎率 ${sRate}% vs 同科目3h連続 ${lRate}%（差 ${gainPt >= 0 ? '+' : ''}${gainPt}pt）`,
          advice: gainPt >= 10
            ? '90分以内で計算⇔理論を切り替えると集中力が大きく回復します。交互ローテーションを標準化しましょう。'
            : '科目切替と単一科目連続で大きな差は見られません。'
        }, weights);
      }
    })();

    // M13 タイマー中断・細切れ頻度
    (() => {
      if (logs.length < 3) {
        metrics.M13 = makeMetric('M13', 'B', 'タイマー中断・細切れ頻度', { status: 'insufficient_data' }, weights);
      } else {
        let fragmented = 0;
        for (let i = 1; i < logs.length; i++) {
          const prev = logs[i - 1];
          const cur = logs[i];
          if (cur.date === prev.date && cur.subject === prev.subject && cur.material === prev.material) {
            const prevEnd = prev.endMin !== null ? prev.endMin : (prev.startMin !== null ? prev.startMin + prev.minutes : null);
            const gap = (cur.startMin !== null && prevEnd !== null) ? (cur.startMin - prevEnd) : 10;
            if (gap >= 0 && gap <= 30 && (cur.minutes < 45 || prev.minutes < 45)) {
              fragmented++;
            }
          }
        }
        const fragPct = pct(fragmented, logs.length);
        metrics.M13 = makeMetric('M13', 'B', 'タイマー中断・細切れ頻度', {
          status: fragPct >= 25 ? 'alert' : fragPct >= 15 ? 'warning' : 'normal',
          value: { fragmentedCount: fragmented, totalLogs: logs.length, fragmentedPct: fragPct },
          summary: `同一教材の細切れ分断率 ${fragPct}%（${fragmented}/${logs.length}件）`,
          advice: fragPct >= 15
            ? 'スマホ通知や割り込みでセッションが細切れになっています。機内モード＋ポモドーロで45分連続を守りましょう。'
            : 'セッションの中断が少なく、まとまった時間を確保できています。'
        }, weights);
      }
    })();

    // =========================================================================
    // 【カテゴリC：計画（カレンダー予実）と見積もりの癖（M14〜M20）】
    // =========================================================================
    const planBySubject = {}, actualBySubject30 = {};
    const thirtyDaysAgoDate = new Date(todayDate.getTime() - 30 * 86400000);
    const thirtyDaysAgoISO = fmtDateISO(thirtyDaysAgoDate);

    calendarEvents.forEach(ev => {
      if (ev.date >= thirtyDaysAgoISO && ev.date <= todayISO && ev.subject) {
        planBySubject[ev.subject] = (planBySubject[ev.subject] || 0) + ev.mins;
      }
    });
    logs.forEach(l => {
      if (l.date >= thirtyDaysAgoISO && l.date <= todayISO && l.subject) {
        actualBySubject30[l.subject] = (actualBySubject30[l.subject] || 0) + l.minutes;
      }
    });
    // カレンダーイベント配列がない場合は weekPlannedMap / weekActualMap で補完
    const hasCalEvents = calendarEvents.length > 0;
    const planMap = hasCalEvents ? planBySubject : (input.weekPlannedMap || {});
    const actMap = hasCalEvents ? actualBySubject30 : (input.weekActualMap || {});

    // M14 楽観バイアス指数
    (() => {
      const totalP = Object.values(planMap).reduce((a, b) => a + b, 0);
      const totalA = Object.values(actMap).reduce((a, b) => a + b, 0);
      if (totalP <= 0) {
        metrics.M14 = makeMetric('M14', 'C', '楽観バイアス指数', { status: 'insufficient_data' }, weights);
      } else {
        const achPct = pct(totalA, totalP);
        metrics.M14 = makeMetric('M14', 'C', '楽観バイアス指数', {
          status: achPct < 65 ? 'alert' : achPct < 80 ? 'warning' : achPct <= 115 ? 'strength' : 'normal',
          value: { achievementPct: achPct, totalActualMins: totalA, totalPlannedMins: totalP },
          summary: `予定達成率 ${achPct}%（実績 ${(totalA / 60).toFixed(1)}h / 予定 ${(totalP / 60).toFixed(1)}h）`,
          advice: achPct < 75
            ? '見積もりが楽観的です。カレンダー予定を現在の0.8倍に圧縮し、予備枠を週2時間組み込みましょう。'
            : '予定と実績の見積もり精度が良好です。'
        }, weights);
      }
    })();

    // M15 科目別見積もり誤差ランキング
    (() => {
      const diffs = subjects
        .map(s => ({ subject: s, planned: planMap[s] || 0, actual: actMap[s] || 0, diff: (actMap[s] || 0) - (planMap[s] || 0) }))
        .filter(x => x.planned > 0 || x.actual > 0)
        .sort((a, b) => a.diff - b.diff);
      if (!diffs.length) {
        metrics.M15 = makeMetric('M15', 'C', '科目別見積もり誤差ランキング', { status: 'insufficient_data' }, weights);
      } else {
        const mostBehind = diffs[0];
        const mostAhead = diffs[diffs.length - 1];
        metrics.M15 = makeMetric('M15', 'C', '科目別見積もり誤差ランキング', {
          status: mostBehind.diff <= -120 ? 'warning' : 'normal',
          value: { mostBehind, mostAhead, ranking: diffs },
          summary: `最遅れ: ${mostBehind.subject} (${Math.round(mostBehind.diff)}分) / 最超過: ${mostAhead.subject} (+${Math.round(mostAhead.diff)}分)`,
          advice: mostBehind.diff < -60
            ? `「${mostBehind.subject}」の予定遅れが最大です。1回の予定枠を小さめに設定し、着手ハードルを下げましょう。`
            : '科目間の見積もり誤差は許容範囲内です。',
          actionHint: mostBehind.diff < -60 ? { type: 'calendar', subject: mostBehind.subject, minutes: 60, label: `${mostBehind.subject}のリカバリー枠を仮組み` } : null
        }, weights);
      }
    })();

    // M16 曜日別の計画倒れ率
    (() => {
      const dowNames = ['日', '月', '火', '水', '木', '金', '土'];
      const dowPlan = [0, 0, 0, 0, 0, 0, 0];
      const dowAct = [0, 0, 0, 0, 0, 0, 0];
      calendarEvents.forEach(ev => {
        if (ev.date > todayISO) return;
        const dt = parseDateISO(ev.date);
        if (dt) dowPlan[dt.getDay()] += ev.mins;
      });
      logs.forEach(l => {
        const dt = parseDateISO(l.date);
        if (dt) dowAct[dt.getDay()] += l.minutes;
      });
      const validDows = dowNames
        .map((name, i) => ({ dow: name, planned: dowPlan[i], actual: dowAct[i], rate: dowPlan[i] > 0 ? pct(dowAct[i], dowPlan[i]) : null }))
        .filter(x => x.planned > 0);
      if (!validDows.length) {
        metrics.M16 = makeMetric('M16', 'C', '曜日別の計画倒れ率', { status: 'insufficient_data' }, weights);
      } else {
        const worst = [...validDows].sort((a, b) => a.rate - b.rate)[0];
        metrics.M16 = makeMetric('M16', 'C', '曜日別の計画倒れ率', {
          status: worst.rate < 60 ? 'alert' : worst.rate < 75 ? 'warning' : 'normal',
          value: { worstDow: worst.dow, worstRate: worst.rate, byDow: validDows },
          summary: `最も未達が大きいのは「${worst.dow}曜」（達成率 ${worst.rate}%）`,
          advice: worst.rate < 75
            ? `${worst.dow}曜は計画倒れしやすい曜日です。予定量を7割に減らすか、調整日に充てましょう。`
            : '全曜日で安定して計画を消化できています。'
        }, weights);
      }
    })();

    // M17 苦手科目の先送り（逃避）指数
    (() => {
      const weakSubjects = Object.entries(latestDevBySubject).filter(([, dev]) => dev < 50).map(([s]) => s);
      if (!weakSubjects.length) {
        metrics.M17 = makeMetric('M17', 'C', '苦手科目の先送り（逃避）指数', { status: 'insufficient_data' }, weights);
      } else {
        let plannedCount = 0, avoidedCount = 0;
        weakSubjects.forEach(s => {
          const p = planMap[s] || 0;
          const a = actMap[s] || 0;
          if (p > 0) {
            plannedCount++;
            if (a / p < 0.6) avoidedCount++;
          }
        });
        if (!plannedCount) {
          metrics.M17 = makeMetric('M17', 'C', '苦手科目の先送り（逃避）指数', { status: 'insufficient_data' }, weights);
        } else {
          const avoidPct = pct(avoidedCount, plannedCount);
          metrics.M17 = makeMetric('M17', 'C', '苦手科目の先送り（逃避）指数', {
            status: avoidPct >= 50 ? 'alert' : avoidPct > 0 ? 'warning' : 'strength',
            value: { weakSubjects, avoidedCount, plannedCount, avoidPct },
            summary: `偏差値50未満科目(${weakSubjects.join('・')})の未達逃避率 ${avoidPct}%`,
            advice: avoidPct > 0
              ? `苦手科目(${weakSubjects[0]})が先送りされています。朝イチの15分だけ強制着手ルールを入れましょう。`
              : '苦手科目からも逃げずに予定通り取り組めています！',
            actionHint: avoidPct > 0 ? { type: 'timer', subject: weakSubjects[0], minutes: 25, label: `${weakSubjects[0]}を25分だけ着手` } : null
          }, weights);
        }
      }
    })();

    // M18 得意科目への逃避（コンフォートゾーン滞在率）
    (() => {
      const strongSubjects = Object.entries(latestDevBySubject).filter(([, dev]) => dev >= 60).map(([s]) => s);
      if (!strongSubjects.length) {
        metrics.M18 = makeMetric('M18', 'C', '得意科目への逃避（コンフォートゾーン滞在率）', { status: 'insufficient_data' }, weights);
      } else {
        let excessMins = 0, totalActStrong = 0;
        strongSubjects.forEach(s => {
          const p = planMap[s] || 0;
          const a = actMap[s] || 0;
          totalActStrong += a;
          if (p > 0 && a > p) excessMins += (a - p);
        });
        if (totalActStrong <= 0) {
          metrics.M18 = makeMetric('M18', 'C', '得意科目への逃避（コンフォートゾーン滞在率）', { status: 'insufficient_data' }, weights);
        } else {
          const excessPct = pct(excessMins, totalActStrong);
          metrics.M18 = makeMetric('M18', 'C', '得意科目への逃避（コンフォートゾーン滞在率）', {
            status: excessPct >= 25 ? 'warning' : 'normal',
            value: { strongSubjects, excessMins, excessPct },
            summary: `偏差値60以上科目(${strongSubjects.join('・')})の予定超過割合 ${excessPct}%（+${Math.round(excessMins)}分）`,
            advice: excessPct >= 25
              ? '得意科目に時間をかけすぎています。上限タイマーを設けて浮いた時間を苦手科目へ配分しましょう。'
              : '得意科目への過度な偏りはなく、バランスの良い時間配分です。'
          }, weights);
        }
      }
    })();

    // M19 未完了タスクの放置滞留日数
    (() => {
      const pastUnfinished = calendarEvents.filter(ev => ev.date < todayISO && !calendarDoneMap[ev.id]);
      if (!calendarEvents.length) {
        metrics.M19 = makeMetric('M19', 'C', '未完了タスクの放置滞留日数', { status: 'insufficient_data' }, weights);
      } else if (!pastUnfinished.length) {
        metrics.M19 = makeMetric('M19', 'C', '未完了タスクの放置滞留日数', {
          status: 'strength',
          value: { overdueCount: 0, avgStaleDays: 0 },
          summary: '放置されている未完了予定は 0件 です ✓',
          advice: '過去の予定を溜め込まずにクリーンに消化できています。'
        }, weights);
      } else {
        const staleDays = pastUnfinished.map(ev => Math.max(1, diffDays(ev.date, todayISO) || 1));
        const avgStale = round1(avg(staleDays));
        metrics.M19 = makeMetric('M19', 'C', '未完了タスクの放置滞留日数', {
          status: pastUnfinished.length >= 5 || avgStale >= 7 ? 'alert' : 'warning',
          value: { overdueCount: pastUnfinished.length, avgStaleDays: avgStale },
          summary: `未完了放置 ${pastUnfinished.length}件（平均滞留 ${avgStale}日）`,
          advice: '未消化タスクが滞留しています。週末に「やる／捨てる」の棚卸しを行いましょう。'
        }, weights);
      }
    })();

    // M20 計画修正（リスケ）後の回収成功率
    (() => {
      const weekSubPlan = {}, weekSubAct = {};
      calendarEvents.forEach(ev => {
        if (!ev.subject) return;
        const wk = getWeekKey(ev.date);
        const k = `${wk}::${ev.subject}`;
        weekSubPlan[k] = (weekSubPlan[k] || 0) + ev.mins;
      });
      logs.forEach(l => {
        if (!l.subject) return;
        const k = `${l.weekKey}::${l.subject}`;
        weekSubAct[k] = (weekSubAct[k] || 0) + l.minutes;
      });
      const weeks = Array.from(new Set(calendarEvents.map(e => getWeekKey(e.date)))).sort();
      const recoveryRates = [];
      for (let i = 0; i < weeks.length - 1; i++) {
        const w1 = weeks[i], w2 = weeks[i + 1];
        subjects.forEach(s => {
          const p1 = weekSubPlan[`${w1}::${s}`] || 0;
          const a1 = weekSubAct[`${w1}::${s}`] || 0;
          const p2 = weekSubPlan[`${w2}::${s}`] || 0;
          const a2 = weekSubAct[`${w2}::${s}`] || 0;
          if (p1 > 0 && a1 < p1 * 0.8 && p2 > p1) {
            recoveryRates.push(Math.min(150, pct(a2, p2)));
          }
        });
      }
      if (!recoveryRates.length) {
        metrics.M20 = makeMetric('M20', 'C', '計画修正（リスケ）後の回収成功率', { status: 'insufficient_data' }, weights);
      } else {
        const avgRec = round1(avg(recoveryRates));
        metrics.M20 = makeMetric('M20', 'C', '計画修正（リスケ）後の回収成功率', {
          status: avgRec >= 85 ? 'strength' : avgRec < 65 ? 'warning' : 'normal',
          value: { recoveryPct: avgRec, sampleCount: recoveryRates.length },
          summary: `リスケ翌週の回収達成率 ${avgRec}%（${recoveryRates.length}回平均）`,
          advice: avgRec < 70
            ? '未達分をそのまま翌週に上乗せすると共倒れしやすいです。リスケ時は優先度低いタスクを削りましょう。'
            : '計画修正後のリカバリー実行力が高い状態です。'
        }, weights);
      }
    })();

    // =========================================================================
    // 【カテゴリD：学習内容の偏りと成績相関（M21〜M36）】
    // =========================================================================
    // M21 投入時間あたりの偏差値上昇効率（ROI）
    (() => {
      const roiBySub = [];
      subjects.forEach(s => {
        const sExams = allExamsCombined.filter(e => e.subject === s && e.deviation !== null);
        if (sExams.length < 2) return;
        const prev = sExams[sExams.length - 2];
        const curr = sExams[sExams.length - 1];
        const minsBetween = logs
          .filter(l => l.subject === s && l.date >= prev.date && l.date <= curr.date)
          .reduce((sum, l) => sum + l.minutes, 0);
        if (minsBetween >= 60) {
          const deltaDev = curr.deviation - prev.deviation;
          const roiPer10h = round1((deltaDev / (minsBetween / 60)) * 10);
          roiBySub.push({ subject: s, roiPer10h, deltaDev: round1(deltaDev), hours: round1(minsBetween / 60) });
        }
      });
      if (!roiBySub.length) {
        metrics.M21 = makeMetric('M21', 'D', '投入時間あたりの偏差値上昇効率（ROI）', { status: 'insufficient_data' }, weights);
      } else {
        roiBySub.sort((a, b) => b.roiPer10h - a.roiPer10h);
        const top = roiBySub[0];
        const bottom = roiBySub[roiBySub.length - 1];
        metrics.M21 = makeMetric('M21', 'D', '投入時間あたりの偏差値上昇効率（ROI）', {
          status: bottom.roiPer10h < 0 ? 'warning' : 'strength',
          value: { top, bottom, list: roiBySub },
          summary: `最高ROI: ${top.subject} (${top.roiPer10h >= 0 ? '+' : ''}${top.roiPer10h}/10h) / 最低: ${bottom.subject} (${bottom.roiPer10h >= 0 ? '+' : ''}${bottom.roiPer10h}/10h)`,
          advice: bottom.roiPer10h < 0
            ? `「${bottom.subject}」は時間投入に対して偏差値が伸びていません。教材や解き方の見直しが必要です。`
            : '投入時間が着実に偏差値上昇へ結びついています。'
        }, weights);
      }
    })();

    // M22 タイムラグ効果（成績反映遅延日数）
    (() => {
      const lags = [];
      subjects.forEach(s => {
        const sExams = allExamsCombined.filter(e => e.subject === s && e.deviation !== null);
        for (let i = 1; i < sExams.length; i++) {
          if (sExams[i].deviation > sExams[i - 1].deviation) {
            const upDate = sExams[i].date;
            // 直前45日間で最も学習時間が多かった日をピークとみなす
            const cand = {};
            logs.forEach(l => {
              if (l.subject !== s) return;
              const dd = diffDays(l.date, upDate);
              if (dd !== null && dd >= 1 && dd <= 45) {
                cand[l.date] = (cand[l.date] || 0) + l.minutes;
              }
            });
            const entries = Object.entries(cand).sort((a, b) => b[1] - a[1]);
            if (entries.length) {
              const lag = diffDays(entries[0][0], upDate);
              if (lag !== null) lags.push(lag);
            }
          }
        }
      });
      if (!lags.length) {
        metrics.M22 = makeMetric('M22', 'D', 'タイムラグ効果（成績反映遅延日数）', { status: 'insufficient_data' }, weights);
      } else {
        const avgLag = round1(avg(lags));
        metrics.M22 = makeMetric('M22', 'D', 'タイムラグ効果（成績反映遅延日数）', {
          status: 'normal',
          value: { avgLagDays: avgLag, samples: lags.length },
          summary: `学習増加ピークから成績上昇まで平均 ${avgLag}日`,
          advice: `あなたの努力が点数に表れるまで約${Math.round(avgLag)}日かかります。本番${Math.round(avgLag)}日前までに強化ピークを作りましょう。`
        }, weights);
      }
    })();

    // M23 インプット・アウトプット黄金比ギャップ
    (() => {
      if (totalAllMins <= 0) {
        metrics.M23 = makeMetric('M23', 'D', 'インプット・アウトプット黄金比ギャップ', { status: 'insufficient_data' }, weights);
      } else {
        const recentLogs = logs.filter(l => l.date >= thirtyDaysAgoISO);
        const recTotal = recentLogs.reduce((s, l) => s + l.minutes, 0) || totalAllMins;
        const recDrill = (recentLogs.length ? recentLogs : logs).filter(l => l.materialType === 'drill').reduce((s, l) => s + l.minutes, 0);
        const curOutPct = pct(recDrill, recTotal);
        const curInPct = round1(100 - curOutPct);

        // 過去最も偏差値が伸びた期間を特定（なければ目標60%をベンチマーク）
        let bestOutPct = 60;
        let bestDelta = -Infinity;
        for (let i = 1; i < allExamsCombined.length; i++) {
          const prev = allExamsCombined[i - 1], curr = allExamsCombined[i];
          if (prev.subject !== curr.subject || prev.deviation === null || curr.deviation === null) continue;
          const delta = curr.deviation - prev.deviation;
          if (delta > bestDelta) {
            const spanLogs = logs.filter(l => l.date >= prev.date && l.date <= curr.date);
            const spanTot = spanLogs.reduce((s, l) => s + l.minutes, 0);
            if (spanTot >= 120) {
              bestDelta = delta;
              bestOutPct = pct(spanLogs.filter(l => l.materialType === 'drill').reduce((s, l) => s + l.minutes, 0), spanTot);
            }
          }
        }
        const gapPt = round1(curOutPct - bestOutPct);
        metrics.M23 = makeMetric('M23', 'D', 'インプット・アウトプット黄金比ギャップ', {
          status: gapPt <= -15 ? 'warning' : gapPt >= 0 ? 'strength' : 'normal',
          value: { currentInputPct: curInPct, currentOutputPct: curOutPct, goldenOutputPct: bestOutPct, gapPt },
          summary: `現在 インプット${curInPct}% : 回転${curOutPct}%（黄金比比 ${gapPt >= 0 ? '+' : ''}${gapPt}pt）`,
          advice: gapPt <= -15
            ? `回転教材の比率が黄金比(${bestOutPct}%)より${Math.abs(gapPt)}pt低めです。演習アウトプットを増やしましょう。`
            : 'インプットとアウトプットの黄金比を良好に保てています。'
        }, weights);
      }
    })();

    // M24 復習放置減衰率
    (() => {
      const poorTopics = logs.filter(l => l.ratingCode === '△' && l.topic);
      if (!poorTopics.length) {
        metrics.M24 = makeMetric('M24', 'D', '復習放置減衰率', { status: 'insufficient_data' }, weights);
      } else {
        let neglected = 0, missedInExam = 0;
        poorTopics.forEach(pl => {
          const reviewed = logs.some(l =>
            l.subject === pl.subject &&
            topicMatches(l.topic, pl.topic) &&
            (diffDays(pl.date, l.date) || 0) >= 1 &&
            (diffDays(pl.date, l.date) || 99) <= 7
          );
          if (!reviewed) {
            neglected++;
            const hitMis = mistakes.some(m =>
              m.subject === pl.subject &&
              (diffDays(pl.date, m.date) || -1) >= 0 &&
              (topicMatches(m.memo, pl.topic) || topicMatches(m.examTitle, pl.topic))
            );
            if (hitMis) missedInExam++;
          }
        });
        const negPct = pct(neglected, poorTopics.length);
        const misPct = neglected ? pct(missedInExam, neglected) : 0;
        metrics.M24 = makeMetric('M24', 'D', '復習放置減衰率', {
          status: negPct >= 50 ? 'alert' : negPct >= 30 ? 'warning' : 'strength',
          value: { poorTopicCount: poorTopics.length, neglectedCount: neglected, neglectedPct: negPct, examMissRatePct: misPct },
          summary: `集中△単元の7日以内未復習率 ${negPct}%（放置単元の答練失点連動 ${misPct}%）`,
          advice: negPct >= 30
            ? '△をつけた単元が1週間放置されがちです。翌々日までに15分の再回転をカレンダーへ予約しましょう。'
            : '集中△だった単元をしっかり7日以内に復習回収できています。'
        }, weights);
      }
    })();

    // M25 単元偏食度（上位3単元占有率）
    (() => {
      const rec30 = logs.filter(l => l.date >= thirtyDaysAgoISO && l.topic);
      if (rec30.length < 3) {
        metrics.M25 = makeMetric('M25', 'D', '単元偏食度（上位3単元占有率）', { status: 'insufficient_data' }, weights);
      } else {
        let maxConc = 0, worstSub = '', top3List = [];
        subjects.forEach(s => {
          const sLogs = rec30.filter(l => l.subject === s);
          const sTotal = sLogs.reduce((a, l) => a + l.minutes, 0);
          if (sTotal <= 0) return;
          const byTopic = {};
          sLogs.forEach(l => { byTopic[l.topic] = (byTopic[l.topic] || 0) + l.minutes; });
          const sorted = Object.entries(byTopic).sort((a, b) => b[1] - a[1]);
          if (sorted.length < 2) return;
          const top3Sum = sorted.slice(0, 3).reduce((a, x) => a + x[1], 0);
          const conc = pct(top3Sum, sTotal);
          if (conc > maxConc) {
            maxConc = conc;
            worstSub = s;
            top3List = sorted.slice(0, 3).map(([t]) => t);
          }
        });
        if (!worstSub) {
          metrics.M25 = makeMetric('M25', 'D', '単元偏食度（上位3単元占有率）', { status: 'insufficient_data' }, weights);
        } else {
          metrics.M25 = makeMetric('M25', 'D', '単元偏食度（上位3単元占有率）', {
            status: maxConc >= 80 ? 'warning' : 'normal',
            value: { subject: worstSub, top3SharePct: maxConc, top3Topics: top3List },
            summary: `${worstSub}の上位3単元(${top3List.join('・')})が ${maxConc}% を占有`,
            advice: maxConc >= 80
              ? `${worstSub}が特定論点に偏っています。回転が止まっている他の重要論点にも週1回触れましょう。`
              : '複数単元にバランス良く学習時間が分散しています。'
          }, weights);
        }
      }
    })();

    // M26 教材浮気率（分散ペナルティ）
    (() => {
      const fourteenDaysAgo = fmtDateISO(new Date(todayDate.getTime() - 14 * 86400000));
      const rec14 = logs.filter(l => l.date >= fourteenDaysAgo && l.material);
      if (!rec14.length) {
        metrics.M26 = makeMetric('M26', 'D', '教材浮気率（分散ペナルティ）', { status: 'insufficient_data' }, weights);
      } else {
        const subMatCounts = [];
        subjects.forEach(s => {
          const mats = new Set(rec14.filter(l => l.subject === s).map(l => l.material));
          if (mats.size > 0) subMatCounts.push({ subject: s, count: mats.size, dev: latestDevBySubject[s] ?? null });
        });
        const maxObj = [...subMatCounts].sort((a, b) => b.count - a.count)[0];
        const avgMats = round1(avg(subMatCounts.map(x => x.count)));
        const withDev = subMatCounts.filter(x => x.dev !== null);
        const corr = withDev.length >= 3 ? pearson(withDev.map(x => x.count), withDev.map(x => x.dev)) : null;
        metrics.M26 = makeMetric('M26', 'D', '教材浮気率（分散ペナルティ）', {
          status: maxObj.count >= 4 ? 'warning' : 'normal',
          value: { avgMaterialsPerSubject: avgMats, maxSubject: maxObj.subject, maxCount: maxObj.count, correlationWithDev: corr },
          summary: `直近14日の平均教材数 ${avgMats}冊/科目（最多: ${maxObj.subject} ${maxObj.count}冊）`,
          advice: maxObj.count >= 4
            ? `${maxObj.subject}で教材が${maxObj.count}冊に分散しています。メイン回転教材を1〜2冊に絞り込みましょう。`
            : '使用教材が適切に絞り込まれています。'
        }, weights);
      }
    })();

    // M27 回転スピード短縮率
    (() => {
      const grouped = {};
      logs.forEach(l => {
        if (!l.subject || !l.material || !l.topic) return;
        const k = `${l.subject}::${l.material}::${l.topic}`;
        if (!grouped[k]) grouped[k] = [];
        grouped[k].push(l.minutes);
      });
      const reductions = [];
      Object.values(grouped).forEach(arr => {
        if (arr.length >= 2 && arr[0] > 0) {
          const first = arr[0];
          const laterAvg = avg(arr.slice(1));
          reductions.push(((first - laterAvg) / first) * 100);
        }
      });
      if (!reductions.length) {
        metrics.M27 = makeMetric('M27', 'D', '回転スピード短縮率', { status: 'insufficient_data' }, weights);
      } else {
        const avgRed = round1(avg(reductions));
        metrics.M27 = makeMetric('M27', 'D', '回転スピード短縮率', {
          status: avgRed >= 15 ? 'strength' : avgRed < 0 ? 'warning' : 'normal',
          value: { reductionPct: avgRed, repeatedTopics: reductions.length },
          summary: `2周目以降の所要時間 ${avgRed >= 0 ? '-' : '+'}${Math.abs(avgRed)}%（${reductions.length}単元集計）`,
          advice: avgRed < 5
            ? '2周目以降も1周目と同じ時間がかかっています。解ける問題は飛ばし、×印論点だけ高速回転しましょう。'
            : '周回を重ねるごとに回転スピードが着実に上がっています！'
        }, weights);
      }
    })();

    // M28 集中度◎の空回りギャップ
    (() => {
      const greatTopicLogs = logs.filter(l => l.ratingCode === '◎' && l.topic);
      if (!greatTopicLogs.length || !mistakes.length) {
        metrics.M28 = makeMetric('M28', 'D', '集中度◎の空回りギャップ', { status: 'insufficient_data' }, weights);
      } else {
        let hitMiss = 0;
        greatTopicLogs.forEach(gl => {
          const missed = mistakes.some(m =>
            m.subject === gl.subject &&
            (diffDays(gl.date, m.date) || -1) >= 0 &&
            (topicMatches(m.memo, gl.topic) || topicMatches(m.examTitle, gl.topic))
          );
          if (missed) hitMiss++;
        });
        const gapPct = pct(hitMiss, greatTopicLogs.length);
        metrics.M28 = makeMetric('M28', 'D', '集中度◎の空回りギャップ', {
          status: gapPct >= 30 ? 'alert' : gapPct >= 15 ? 'warning' : 'strength',
          value: { greatCount: greatTopicLogs.length, missedCount: hitMiss, gapPct },
          summary: `◎記録単元の答練誤答率 ${gapPct}%（${hitMiss}/${greatTopicLogs.length}件）`,
          advice: gapPct >= 15
            ? '「深く集中した」のに本番で失点しています。理解したつもりを防ぐため、白紙再現テストを挟みましょう。'
            : '集中して取り組んだ単元は答練でもしっかり得点に結びついています。'
        }, weights);
      }
    })();

    // M29 最優先復習リスト消化率と次回答練スコア相関
    (() => {
      const highAcc = mistakes.filter(m => Number(m.accuracy) >= 60);
      if (!highAcc.length) {
        metrics.M29 = makeMetric('M29', 'D', '最優先復習リスト消化率と次回答練スコア相関', { status: 'insufficient_data' }, weights);
      } else {
        const doneCount = highAcc.filter(m => reviewedSet.has(m.id)).length;
        const donePct = pct(doneCount, highAcc.length);
        let baseDelta = null;
        if (detailedExams.length >= 2) {
          const calcBaseAcc = (ex) => {
            const qs = (ex.questions || []).filter(q => Number(q.accuracy) >= 60);
            if (!qs.length) return null;
            return pct(qs.filter(q => !q.isWrong).length, qs.length);
          };
          const prevAcc = calcBaseAcc(detailedExams[detailedExams.length - 2]);
          const curAcc = calcBaseAcc(detailedExams[detailedExams.length - 1]);
          if (prevAcc !== null && curAcc !== null) baseDelta = round1(curAcc - prevAcc);
        }
        metrics.M29 = makeMetric('M29', 'D', '最優先復習リスト消化率と次回答練スコア相関', {
          status: donePct < 50 ? 'alert' : donePct < 80 ? 'warning' : 'strength',
          value: { reviewedCount: doneCount, totalHighAcc: highAcc.length, reviewPct: donePct, baseBandDeltaPt: baseDelta },
          summary: `正答率60%以上誤答の復習消化率 ${donePct}%（${doneCount}/${highAcc.length}問${baseDelta !== null ? ` / 基礎帯変化 ${baseDelta >= 0 ? '+' : ''}${baseDelta}pt` : ''}）`,
          advice: donePct < 80
            ? '未復習の基礎誤答が残っています。新規問題より先に「最優先復習リスト」を100%消化しましょう。'
            : '基礎帯の誤答復習をしっかり完遂できています！',
          actionHint: donePct < 100 ? { type: 'review', label: '最優先復習リストを確認する' } : null
        }, weights);
      }
    })();

    // M30 講義視聴のみ（演習未着手）滞留リスク
    (() => {
      const lecLogs = logs.filter(l => l.materialType === 'lecture');
      if (!lecLogs.length) {
        metrics.M30 = makeMetric('M30', 'D', '講義視聴のみ（演習未着手）滞留リスク', { status: 'insufficient_data' }, weights);
      } else {
        let strandedCount = 0, strandedMins = 0;
        lecLogs.forEach(ll => {
          const hasDrill = logs.some(l =>
            l.materialType === 'drill' &&
            l.subject === ll.subject &&
            (!ll.topic || !l.topic || topicMatches(l.topic, ll.topic)) &&
            (diffDays(ll.date, l.date) ?? -1) >= 0 &&
            (diffDays(ll.date, l.date) ?? 99) <= 7
          );
          if (!hasDrill) {
            strandedCount++;
            strandedMins += ll.minutes;
          }
        });
        const riskPct = pct(strandedCount, lecLogs.length);
        metrics.M30 = makeMetric('M30', 'D', '講義視聴のみ（演習未着手）滞留リスク', {
          status: strandedCount >= 3 || riskPct >= 50 ? 'alert' : strandedCount > 0 ? 'warning' : 'strength',
          value: { strandedCount, strandedMins, totalLectureLogs: lecLogs.length, riskPct },
          summary: `講義後7日以内に演習0分の滞留 ${strandedCount}件（計${Math.round(strandedMins)}分 / ${riskPct}%）`,
          advice: strandedCount > 0
            ? '講義を聴きっぱなしにすると定着率が急落します。視聴から48時間以内に該当単元の個別問題を解きましょう。'
            : '講義視聴のあとに着実に演習アウトプットへ繋げられています！'
        }, weights);
      }
    })();

    // M31 科目別の回転教材偏重・インプット逃避マトリクス
    (() => {
      const overallDrillPct = totalAllMins > 0 ? pct(typeTotals.drill, totalAllMins) : null;
      if (overallDrillPct === null) {
        metrics.M31 = makeMetric('M31', 'D', '科目別の回転教材偏重・インプット逃避マトリクス', { status: 'insufficient_data' }, weights);
      } else {
        const subMatrix = subjects.map(s => {
          const sLogs = logs.filter(l => l.subject === s);
          const tot = sLogs.reduce((a, l) => a + l.minutes, 0);
          if (tot <= 0) return null;
          const dPct = pct(sLogs.filter(l => l.materialType === 'drill').reduce((a, l) => a + l.minutes, 0), tot);
          return { subject: s, drillPct: dPct, diffFromAvgPt: round1(dPct - overallDrillPct), dev: latestDevBySubject[s] ?? null };
        }).filter(Boolean);
        if (!subMatrix.length) {
          metrics.M31 = makeMetric('M31', 'D', '科目別の回転教材偏重・インプット逃避マトリクス', { status: 'insufficient_data' }, weights);
        } else {
          const lowest = [...subMatrix].sort((a, b) => a.drillPct - b.drillPct)[0];
          const weakInputEscape = subMatrix.find(x => x.dev !== null && x.dev < 50 && x.drillPct < 40);
          metrics.M31 = makeMetric('M31', 'D', '科目別の回転教材偏重・インプット逃避マトリクス', {
            status: weakInputEscape ? 'alert' : lowest.diffFromAvgPt <= -25 ? 'warning' : 'normal',
            value: { overallDrillPct, lowestSubject: lowest.subject, lowestDrillPct: lowest.drillPct, matrix: subMatrix },
            summary: `全体回転比率 ${overallDrillPct}%（最低: ${lowest.subject} ${lowest.drillPct}% / 乖離 ${lowest.diffFromAvgPt >= 0 ? '+' : ''}${lowest.diffFromAvgPt}pt）`,
            advice: weakInputEscape
              ? `苦手科目「${weakInputEscape.subject}」がインプット逃避（回転${weakInputEscape.drillPct}%）になっています。短答・個別問題集の演習比率を引き上げましょう。`
              : `${lowest.subject}の回転教材比率が他科目より低めです。演習アウトプットを意識的に増やしましょう。`
          }, weights);
        }
      }
    })();

    // M32 回転教材の集中度△率と基礎失点の連動
    (() => {
      const drillRated = logs.filter(l => l.materialType === 'drill' && l.ratingCode);
      if (!drillRated.length) {
        metrics.M32 = makeMetric('M32', 'D', '回転教材の集中度△率と基礎失点の連動', { status: 'insufficient_data' }, weights);
      } else {
        const drillPoorPct = pct(drillRated.filter(l => l.ratingCode === '△').length, drillRated.length);
        const highAccMistakes = mistakes.filter(m => Number(m.accuracy) >= 60).length;
        metrics.M32 = makeMetric('M32', 'D', '回転教材の集中度△率と基礎失点の連動', {
          status: drillPoorPct >= 30 && highAccMistakes >= 2 ? 'alert' : drillPoorPct >= 25 ? 'warning' : 'normal',
          value: { drillPoorPct, highAccMistakes, drillRatedCount: drillRated.length },
          summary: `回転教材の△率 ${drillPoorPct}% × 基礎帯(60%以上)誤答 ${highAccMistakes}問`,
          advice: drillPoorPct >= 25
            ? '眠気・散漫状態での問題演習が本番の基礎失点に直結しています。演習は必ず集中できる時間帯に行いましょう。'
            : '回転教材を高い集中状態で回せています。'
        }, weights);
      }
    })();

    // M33 1回あたり滞在時間過多（1周目沼判定）
    (() => {
      const rec30 = logs.filter(l => l.date >= thirtyDaysAgoISO && (l.materialType === 'text' || l.materialType === 'drill'));
      if (rec30.length < 2) {
        metrics.M33 = makeMetric('M33', 'D', '1回あたり滞在時間過多（1周目沼判定）', { status: 'insufficient_data' }, weights);
      } else {
        const avgStay = Math.round(avg(rec30.map(l => l.minutes)));
        const topicCounts = {};
        rec30.forEach(l => {
          const k = `${l.subject}::${l.material}::${l.topic || '全般'}`;
          topicCounts[k] = (topicCounts[k] || 0) + 1;
        });
        const estRotations = round1(avg(Object.values(topicCounts)));
        metrics.M33 = makeMetric('M33', 'D', '1回あたり滞在時間過多（1周目沼判定）', {
          status: avgStay >= 95 && estRotations <= 1.2 ? 'alert' : avgStay >= 80 ? 'warning' : 'normal',
          value: { avgStayMins: avgStay, estRotations30d: estRotations },
          summary: `平均滞在 ${avgStay}分/回・30日推定回転数 ${estRotations}周`,
          advice: avgStay >= 80 && estRotations <= 1.5
            ? '1周目に時間をかけすぎる「沼」傾向があります。完璧主義を捨て、6割理解で早く2周目に入りましょう。'
            : 'テンポよく回転できています。'
        }, weights);
      }
    })();

    // M34 計算の着手前思考不足率
    (() => {
      const calcTagged = mistakes.filter(m => (m.qType || getSubjectType(m.subject)) === 'calc' && m.causeTag);
      if (calcTagged.length < 2) {
        metrics.M34 = makeMetric('M34', 'D', '計算の着手前思考不足率', { status: 'insufficient_data' }, weights);
      } else {
        const preThink = calcTagged.filter(m => /論点誤認|前提ミス|資料読み落とし|注意点漏れ|ケアレス/.test(m.causeTag));
        const ratio = pct(preThink.length, calcTagged.length);
        metrics.M34 = makeMetric('M34', 'D', '計算の着手前思考不足率', {
          status: ratio >= 60 ? 'alert' : ratio >= 40 ? 'warning' : 'normal',
          value: { preThinkCount: preThink.length, totalCalcTagged: calcTagged.length, ratioPct: ratio },
          summary: `計算誤答のうち論点誤認・注意点漏れが ${ratio}%（${preThink.length}/${calcTagged.length}問）`,
          advice: ratio >= 50
            ? '電卓を叩く前に10秒立ち止まり、前提条件・期首期末・要求数値に線を引く「着手前10秒ルール」を徹底しましょう。'
            : '計算の前提確認・読み取り精度は安定しています。'
        }, weights);
      }
    })();

    // M35 理論の線引き外・構造見落とし率
    (() => {
      const theoryTagged = mistakes.filter(m => (m.qType || getSubjectType(m.subject)) === 'theory' && m.causeTag);
      if (theoryTagged.length < 2) {
        metrics.M35 = makeMetric('M35', 'D', '理論の線引き外・構造見落とし率', { status: 'insufficient_data' }, weights);
      } else {
        const struct = theoryTagged.filter(m => /線引き外|テキスト外|関連知識|構造不足|趣旨不足/.test(m.causeTag));
        const ratio = pct(struct.length, theoryTagged.length);
        metrics.M35 = makeMetric('M35', 'D', '理論の線引き外・構造見落とし率', {
          status: ratio >= 55 ? 'alert' : ratio >= 35 ? 'warning' : 'normal',
          value: { structCount: struct.length, totalTheoryTagged: theoryTagged.length, ratioPct: ratio },
          summary: `理論誤答のうち線引き外・関連知識不足が ${ratio}%（${struct.length}/${theoryTagged.length}問）`,
          advice: ratio >= 40
            ? 'マーカー箇所だけの暗記になっています。前後1文と制度趣旨・関連論点ページをテキストにリンクさせましょう。'
            : '理論の体系理解・周辺知識のカバー率は良好です。'
        }, weights);
      }
    })();

    // M36 週間時間投入過多の空回り科目検出
    (() => {
      const sevenDaysAgo = fmtDateISO(new Date(todayDate.getTime() - 7 * 86400000));
      const weekLogs = logs.filter(l => l.date >= sevenDaysAgo);
      const wTotal = weekLogs.reduce((s, l) => s + l.minutes, 0);
      if (wTotal <= 0) {
        metrics.M36 = makeMetric('M36', 'D', '週間時間投入過多の空回り科目検出', { status: 'insufficient_data' }, weights);
      } else {
        let spinSub = null, spinShare = 0;
        subjects.forEach(s => {
          const sMins = weekLogs.filter(l => l.subject === s).reduce((a, l) => a + l.minutes, 0);
          const share = pct(sMins, wTotal);
          if (share >= 35) {
            const sEx = allExamsCombined.filter(e => e.subject === s && e.deviation !== null);
            const stagnant = !sEx.length || (sEx.length >= 2 && sEx[sEx.length - 1].deviation <= sEx[sEx.length - 2].deviation + 0.5) || sEx[sEx.length - 1].deviation < 52;
            if (stagnant && share > spinShare) { spinSub = s; spinShare = share; }
          }
        });
        metrics.M36 = makeMetric('M36', 'D', '週間時間投入過多の空回り科目検出', {
          status: spinSub ? 'alert' : 'strength',
          value: { spinSubject: spinSub, sharePct: spinShare },
          summary: spinSub ? `「${spinSub}」に週間${spinShare}%投入するも偏差値横ばい・低迷` : '週間35%超の空回り科目は未検出 ✓',
          advice: spinSub
            ? `${spinSub}が作業的な反復になっている可能性があります。一度立ち止まり、解法プロセスと講師解説を再確認しましょう。`
            : '特定科目での空回りはなく、効率的に時間を配分できています。'
        }, weights);
      }
    })();

    // =========================================================================
    // 【カテゴリE：答練・模試での本番力と失点プロファイル（M37〜M43）】
    // =========================================================================
    // M37 選球眼ロス点数（捨て問執着コスト）
    (() => {
      if (!mistakes.length) {
        metrics.M37 = makeMetric('M37', 'E', '選球眼ロス点数（捨て問執着コスト）', { status: 'insufficient_data' }, weights);
      } else {
        const hardObsessed = mistakes.filter(m => Number(m.accuracy) < 40 && (m.feeling === 'A' || m.feeling === 'B'));
        const easyLostPts = mistakes.filter(m => Number(m.accuracy) >= 60).reduce((s, m) => s + (Number(m.points) || 1), 0);
        metrics.M37 = makeMetric('M37', 'E', '選球眼ロス点数（捨て問執着コスト）', {
          status: hardObsessed.length >= 2 && easyLostPts >= 8 ? 'alert' : hardObsessed.length >= 1 ? 'warning' : 'strength',
          value: { hardObsessedCount: hardObsessed.length, easyLostPoints: easyLostPts },
          summary: `正答率40%未満にA/B判定 ${hardObsessed.length}問（同時に基礎60%以上で計${easyLostPts}点失点）`,
          advice: hardObsessed.length >= 1
            ? '難問に時間を使って基礎問題を落とす「選球眼ロス」が発生しています。2分考えて見えなければ即C判定で飛ばしましょう。'
            : '難問への執着が少なく、本番の選球眼は冴えています。'
        }, weights);
      }
    })();

    // M38 自信過剰ミス率（A判定誤答率）
    (() => {
      if (!mistakes.length) {
        metrics.M38 = makeMetric('M38', 'E', '自信過剰ミス率（A判定誤答率）', { status: 'insufficient_data' }, weights);
      } else {
        const aMis = mistakes.filter(m => m.feeling === 'A').length;
        const ratio = pct(aMis, mistakes.length);
        metrics.M38 = makeMetric('M38', 'E', '自信過剰ミス率（A判定誤答率）', {
          status: ratio >= 40 ? 'alert' : ratio >= 25 ? 'warning' : 'normal',
          value: { aMistakes: aMis, totalMistakes: mistakes.length, ratioPct: ratio },
          summary: `A(取れたはず)判定の誤答率 ${ratio}%（${aMis}/${mistakes.length}問）`,
          advice: ratio >= 25
            ? '「解けたつもり」でのケアレスミス・条件見落としが多発しています。検算・最終確認の1分を必ず確保しましょう。'
            : '自信過剰による取りこぼしは少なめです。'
        }, weights);
      }
    })();

    // M39 過小評価逃げ腰率（C判定取りこぼし率）
    (() => {
      if (!mistakes.length) {
        metrics.M39 = makeMetric('M39', 'E', '過小評価逃げ腰率（C判定取りこぼし率）', { status: 'insufficient_data' }, weights);
      } else {
        const cEasy = mistakes.filter(m => m.feeling === 'C' && Number(m.accuracy) >= 60);
        const lostPts = cEasy.reduce((s, m) => s + (Number(m.points) || 1), 0);
        metrics.M39 = makeMetric('M39', 'E', '過小評価逃げ腰率（C判定取りこぼし率）', {
          status: cEasy.length >= 2 ? 'alert' : cEasy.length === 1 ? 'warning' : 'strength',
          value: { cEasyCount: cEasy.length, lostPoints: lostPts },
          summary: `正答率60%以上をC(捨て問)誤認 ${cEasy.length}問（計${lostPts}点ロス）`,
          advice: cEasy.length >= 1
            ? '周囲が正解している基本問題を難問と誤認して捨てています。Aランク回転教材の典型パターン認識を強化しましょう。'
            : '基本問題を捨て問と誤認する取りこぼしはありません ✓'
        }, weights);
      }
    })();

    // M40 支配的失点原因ボトルネック
    (() => {
      const tagged = mistakes.filter(m => m.causeTag);
      if (tagged.length < 2) {
        metrics.M40 = makeMetric('M40', 'E', '支配的失点原因ボトルネック', { status: 'insufficient_data' }, weights);
      } else {
        const counts = {};
        tagged.forEach(m => { counts[m.causeTag] = (counts[m.causeTag] || 0) + 1; });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        const top2 = sorted.slice(0, 2);
        const top2Sum = top2.reduce((s, x) => s + x[1], 0);
        const top2Pct = pct(top2Sum, tagged.length);
        metrics.M40 = makeMetric('M40', 'E', '支配的失点原因ボトルネック', {
          status: top2Pct >= 65 ? 'alert' : 'normal',
          value: { topCauses: top2.map(([tag, c]) => ({ tag, count: c })), top2SharePct: top2Pct },
          summary: `上位原因「${top2.map(x => x[0]).join('・')}」が全誤答の ${top2Pct}% を占有`,
          advice: `失点原因の${top2Pct}%が「${top2[0][0]}」に集中しています。この1点に特化したチェックリストを答練前に見直しましょう。`
        }, weights);
      }
    })();

    // M41 合格判定ボーダーまでの「あと何問」換算感度
    (() => {
      const latestDet = detailedExams[detailedExams.length - 1];
      if (!latestDet) {
        metrics.M41 = makeMetric('M41', 'E', '合格判定ボーダーまでの「あと何問」換算感度', { status: 'insufficient_data' }, weights);
      } else {
        const target = Number(latestDet.nextTargetScore) || Math.min(latestDet.maxScore, Math.ceil((latestDet.score + 8) / 5) * 5);
        const gapPts = Math.max(0, target - latestDet.score);
        const unrevEasyPts = mistakes
          .filter(m => Number(m.accuracy) >= 60 && !reviewedSet.has(m.id))
          .reduce((s, m) => s + (Number(m.points) || 1), 0);
        const coverPct = gapPts > 0 ? Math.min(200, pct(unrevEasyPts, gapPts)) : 100;
        metrics.M41 = makeMetric('M41', 'E', '合格判定ボーダーまでの「あと何問」換算感度', {
          status: gapPts === 0 ? 'strength' : coverPct >= 100 ? 'warning' : 'normal',
          value: { gapPoints: gapPts, unreviewedEasyPoints: unrevEasyPts, coverPct },
          summary: gapPts === 0
            ? '目標スコア到達済み ✓'
            : `目標まであと${gapPts}点（未復習の基礎誤答 ${unrevEasyPts}点で ${coverPct}% カバー可能）`,
          advice: gapPts > 0 && coverPct >= 80
            ? `未復習の基礎誤答を潰すだけで目標ボーダーの${coverPct}%を回収できます。今すぐ復習リストを回しましょう。`
            : '基礎固めに加え、中難度（正答率40〜59%）の取り切りでボーダー突破を狙いましょう。',
          actionHint: gapPts > 0 ? { type: 'review', label: '未復習の基礎誤答を今すぐ復習' } : null
        }, weights);
      }
    })();

    // M42 科目間の共食い現象（シーソー相関）
    (() => {
      const pairDrops = [];
      for (let i = 1; i < allExamsCombined.length; i++) {
        const curr = allExamsCombined[i];
        const prevSame = [...allExamsCombined.slice(0, i)].reverse().find(e => e.subject === curr.subject && e.deviation !== null);
        if (!prevSame || curr.deviation === null) continue;
        if (curr.deviation - prevSame.deviation >= 5) {
          // 同時期（±14日）に偏差値が3以上下がった他科目を探す
          allExamsCombined.forEach(other => {
            if (other.subject === curr.subject || other.deviation === null) return;
            const dd = Math.abs(diffDays(curr.date, other.date) ?? 999);
            if (dd <= 14) {
              const prevOther = allExamsCombined.filter(e => e.subject === other.subject && e.date < other.date && e.deviation !== null).slice(-1)[0];
              if (prevOther && other.deviation - prevOther.deviation <= -3) {
                pairDrops.push({ up: curr.subject, down: other.subject, upDelta: round1(curr.deviation - prevSame.deviation), downDelta: round1(other.deviation - prevOther.deviation) });
              }
            }
          });
        }
      }
      if (!allExamsCombined.length || subjects.length < 2) {
        metrics.M42 = makeMetric('M42', 'E', '科目間の共食い現象（シーソー相関）', { status: 'insufficient_data' }, weights);
      } else if (!pairDrops.length) {
        metrics.M42 = makeMetric('M42', 'E', '科目間の共食い現象（シーソー相関）', {
          status: 'strength',
          value: { pairs: [] },
          summary: '特定科目の強化による他科目の共食い低下は未検出 ✓',
          advice: '全科目のメンテナンスを崩さずに底上げできています。'
        }, weights);
      } else {
        const p = pairDrops[pairDrops.length - 1];
        metrics.M42 = makeMetric('M42', 'E', '科目間の共食い現象（シーソー相関）', {
          status: 'warning',
          value: { pairs: pairDrops },
          summary: `${p.up}(+${p.upDelta})強化の裏で ${p.down}(${p.downDelta}) が連動低下`,
          advice: `${p.up}に集中すると${p.down}の記憶が抜けるシーソー現象が出ています。${p.down}に毎日15分の維持枠を固定しましょう。`
        }, weights);
      }
    })();

    // M43 答練受験後の燃え尽き空白時間
    (() => {
      if (!allExamsCombined.length || !logs.length) {
        metrics.M43 = makeMetric('M43', 'E', '答練受験後の燃え尽き空白時間', { status: 'insufficient_data' }, weights);
      } else {
        const gapsHours = [];
        allExamsCombined.forEach(ex => {
          const nextLog = logs.find(l => l.date > ex.date);
          if (nextLog) {
            const dDiff = diffDays(ex.date, nextLog.date);
            if (dDiff !== null && dDiff >= 1 && dDiff <= 14) {
              const startH = nextLog.startHour !== null ? nextLog.startHour : 9;
              gapsHours.push((dDiff - 1) * 24 + startH + 6); // 答練終了18:00想定
            }
          }
        });
        if (!gapsHours.length) {
          metrics.M43 = makeMetric('M43', 'E', '答練受験後の燃え尽き空白時間', { status: 'insufficient_data' }, weights);
        } else {
          const avgGapH = round1(avg(gapsHours));
          metrics.M43 = makeMetric('M43', 'E', '答練受験後の燃え尽き空白時間', {
            status: avgGapH >= 48 ? 'alert' : avgGapH >= 30 ? 'warning' : 'strength',
            value: { avgGapHours: avgGapH, sampleCount: gapsHours.length },
            summary: `答練後の次学習まで平均 ${avgGapH}時間`,
            advice: avgGapH >= 30
              ? '答練後に空白期間が空きがちです。記憶が鮮明な「当日夜〜翌朝」に誤答A/B/C仕分けだけ15分で終わらせましょう。'
              : '答練後の立ち上がりが早く、復習鮮度を保てています！'
          }, weights);
        }
      }
    })();

    // =========================================================================
    // 【カテゴリF：試験カウントダウン連動の勉強内容変化（M44〜M49）】
    // =========================================================================
    // M44 直前期ギアチェンジ加速率
    (() => {
      if (!nearestExam || !logs.length) {
        metrics.M44 = makeMetric('M44', 'F', '直前期ギアチェンジ加速率', { status: 'insufficient_data' }, weights);
      } else {
        let m60_31 = 0, m30_0 = 0;
        logs.forEach(l => {
          const dLeft = diffDays(l.date, nearestExam.date);
          if (dLeft === null) return;
          if (dLeft >= 31 && dLeft <= 60) m60_31 += l.minutes;
          else if (dLeft >= 0 && dLeft <= 30) m30_0 += l.minutes;
        });
        if (m60_31 <= 0 || m30_0 <= 0) {
          metrics.M44 = makeMetric('M44', 'F', '直前期ギアチェンジ加速率', { status: 'insufficient_data' }, weights);
        } else {
          const wkPrev = m60_31 / (30 / 7);
          const wkRecent = m30_0 / (Math.max(1, 30 - Math.min(30, daysToExam)) / 7);
          const accelPct = round1(((wkRecent - wkPrev) / wkPrev) * 100);
          metrics.M44 = makeMetric('M44', 'F', '直前期ギアチェンジ加速率', {
            status: accelPct >= 10 ? 'strength' : accelPct < -10 ? 'alert' : 'normal',
            value: { prevWeeklyHours: round1(wkPrev / 60), recentWeeklyHours: round1(wkRecent / 60), accelPct },
            summary: `60〜31日前比で直近30日ペース ${accelPct >= 0 ? '+' : ''}${accelPct}%`,
            advice: accelPct < 0
              ? '直前期に入って学習ペースが落ちています。睡眠を確保しつつ、日々の最低稼働ラインを再設定しましょう。'
              : '試験に向けて順調にギアを上げられています！'
          }, weights);
        }
      }
    })();

    // M45 残り日数別「学習内容バランス」適合度
    (() => {
      if (daysToExam === null || totalAllMins <= 0) {
        metrics.M45 = makeMetric('M45', 'F', '残り日数別「学習内容バランス」適合度', { status: 'insufficient_data' }, weights);
      } else {
        const rec14 = logs.filter(l => l.date >= fmtDateISO(new Date(todayDate.getTime() - 14 * 86400000)));
        const baseLogs = rec14.length ? rec14 : logs;
        const tot = baseLogs.reduce((s, l) => s + l.minutes, 0);
        const actualMix = {
          lecture: pct(baseLogs.filter(l => l.materialType === 'lecture').reduce((s, l) => s + l.minutes, 0), tot),
          text: pct(baseLogs.filter(l => l.materialType === 'text').reduce((s, l) => s + l.minutes, 0), tot),
          drill: pct(baseLogs.filter(l => l.materialType === 'drill').reduce((s, l) => s + l.minutes, 0), tot)
        };
        let ideal = { lecture: 40, text: 30, drill: 30, phase: '基礎・インプット期(90日以上)' };
        if (daysToExam <= 14) ideal = { lecture: 0, text: 30, drill: 70, phase: '超直前期(14日以内)' };
        else if (daysToExam <= 29) ideal = { lecture: 5, text: 25, drill: 70, phase: '直前期(15〜29日)' };
        else if (daysToExam <= 89) ideal = { lecture: 15, text: 25, drill: 60, phase: '演習強化期(30〜89日)' };

        const drillGap = round1(actualMix.drill - ideal.drill);
        const lecGap = round1(actualMix.lecture - ideal.lecture);
        const maxGap = Math.max(Math.abs(drillGap), Math.abs(lecGap));
        metrics.M45 = makeMetric('M45', 'F', '残り日数別「学習内容バランス」適合度', {
          status: drillGap <= -20 || lecGap >= 20 ? 'alert' : maxGap >= 15 ? 'warning' : 'strength',
          value: { daysToExam, phase: ideal.phase, actualMix, idealMix: ideal, drillGapPt: drillGap, lectureGapPt: lecGap },
          summary: `残り${daysToExam}日(${ideal.phase})：回転実績${actualMix.drill}% vs 理想${ideal.drill}%（差 ${drillGap >= 0 ? '+' : ''}${drillGap}pt）`,
          advice: drillGap <= -15
            ? `${ideal.phase}に対して回転教材が不足（講義${actualMix.lecture}%）しています。アウトプット中心へ即シフトしましょう。`
            : `試験残り${daysToExam}日に最適な学習内容バランスを保てています！`
        }, weights);
      }
    })();

    // M46 直前期の新規論点深入り危険度
    (() => {
      if (daysToExam === null || daysToExam > 14) {
        metrics.M46 = makeMetric('M46', 'F', '直前期の新規論点深入り危険度', { status: 'insufficient_data' }, weights);
      } else {
        const borderISO = fmtDateISO(new Date(parseDateISO(nearestExam.date).getTime() - 14 * 86400000));
        const pastTopics = new Set(logs.filter(l => l.date < borderISO && l.topic).map(l => `${l.subject}::${l.topic}`));
        const recent = logs.filter(l => l.date >= borderISO && l.topic);
        const recTotal = recent.reduce((s, l) => s + l.minutes, 0);
        if (!recTotal) {
          metrics.M46 = makeMetric('M46', 'F', '直前期の新規論点深入り危険度', { status: 'insufficient_data' }, weights);
        } else {
          const newMins = recent.filter(l => !pastTopics.has(`${l.subject}::${l.topic}`)).reduce((s, l) => s + l.minutes, 0);
          const newPct = pct(newMins, recTotal);
          metrics.M46 = makeMetric('M46', 'F', '直前期の新規論点深入り危険度', {
            status: newPct >= 25 ? 'alert' : newPct >= 15 ? 'warning' : 'strength',
            value: { newTopicPct: newPct, newMins, totalRecentMins: recTotal },
            summary: `直前14日間の新規論点投入率 ${newPct}%`,
            advice: newPct >= 15
              ? '直前期に未出論点へ手を広げています。新規論点は打ち切り、既習Aランク論点の精度を100%に引き上げましょう。'
              : '直前期に新規論点へ深入りせず、既習の総復習に集中できています。'
          }, weights);
        }
      }
    })();

    // M47 直前期の難問沼ハマり率
    (() => {
      if (daysToExam === null || daysToExam > 21 || !mistakes.length) {
        metrics.M47 = makeMetric('M47', 'F', '直前期の難問沼ハマり率', { status: 'insufficient_data' }, weights);
      } else {
        const borderISO = fmtDateISO(new Date(parseDateISO(nearestExam.date).getTime() - 21 * 86400000));
        const hardTopics = mistakes.filter(m => Number(m.accuracy) < 40);
        const recLogs = logs.filter(l => l.date >= borderISO);
        const recTot = recLogs.reduce((s, l) => s + l.minutes, 0);
        if (!recTot || !hardTopics.length) {
          metrics.M47 = makeMetric('M47', 'F', '直前期の難問沼ハマり率', { status: 'insufficient_data' }, weights);
        } else {
          const hardMins = recLogs.filter(l => hardTopics.some(m => m.subject === l.subject && (topicMatches(l.topic, m.memo) || topicMatches(l.memo, m.qNo)))).reduce((s, l) => s + l.minutes, 0);
          const hardPct = pct(hardMins, recTot);
          metrics.M47 = makeMetric('M47', 'F', '直前期の難問沼ハマり率', {
            status: hardPct >= 20 ? 'alert' : hardPct >= 10 ? 'warning' : 'strength',
            value: { hardReviewPct: hardPct, hardMins },
            summary: `直前21日間のCランク難問復習割合 ${hardPct}%`,
            advice: hardPct >= 10
              ? '正答率40%未満の難問に時間を使いすぎています。直前期は正答率60%以上の取りこぼし撲滅に全振りしましょう。'
              : '難問沼を避けて得点効率の高い論点に集中できています。'
          }, weights);
        }
      }
    })();

    // M48 直前期の総回転バランス（放置科目アラート）
    (() => {
      if (!subjects.length || !logs.length) {
        metrics.M48 = makeMetric('M48', 'F', '直前期の総回転バランス（放置科目アラート）', { status: 'insufficient_data' }, weights);
      } else {
        const sevenDaysAgo = fmtDateISO(new Date(todayDate.getTime() - 7 * 86400000));
        const neglected = [];
        subjects.forEach(s => {
          const sLogs = logs.filter(l => l.subject === s);
          const recent = sLogs.filter(l => l.date >= sevenDaysAgo);
          if (!recent.length) {
            const lastDate = sLogs.length ? sLogs[sLogs.length - 1].date : null;
            const daysSince = lastDate ? diffDays(lastDate, todayISO) : 99;
            neglected.push({ subject: s, daysSince });
          }
        });
        const isCrunch = daysToExam !== null && daysToExam <= 30;
        metrics.M48 = makeMetric('M48', 'F', '直前期の総回転バランス（放置科目アラート）', {
          status: neglected.length > 0 ? (isCrunch ? 'alert' : 'warning') : 'strength',
          value: { neglectedSubjects: neglected, isCrunch },
          summary: neglected.length
            ? `直近7日間0分の放置科目: ${neglected.map(x => `${x.subject}(${x.daysSince >= 99 ? '未記録' : x.daysSince + '日'})`).join('・')}`
            : '全科目が直近7日以内に回転されています ✓',
          advice: neglected.length
            ? `${neglected[0].subject}が7日以上空いています。忘却を防ぐため、今日15分だけでもコンサマ・短答に触れましょう。`
            : '全科目をバランスよく回し続けられています！',
          actionHint: neglected.length ? { type: 'timer', subject: neglected[0].subject, minutes: 20, label: `放置科目「${neglected[0].subject}」を20分起動` } : null
        }, weights);
      }
    })();

    // M49 本試験時間帯シンクロ率
    (() => {
      const timedLogs = logs.filter(l => l.startMin !== null);
      if (!timedLogs.length) {
        metrics.M49 = makeMetric('M49', 'F', '本試験時間帯シンクロ率', { status: 'insufficient_data' }, weights);
      } else {
        // 本試験時間帯: 09:30(570)〜11:30(690), 13:30(810)〜15:30(930)
        const inExamSlot = timedLogs.filter(l => (l.startMin >= 570 && l.startMin < 690) || (l.startMin >= 810 && l.startMin < 930));
        const inSlotMins = inExamSlot.reduce((s, l) => s + l.minutes, 0);
        const drillInSlotMins = inExamSlot.filter(l => l.materialType === 'drill').reduce((s, l) => s + l.minutes, 0);
        if (!inSlotMins) {
          metrics.M49 = makeMetric('M49', 'F', '本試験時間帯シンクロ率', { status: 'insufficient_data' }, weights);
        } else {
          const syncPct = pct(drillInSlotMins, inSlotMins);
          metrics.M49 = makeMetric('M49', 'F', '本試験時間帯シンクロ率', {
            status: syncPct >= 65 ? 'strength' : syncPct < 35 ? 'warning' : 'normal',
            value: { syncPct, drillInSlotMins, inSlotMins },
            summary: `本試験時間帯(9:30-11:30/13:30-15:30)の演習比率 ${syncPct}%`,
            advice: syncPct < 50
              ? '本試験と同じ時間帯に答練・問題演習を行うことで本番の脳リズムが仕上がります。午前・午後のコア枠を演習に充てましょう。'
              : '本試験時間帯にしっかり演習モードへシンクロできています！'
          }, weights);
        }
      }
    })();

    // =========================================================================
    // 【カテゴリG：継続性・習慣・コンディション予兆（M50〜M55）】
    // =========================================================================
    // M50 直前期メンタル安定度（集中度分散）
    (() => {
      const rec14 = ratedLogs.filter(l => l.date >= fmtDateISO(new Date(todayDate.getTime() - 14 * 86400000)));
      if (rec14.length < 4) {
        metrics.M50 = makeMetric('M50', 'G', '直前期メンタル安定度（集中度分散）', { status: 'insufficient_data' }, weights);
      } else {
        const scores = rec14.map(l => l.ratingScore);
        const mean = avg(scores);
        const variance = round1(avg(scores.map(x => Math.pow(x - mean, 2))));
        const recentPoor = pct(rec14.slice(-5).filter(l => l.ratingCode === '△').length, Math.min(5, rec14.length));
        metrics.M50 = makeMetric('M50', 'G', '直前期メンタル安定度（集中度分散）', {
          status: recentPoor >= 60 || variance >= 0.75 ? 'alert' : variance >= 0.55 ? 'warning' : 'strength',
          value: { variance, avgScore: round1(mean), recent5PoorPct: recentPoor },
          summary: `直近14日の集中度分散 ${variance} / 直近5回の△率 ${recentPoor}%`,
          advice: recentPoor >= 60
            ? '直近で△が急増しています。疲労や焦りのサインです。今日は早めに切り上げて7時間睡眠を優先しましょう。'
            : 'メンタル・集中度ともに安定して推移しています。'
        }, weights);
      }
    })();

    // M51 スランプ前兆シグナル一致度
    (() => {
      if (logs.length < 6) {
        metrics.M51 = makeMetric('M51', 'G', 'スランプ前兆シグナル一致度', { status: 'insufficient_data' }, weights);
      } else {
        const recent7 = logs.slice(-7);
        const sigShort = avg(recent7.map(l => l.minutes)) < (avg(logs.map(l => l.minutes)) * 0.75);
        let maxPoorStreak = 0, cur = 0;
        recent7.forEach(l => {
          if (l.ratingCode === '△') { cur++; maxPoorStreak = Math.max(maxPoorStreak, cur); }
          else if (l.ratingCode) cur = 0;
        });
        const sigPoor3 = maxPoorStreak >= 3;
        const m14Val = metrics.M14?.value?.achievementPct;
        const sigMissPlan = m14Val !== undefined && m14Val !== null && m14Val < 70;
        const matched = [sigShort, sigPoor3, sigMissPlan].filter(Boolean).length;
        const matchPct = Math.round((matched / 3) * 100);
        metrics.M51 = makeMetric('M51', 'G', 'スランプ前兆シグナル一致度', {
          status: matchPct >= 67 ? 'alert' : matchPct >= 33 ? 'warning' : 'strength',
          value: { matchPct, signals: { shortCool: sigShort, poor3Streak: sigPoor3, planMiss: sigMissPlan } },
          summary: `スランプ前兆3シグナル一致度 ${matchPct}%（${matched}/3該当）`,
          advice: matchPct >= 67
            ? '「1クール短縮・△連続・予定未達」のスランプ前兆が点灯しています。思い切って半日オフを入れてリセットしましょう。'
            : 'スランプ前兆シグナルは落ち着いています。'
        }, weights);
      }
    })();

    // M52 完全オフ日（ゼロ学習日）の最適間隔
    (() => {
      if (activeDates.length < 7) {
        metrics.M52 = makeMetric('M52', 'G', '完全オフ日（ゼロ学習日）の最適間隔', { status: 'insufficient_data' }, weights);
      } else {
        // 連続稼働日数ごとの◎率と、オフ日翌日の◎率を比較
        const byStreakDay = {};
        const postOffGreat = [];
        let streak = 0;
        const firstDt = parseDateISO(activeDates[0]);
        const lastDt = parseDateISO(activeDates[activeDates.length - 1]);
        let prevWasOff = false;
        for (let t = firstDt.getTime(); t <= lastDt.getTime(); t += 86400000) {
          const iso = fmtDateISO(new Date(t));
          const dl = logsByDate[iso] || [];
          if (!dl.length) {
            streak = 0;
            prevWasOff = true;
            continue;
          }
          streak++;
          const rated = dl.filter(l => l.ratingCode);
          if (rated.length) {
            const gRate = pct(rated.filter(l => l.ratingCode === '◎').length, rated.length);
            const bucket = Math.min(10, streak);
            if (!byStreakDay[bucket]) byStreakDay[bucket] = [];
            byStreakDay[bucket].push(gRate);
            if (prevWasOff) postOffGreat.push(gRate);
          }
          prevWasOff = false;
        }
        let dropDay = null;
        const base = byStreakDay[1] ? avg(byStreakDay[1]) : overallGreatRate;
        for (let d = 3; d <= 10; d++) {
          if (byStreakDay[d] && base !== null && avg(byStreakDay[d]) <= base - 15) {
            dropDay = d;
            break;
          }
        }
        const recoveryPt = (postOffGreat.length && overallGreatRate !== null) ? round1(avg(postOffGreat) - overallGreatRate) : null;
        metrics.M52 = makeMetric('M52', 'G', '完全オフ日（ゼロ学習日）の最適間隔', {
          status: dropDay ? 'normal' : 'normal',
          value: { dropStartStreakDay: dropDay || 7, postOffRecoveryPt: recoveryPt },
          summary: `${dropDay ? `${dropDay}日連続稼働で◎率低下` : '連続稼働耐性は良好'}${recoveryPt !== null ? ` / 完全休養翌日の回復 ${recoveryPt >= 0 ? '+' : ''}${recoveryPt}pt` : ''}`,
          advice: `${dropDay || 7}日に1回は完全オフ（または半日休養）を計画的に入れると、翌日の集中力が最大回復します。`
        }, weights);
      }
    })();

    // M53 学習開始ハードル突破率（5分ルール効果）
    (() => {
      if (activeDates.length < 3 || avgDailyMins <= 0) {
        metrics.M53 = makeMetric('M53', 'G', '学習開始ハードル突破率（5分ルール効果）', { status: 'insufficient_data' }, weights);
      } else {
        const shortStartDays = activeDates.filter(d => logsByDate[d][0] && logsByDate[d][0].minutes < 30);
        if (!shortStartDays.length) {
          metrics.M53 = makeMetric('M53', 'G', '学習開始ハードル突破率（5分ルール効果）', { status: 'insufficient_data' }, weights);
        } else {
          const achieved = shortStartDays.filter(d => dailyTotals[d] >= avgDailyMins * 0.85).length;
          const breakPct = pct(achieved, shortStartDays.length);
          metrics.M53 = makeMetric('M53', 'G', '学習開始ハードル突破率（5分ルール効果）', {
            status: breakPct >= 65 ? 'strength' : 'normal',
            value: { shortStartDays: shortStartDays.length, achievedDays: achieved, breakthroughPct: breakPct },
            summary: `30分未満スタート日の目標達成率 ${breakPct}%（${achieved}/${shortStartDays.length}日）`,
            advice: breakPct >= 60
              ? '「まず短時間だけ始める」5分ルールが絶大な効果を発揮しています！やる気が出ない日もまず10分タイマーを押しましょう。'
              : '短時間スタート後にそのまま止まりがちです。最初の10分で次の教材を机に広げておきましょう。'
          }, weights);
        }
      }
    })();

    // M54 ベストウィーク再現条件
    (() => {
      const byWeek = {};
      logs.forEach(l => {
        if (!l.weekKey) return;
        if (!byWeek[l.weekKey]) byWeek[l.weekKey] = [];
        byWeek[l.weekKey].push(l);
      });
      const wkEntries = Object.entries(byWeek).filter(([, arr]) => arr.length >= 3);
      if (!wkEntries.length) {
        metrics.M54 = makeMetric('M54', 'G', 'ベストウィーク再現条件', { status: 'insufficient_data' }, weights);
      } else {
        const scored = wkEntries.map(([wk, arr]) => {
          const tot = arr.reduce((s, l) => s + l.minutes, 0);
          const rated = arr.filter(l => l.ratingCode);
          const gRate = rated.length ? pct(rated.filter(l => l.ratingCode === '◎').length, rated.length) : 50;
          return { weekStart: wk, totalMins: tot, greatRate: gRate, score: tot * (0.5 + gRate / 100), arr };
        }).sort((a, b) => b.score - a.score);
        const best = scored[0];
        const startMins = best.arr.filter(l => l.startMin !== null).map(l => l.startMin);
        const avgStart = startMins.length ? formatTimeMin(avg(startMins)) : '--:--';
        const avgCool = Math.round(avg(best.arr.map(l => l.minutes)));
        const firstSubj = best.arr[0]?.subject || '--';
        metrics.M54 = makeMetric('M54', 'G', 'ベストウィーク再現条件', {
          status: 'strength',
          value: { weekStart: best.weekStart, totalHours: round1(best.totalMins / 60), greatRate: best.greatRate, avgStart, avgCoolMins: avgCool, firstSubject: firstSubj },
          summary: `ベスト週(${best.weekStart}〜): ${(best.totalMins / 60).toFixed(1)}h / ◎率${best.greatRate}%（開始${avgStart}・平均${avgCool}分/回・初手${firstSubj}）`,
          advice: `最高パフォーマンスだった週の型「${avgStart}開始・1クール${avgCool}分・初手${firstSubj}」を今週も再現しましょう！`
        }, weights);
      }
    })();

    // M55 記録空白と成績下降の相関
    (() => {
      if (activeDates.length < 4 || allExamsCombined.length < 2) {
        metrics.M55 = makeMetric('M55', 'G', '記録空白と成績下降の相関', { status: 'insufficient_data' }, weights);
      } else {
        const gapExamDeltas = [];
        for (let i = 1; i < allExamsCombined.length; i++) {
          const curr = allExamsCombined[i];
          const prev = allExamsCombined.slice(0, i).reverse().find(e => e.subject === curr.subject && e.deviation !== null);
          if (!prev || curr.deviation === null) continue;
          // 直前7日間に2日以上連続空白があったかチェック
          const examDt = parseDateISO(curr.date);
          let maxGap = 0, curGap = 0;
          for (let d = 7; d >= 1; d--) {
            const iso = fmtDateISO(new Date(examDt.getTime() - d * 86400000));
            if (!logsByDate[iso]) { curGap++; maxGap = Math.max(maxGap, curGap); }
            else curGap = 0;
          }
          if (maxGap >= 2) {
            gapExamDeltas.push(curr.deviation - prev.deviation);
          }
        }
        if (!gapExamDeltas.length) {
          metrics.M55 = makeMetric('M55', 'G', '記録空白と成績下降の相関', { status: 'insufficient_data' }, weights);
        } else {
          const avgDelta = round1(avg(gapExamDeltas));
          metrics.M55 = makeMetric('M55', 'G', '記録空白と成績下降の相関', {
            status: avgDelta <= -2 ? 'alert' : avgDelta < 0 ? 'warning' : 'normal',
            value: { avgDeviationDelta: avgDelta, sampleCount: gapExamDeltas.length },
            summary: `2日以上空白があった週の直後答練：偏差値平均 ${avgDelta >= 0 ? '+' : ''}${avgDelta}`,
            advice: avgDelta < 0
              ? '記録が2日以上途絶えると直後答練の偏差値が明確に下がっています。忙しい日も「5分だけ記録」で連続を繋ぎましょう。'
              : '短い空白があっても成績への悪影響は小さく抑えられています。'
          }, weights);
        }
      }
    })();

    // =========================================================================
    // 3. ユーザー追加のカスタム指標（M56〜）の動的評価
    // =========================================================================
    const customMetrics = [];
    const customDefs = Array.isArray(coachProfile.custom_metrics) ? coachProfile.custom_metrics : [];
    customDefs.forEach((cm, idx) => {
      const id = cm.id || `M${56 + idx}`;
      const params = cm.params || {};
      let status = 'normal';
      let summary = cm.description || 'ユーザー独自指標（監視中）';
      let value = {};

      if (cm.ruleType === 'keyword_minutes' && params.keyword) {
        const kw = String(params.keyword).toLowerCase();
        const rec7 = logs.filter(l => l.date >= fmtDateISO(new Date(todayDate.getTime() - 7 * 86400000)));
        const mins = rec7.filter(l => `${l.subject} ${l.material} ${l.topic} ${l.memo}`.toLowerCase().includes(kw)).reduce((s, l) => s + l.minutes, 0);
        const target = Number(params.targetMinutes) || 60;
        status = mins >= target ? 'strength' : 'warning';
        summary = `直近7日の「${params.keyword}」関連学習: ${mins}分 / 目標${target}分`;
        value = { mins, target };
      } else if (cm.ruleType === 'subject_min_ratio' && params.subject) {
        const rec7 = logs.filter(l => l.date >= fmtDateISO(new Date(todayDate.getTime() - 7 * 86400000)));
        const tot = rec7.reduce((s, l) => s + l.minutes, 0);
        const subM = rec7.filter(l => l.subject === params.subject).reduce((s, l) => s + l.minutes, 0);
        const ratio = tot ? pct(subM, tot) : 0;
        const targetRatio = Number(params.targetRatio) || 15;
        status = tot === 0 ? 'insufficient_data' : (ratio >= targetRatio ? 'strength' : 'warning');
        summary = `直近7日の「${params.subject}」比率: ${ratio}% / 目標${targetRatio}%`;
        value = { ratio, targetRatio };
      }

      const evaluated = makeMetric(id, 'custom', cm.name || `カスタム指標 ${id}`, {
        status,
        value,
        summary,
        advice: cm.description || ''
      }, weights);
      metrics[id] = evaluated;
      customMetrics.push(evaluated);
    });

    // サマリー統計
    const allMetricObjs = Object.values(metrics);
    const computedCount = allMetricObjs.filter(m => m.status !== 'insufficient_data').length;
    const insufficientCount = allMetricObjs.length - computedCount;
    const strengthCount = allMetricObjs.filter(m => m.status === 'strength').length;
    const warningCount = allMetricObjs.filter(m => m.status === 'warning').length;
    const alertCount = allMetricObjs.filter(m => m.status === 'alert').length;

    return {
      generatedAt: new Date().toISOString(),
      overview: {
        totalLogs: logs.length,
        totalMinutes: totalAllMins,
        activeDays: activeDates.length,
        materialTypeMix: {
          lecturePct: totalAllMins ? pct(typeTotals.lecture, totalAllMins) : 0,
          textPct: totalAllMins ? pct(typeTotals.text, totalAllMins) : 0,
          drillPct: totalAllMins ? pct(typeTotals.drill, totalAllMins) : 0,
          lectureMins: typeTotals.lecture,
          textMins: typeTotals.text,
          drillMins: typeTotals.drill
        },
        nearestExam,
        examCount: allExamsCombined.length,
        mistakeCount: mistakes.length,
        computedCount,
        insufficientCount,
        strengthCount,
        warningCount,
        alertCount
      },
      categories: METRIC_CATEGORIES,
      depthGroups: DEPTH_GROUPS,
      metrics,
      customMetrics
    };
  }

  // =========================================================================
  // 4. ローカル即時コーチダイジェスト生成（AI未実行時・オフライン時フォールバック）
  // =========================================================================
  function buildLocalCoachDigest(metricsReport, mode, persona) {
    const metrics = metricsReport?.metrics || {};
    const targetIds = DEPTH_GROUPS[mode] || DEPTH_GROUPS.daily;
    const pool = targetIds.map(id => metrics[id]).filter(Boolean);
    const allComputed = Object.values(metrics).filter(m => m.status !== 'insufficient_data');

    const sortByWeightAndSeverity = (arr) => [...arr].sort((a, b) => {
      const sev = { alert: 3, warning: 2, strength: 1, normal: 0, insufficient_data: -1 };
      const scoreA = (sev[a.status] || 0) * (a.weight ?? 1);
      const scoreB = (sev[b.status] || 0) * (b.weight ?? 1);
      return scoreB - scoreA;
    });

    const strengths = sortByWeightAndSeverity(pool.filter(m => m.status === 'strength'))
      .concat(sortByWeightAndSeverity(allComputed.filter(m => m.status === 'strength' && !targetIds.includes(m.id))))
      .slice(0, 2)
      .map(m => ({
        metricId: m.id,
        title: `${m.id} ${m.name}`,
        detail: `${m.summary}。${m.advice}`
      }));

    const improvements = sortByWeightAndSeverity(pool.filter(m => m.status === 'alert' || m.status === 'warning'))
      .concat(sortByWeightAndSeverity(allComputed.filter(m => (m.status === 'alert' || m.status === 'warning') && !targetIds.includes(m.id))))
      .filter(m => (m.weight ?? 1) > 0.05)
      .slice(0, 3)
      .map((m, idx) => ({
        metricId: m.id,
        priority: idx + 1,
        badge: m.categoryName,
        title: `${m.id} ${m.name}`,
        detail: `${m.summary}。${m.advice}`,
        actionType: m.actionHint?.type || 'timer',
        actionLabel: m.actionHint?.label || '25分タイマーで改善着手',
        actionPayload: m.actionHint || { minutes: 25 }
      }));

    const tonePrefix = persona === 'passionate'
      ? 'ナイス積み上げです！'
      : persona === 'spartan'
        ? '合格ボーダーから逆算した現実を見ましょう。'
        : '定量データに基づく分析結果です。';

    const modeTitle = mode === 'latest_exam'
      ? '最新答練の失点・復習診断'
      : mode === 'daily'
        ? '毎日ライト分析（今日の集中最適化）'
        : mode === 'weekly'
          ? '週末ミドル分析（予実・回転バランス）'
          : '月末ディープ分析（成績相関・時期適応）';

    return {
      headline: modeTitle,
      summary: `${tonePrefix} 全55指標のうち${metricsReport.overview.computedCount}指標を算出（強み${metricsReport.overview.strengthCount}件 / 要改善${metricsReport.overview.alertCount + metricsReport.overview.warningCount}件）。`,
      strengths,
      improvements,
      nextAction: improvements[0]
        ? `${improvements[0].title}の改善に向けて、まずは「${improvements[0].actionLabel}」を実行しましょう。`
        : '現在の好調なリズムを維持し、回転教材のアウトプットを積み上げましょう。'
    };
  }

  // =========================================================================
  // 5. 既存10パターン診断（後方互換維持）
  // =========================================================================
  function computeSessionMatrix(logs, getSubjectType) {
    const typeFn = getSubjectType || defaultGetSubjectType;
    const matrix = {
      morning: { label: '朝 (5〜11時)', calc: { mins: [], scores: [] }, theory: { mins: [], scores: [] } },
      day: { label: '昼 (12〜17時)', calc: { mins: [], scores: [] }, theory: { mins: [], scores: [] } },
      night: { label: '夜 (18〜4時)', calc: { mins: [], scores: [] }, theory: { mins: [], scores: [] } }
    };
    (logs || []).forEach(l => {
      const mins = Number(l.minutes) || 0;
      if (mins <= 0) return;
      const hr = parseHourFromTimeStr(l.start_time) ?? parseHourFromTimeStr(l.end_time);
      const band = getTimeBand(hr);
      const type = typeFn(l.subject);
      matrix[band][type].mins.push(mins);
      const sc = ratingToScore(l.rating);
      if (sc !== null) matrix[band][type].scores.push(sc);
    });
    ['morning', 'day', 'night'].forEach(b => {
      ['calc', 'theory'].forEach(t => {
        matrix[b][t].avgMins = avg(matrix[b][t].mins);
        matrix[b][t].avgScore = avg(matrix[b][t].scores);
        matrix[b][t].count = matrix[b][t].mins.length;
      });
    });
    return matrix;
  }

  const CPA_COACH_RULES = [
    {
      id: 'p1', priority: 85, title: '① 朝計算の失速', badge: '時間帯最適化',
      advice: '朝の計算1クールが45分未満で失速気味です。朝は理論の暗記・回転に充て、まとまった集中が作りやすい午後へ計算演習を移動しましょう。',
      evaluate(ctx) {
        const morningCalcAvg = ctx.matrix.morning.calc.avgMins;
        const calcExams = ctx.exams.filter(e => ctx.getSubjectType(e.subject) === 'calc');
        const calcExamPct = calcExams.length ? calcExams.reduce((s, e) => s + ((e.score / (e.maxScore || 100)) * 100), 0) / calcExams.length : null;
        return {
          triggered: morningCalcAvg !== null && morningCalcAvg < 45 && (calcExamPct === null || calcExamPct < 75),
          metric: morningCalcAvg !== null ? `朝計算の平均1クール: ${Math.round(morningCalcAvg)}分` : '朝計算のログ不足'
        };
      }
    },
    {
      id: 'p2', priority: 82, title: '② 夜理論の集中低下', badge: '時間帯最適化',
      advice: '夜21時以降の理論学習で集中度低下・先走り読みが出ています。夜は手を動かして進められる「計算の個別問題」へ切り替えましょう。',
      evaluate(ctx) {
        const lateTheoryLogs = ctx.logs.filter(l => {
          const h = parseHourFromTimeStr(l.start_time);
          return ctx.getSubjectType(l.subject) === 'theory' && h !== null && (h >= 21 || h <= 3);
        });
        const scores = lateTheoryLogs.map(l => ratingToScore(l.rating)).filter(x => x !== null);
        const avgSc = avg(scores);
        const hasRushMistake = ctx.mistakes.some(m => m.causeTag === '先走り読み・設問誤読');
        return {
          triggered: (avgSc !== null && avgSc <= 1.7) || (lateTheoryLogs.length > 0 && hasRushMistake),
          metric: avgSc !== null ? `21時以降の理論集中度: ${(avgSc / 3 * 100).toFixed(0)}%` : (lateTheoryLogs.length ? '21時以降の理論ログあり' : '21時以降の理論ログなし')
        };
      }
    },
    {
      id: 'p3', priority: 80, title: '③ 1クール超過による集中切れ', badge: 'リズム改善',
      advice: '120分を超える連続学習の直後に集中度が急落しています。「90分学習＋15分休憩」のブロック制に区切って後半の質を守りましょう。',
      evaluate(ctx) {
        let longDropCount = 0;
        const sortedLogs = [...ctx.logs].sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
        for (let i = 0; i < sortedLogs.length; i++) {
          if (Number(sortedLogs[i].minutes) > 120) {
            const next = sortedLogs[i + 1];
            const curSc = ratingToScore(sortedLogs[i].rating);
            const nextSc = next && next.date === sortedLogs[i].date ? ratingToScore(next.rating) : null;
            if ((nextSc !== null && curSc !== null && nextSc < curSc) || nextSc === 1 || curSc === 1) longDropCount++;
          }
        }
        return { triggered: longDropCount > 0, metric: `120分超後の集中低下: ${longDropCount}回検出` };
      }
    },
    {
      id: 'p4', priority: 95, title: '④ 基礎（正答率60%以上）の取りこぼし過多', badge: '最優先',
      advice: '勉強量は確保できている一方で、全体正答率60%以上の基礎問題で取りこぼしが多い状態です。難問に手を広げず「Aランク回転教材」へ集中しましょう。',
      evaluate(ctx) {
        const highAccMistakes = ctx.mistakes.filter(m => Number(m.accuracy) >= 60);
        return {
          triggered: highAccMistakes.length >= 3 && (ctx.weekTotalActual >= 600 || ctx.logs.length >= 5),
          metric: `正答率60%以上の誤答: ${highAccMistakes.length}問`
        };
      }
    },
    {
      id: 'p5', priority: 92, title: '⑤ 本番での問題選球眼ズレ', badge: '本番戦略',
      advice: '捨て問(C)と判断した問題の中に、周囲の60%以上が解けている基本問題が複数あります。解答開始3分の全体スキャンと総論整理を徹底しましょう。',
      evaluate(ctx) {
        const cHighAcc = ctx.mistakes.filter(m => m.feeling === 'C' && Number(m.accuracy) >= 60);
        return { triggered: cHighAcc.length >= 2, metric: `体感C判定×正答率60%以上: ${cHighAcc.length}問` };
      }
    },
    {
      id: 'p6', priority: 84, title: '⑥ 時間投入過多の「空回り科目」検出', badge: '配分見直し',
      advice: '特定科目に週間時間の35%以上を投入していますが点数が伸び悩んでいます。作業的な反復を止め、抽象・背景理解への回帰と講師相談を行いましょう。',
      evaluate(ctx) {
        let spinSubject = null, spinShare = 0;
        if (ctx.weekTotalActual > 0) {
          (ctx.subjects || []).forEach(s => {
            const share = (ctx.weekActualMap[s] || 0) / ctx.weekTotalActual;
            if (share >= 0.35) {
              const subEx = ctx.exams.filter(e => e.subject === s).sort((a, b) => new Date(b.date) - new Date(a.date));
              const stagnant = !subEx.length || (subEx[0].score / (subEx[0].maxScore || 100) < 0.72) || (subEx.length >= 2 && subEx[0].score <= subEx[1].score + 2);
              if (stagnant && share > spinShare) { spinSubject = s; spinShare = share; }
            }
          });
        }
        return {
          triggered: !!spinSubject,
          metric: spinSubject ? `${spinSubject}: 週間比率 ${(spinShare * 100).toFixed(0)}%` : '偏りなし',
          advice: spinSubject ? `「${spinSubject}」に週間時間の35%以上を投入していますが点数が伸び悩んでいます。作業的な反復を止め、抽象・背景理解への回帰と講師相談を行いましょう。` : undefined
        };
      }
    },
    {
      id: 'p7', priority: 78, title: '⑦ 計画過多・慢性的な予実マイナス', badge: '計画調整',
      advice: '3週連続で達成率70%未満かつオフ日なしの過密計画になっています。週1日の「予備日（調整日）」をあらかじめカレンダーに設定しましょう。',
      evaluate(ctx) {
        const recent3 = (ctx.weeklyHistory || []).slice(-3);
        const low3 = recent3.length >= 3 && recent3.every(w => w.planned > 0 && (w.actual / w.planned) < 0.7 && w.activeDays >= 7);
        return {
          triggered: low3,
          metric: recent3.length >= 3 ? `直近3週の達成率: ${recent3.map(w => Math.round((w.actual / Math.max(1, w.planned)) * 100) + '%').join(' / ')}` : '3週分の履歴蓄積中'
        };
      }
    },
    {
      id: 'p8', priority: 98, title: '⑧ 直前期の回転スピード不足', badge: '直前期モード',
      advice: '試験まで2週間以内です。全範囲を丁寧に解き直すのではなく、「間違えた箇所・正答率60%以上の誤答」のみの高速回転へ切り替えましょう。',
      evaluate(ctx) {
        const today0 = new Date(); today0.setHours(0, 0, 0, 0);
        let nearestExam = null, minDays = Infinity;
        (ctx.countdowns || []).forEach(c => {
          const t = new Date(`${c.date}T00:00:00`);
          const diff = Math.ceil((t - today0) / 86400000);
          if (diff >= 0 && diff < minDays) { minDays = diff; nearestExam = c; }
        });
        const hit = nearestExam !== null && minDays <= 14;
        return {
          triggered: hit,
          metric: nearestExam ? `${nearestExam.name} まで残り${minDays}日` : '直前試験なし',
          advice: hit ? `試験まで2週間以内（${nearestExam.name}まで残り${minDays}日）です。全範囲を丁寧に解き直すのではなく、「間違えた箇所・正答率60%以上の誤答」のみの高速回転へ切り替えましょう。` : undefined
        };
      }
    },
    {
      id: 'p9', priority: 88, title: '⑨ 計算の「着手前思考」不足', badge: '計算対策',
      advice: '計算ミスの70%以上が「論点誤認・注意点漏れ」です。電卓を叩く前に10秒だけ立ち止まり、前提条件・問われている数値を確認する「着手前10秒ルール」を徹底しましょう。',
      evaluate(ctx) {
        const calcTagged = ctx.mistakes.filter(m => (m.qType || ctx.getSubjectType(m.subject)) === 'calc' && m.causeTag);
        const calcPreThink = calcTagged.filter(m => m.causeTag === '論点誤認・前提ミス' || m.causeTag === '注意点漏れ・ケアレス');
        const ratio = calcTagged.length ? (calcPreThink.length / calcTagged.length) : 0;
        return {
          triggered: calcTagged.length >= 2 && ratio >= 0.7,
          metric: calcTagged.length ? `論点誤認・注意点漏れ比率: ${Math.round(ratio * 100)}% (${calcPreThink.length}/${calcTagged.length}問)` : '計算タグ未蓄積'
        };
      }
    },
    {
      id: 'p10', priority: 87, title: '⑩ 理論の「線引き外・構造見落とし」過多', badge: '理論対策',
      advice: '理論ミスの60%以上が「線引き外の見落とし・関連知識不足」です。マーク箇所だけでなく前後1文を再読し、関連論点のページ番号をテキストへ書き込みましょう。',
      evaluate(ctx) {
        const theoryTagged = ctx.mistakes.filter(m => (m.qType || ctx.getSubjectType(m.subject)) === 'theory' && m.causeTag);
        const theoryStruct = theoryTagged.filter(m => m.causeTag === '線引き外の見落とし' || m.causeTag === '関連知識・構造不足');
        const ratio = theoryTagged.length ? (theoryStruct.length / theoryTagged.length) : 0;
        return {
          triggered: theoryTagged.length >= 2 && ratio >= 0.6,
          metric: theoryTagged.length ? `線引き外・関連知識不足比率: ${Math.round(ratio * 100)}% (${theoryStruct.length}/${theoryTagged.length}問)` : '理論タグ未蓄積'
        };
      }
    }
  ];

  function evaluateCpaCoachRules(input) {
    const getSubjectType = input.getSubjectType || defaultGetSubjectType;
    const matrix = computeSessionMatrix(input.logs || [], getSubjectType);
    const ctx = {
      logs: input.logs || [],
      mistakes: input.mistakes || [],
      exams: input.exams || [],
      subjects: input.subjects || [],
      countdowns: input.countdowns || [],
      weeklyHistory: input.weeklyHistory || [],
      weekActualMap: input.weekActualMap || {},
      weekTotalActual: input.weekTotalActual || 0,
      getSubjectType,
      matrix
    };
    const patterns = CPA_COACH_RULES.map(rule => {
      const res = rule.evaluate(ctx) || {};
      return {
        id: rule.id,
        priority: rule.priority,
        title: rule.title,
        badge: rule.badge,
        triggered: !!res.triggered,
        metric: res.metric || '',
        advice: res.advice || rule.advice
      };
    });
    const metricsReport = computeAll55Metrics(input);
    return { patterns, matrix, metricsReport };
  }

  global.MATERIAL_TYPE_META = MATERIAL_TYPE_META;
  global.classifyStudyMaterialType = classifyStudyMaterialType;
  global.METRIC_CATEGORIES = METRIC_CATEGORIES;
  global.DEPTH_GROUPS = DEPTH_GROUPS;
  global.computeAll55Metrics = computeAll55Metrics;
  global.buildLocalCoachDigest = buildLocalCoachDigest;
  global.CPA_COACH_RULES = CPA_COACH_RULES;
  global.evaluateCpaCoachRules = evaluateCpaCoachRules;
  global.computeCpaSessionMatrix = computeSessionMatrix;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      MATERIAL_TYPE_META,
      classifyStudyMaterialType,
      METRIC_CATEGORIES,
      DEPTH_GROUPS,
      computeAll55Metrics,
      buildLocalCoachDigest,
      CPA_COACH_RULES,
      evaluateCpaCoachRules,
      computeCpaSessionMatrix
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
