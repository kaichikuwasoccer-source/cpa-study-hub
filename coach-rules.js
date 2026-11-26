/**
 * CPA Study Hub - パーソナル改善コーチ ルール定義（外部モジュール）
 * ゼロビルド（Vanilla JS）構成のまま、将来100パターン以上へ拡張しやすい宣言的ルール配列。
 * 各ルールは evaluate(ctx) で { triggered, metric, advice? } を返します。
 */
(function (global) {
  'use strict';

  function parseHourFromTimeStr(t) {
    const m = String(t || '').match(/^(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) : null;
  }

  function ratingToScore(r) {
    const s = String(r || '');
    if (s.includes('◎')) return 3;
    if (s.includes('○')) return 2;
    if (s.includes('△')) return 1;
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
    const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
    ['morning', 'day', 'night'].forEach(b => {
      ['calc', 'theory'].forEach(t => {
        matrix[b][t].avgMins = avg(matrix[b][t].mins);
        matrix[b][t].avgScore = avg(matrix[b][t].scores);
        matrix[b][t].count = matrix[b][t].mins.length;
      });
    });
    return matrix;
  }

  // 10パターンのコーチ診断ルール（ここに新ルールを追記するだけで自動反映）
  const CPA_COACH_RULES = [
    {
      id: 'p1',
      priority: 85,
      title: '① 朝計算の失速',
      badge: '時間帯最適化',
      advice: '朝の計算1クールが45分未満で失速気味です。朝は理論の暗記・回転に充て、まとまった集中が作りやすい午後へ計算演習を移動しましょう。',
      evaluate(ctx) {
        const morningCalcAvg = ctx.matrix.morning.calc.avgMins;
        const calcExams = ctx.exams.filter(e => ctx.getSubjectType(e.subject) === 'calc');
        const calcExamPct = calcExams.length
          ? calcExams.reduce((s, e) => s + ((e.score / (e.maxScore || 100)) * 100), 0) / calcExams.length
          : null;
        return {
          triggered: morningCalcAvg !== null && morningCalcAvg < 45 && (calcExamPct === null || calcExamPct < 75),
          metric: morningCalcAvg !== null ? `朝計算の平均1クール: ${Math.round(morningCalcAvg)}分` : '朝計算のログ不足'
        };
      }
    },
    {
      id: 'p2',
      priority: 82,
      title: '② 夜理論の集中低下',
      badge: '時間帯最適化',
      advice: '夜21時以降の理論学習で集中度低下・先走り読みが出ています。夜は手を動かして進められる「計算の個別問題」へ切り替えましょう。',
      evaluate(ctx) {
        const lateTheoryLogs = ctx.logs.filter(l => {
          const h = parseHourFromTimeStr(l.start_time);
          return ctx.getSubjectType(l.subject) === 'theory' && h !== null && (h >= 21 || h <= 3);
        });
        const scores = lateTheoryLogs.map(l => ratingToScore(l.rating)).filter(x => x !== null);
        const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        const hasRushMistake = ctx.mistakes.some(m => m.causeTag === '先走り読み・設問誤読');
        return {
          triggered: (avg !== null && avg <= 1.7) || (lateTheoryLogs.length > 0 && hasRushMistake),
          metric: avg !== null ? `21時以降の理論集中度: ${(avg / 3 * 100).toFixed(0)}%` : (lateTheoryLogs.length ? '21時以降の理論ログあり' : '21時以降の理論ログなし')
        };
      }
    },
    {
      id: 'p3',
      priority: 80,
      title: '③ 1クール超過による集中切れ',
      badge: 'リズム改善',
      advice: '120分を超える連続学習の直後に集中度が急落しています。「90分学習＋15分休憩」のブロック制に区切って後半の質を守りましょう。',
      evaluate(ctx) {
        let longDropCount = 0;
        const sortedLogs = [...ctx.logs].sort((a, b) => `${a.date} ${a.start_time}`.localeCompare(`${b.date} ${b.start_time}`));
        for (let i = 0; i < sortedLogs.length; i++) {
          if (Number(sortedLogs[i].minutes) > 120) {
            const next = sortedLogs[i + 1];
            const curSc = ratingToScore(sortedLogs[i].rating);
            const nextSc = next && next.date === sortedLogs[i].date ? ratingToScore(next.rating) : null;
            if ((nextSc !== null && curSc !== null && nextSc < curSc) || nextSc === 1 || curSc === 1) {
              longDropCount++;
            }
          }
        }
        return {
          triggered: longDropCount > 0,
          metric: `120分超後の集中低下: ${longDropCount}回検出`
        };
      }
    },
    {
      id: 'p4',
      priority: 95,
      title: '④ 基礎（正答率60%以上）の取りこぼし過多',
      badge: '最優先',
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
      id: 'p5',
      priority: 92,
      title: '⑤ 本番での問題選球眼ズレ',
      badge: '本番戦略',
      advice: '捨て問(C)と判断した問題の中に、周囲の60%以上が解けている基本問題が複数あります。解答開始3分の全体スキャンと総論整理を徹底しましょう。',
      evaluate(ctx) {
        const cHighAcc = ctx.mistakes.filter(m => m.feeling === 'C' && Number(m.accuracy) >= 60);
        return {
          triggered: cHighAcc.length >= 2,
          metric: `体感C判定×正答率60%以上: ${cHighAcc.length}問`
        };
      }
    },
    {
      id: 'p6',
      priority: 84,
      title: '⑥ 時間投入過多の「空回り科目」検出',
      badge: '配分見直し',
      advice: '特定科目に週間時間の35%以上を投入していますが点数が伸び悩んでいます。作業的な反復を止め、抽象・背景理解への回帰と講師相談を行いましょう。',
      evaluate(ctx) {
        let spinSubject = null, spinShare = 0;
        if (ctx.weekTotalActual > 0) {
          (ctx.subjects || []).forEach(s => {
            const share = (ctx.weekActualMap[s] || 0) / ctx.weekTotalActual;
            if (share >= 0.35) {
              const subEx = ctx.exams.filter(e => e.subject === s).sort((a, b) => new Date(b.date) - new Date(a.date));
              const stagnant = !subEx.length
                || (subEx[0].score / (subEx[0].maxScore || 100) < 0.72)
                || (subEx.length >= 2 && subEx[0].score <= subEx[1].score + 2);
              if (stagnant && share > spinShare) { spinSubject = s; spinShare = share; }
            }
          });
        }
        return {
          triggered: !!spinSubject,
          metric: spinSubject ? `${spinSubject}: 週間比率 ${(spinShare * 100).toFixed(0)}%` : '偏りなし',
          advice: spinSubject
            ? `「${spinSubject}」に週間時間の35%以上を投入していますが点数が伸び悩んでいます。作業的な反復を止め、抽象・背景理解への回帰と講師相談を行いましょう。`
            : undefined
        };
      }
    },
    {
      id: 'p7',
      priority: 78,
      title: '⑦ 計画過多・慢性的な予実マイナス',
      badge: '計画調整',
      advice: '3週連続で達成率70%未満かつオフ日なしの過密計画になっています。週1日の「予備日（調整日）」をあらかじめカレンダーに設定しましょう。',
      evaluate(ctx) {
        const recent3 = (ctx.weeklyHistory || []).slice(-3);
        const low3 = recent3.length >= 3 && recent3.every(w => w.planned > 0 && (w.actual / w.planned) < 0.7 && w.activeDays >= 7);
        return {
          triggered: low3,
          metric: recent3.length >= 3
            ? `直近3週の達成率: ${recent3.map(w => Math.round((w.actual / Math.max(1, w.planned)) * 100) + '%').join(' / ')}`
            : '3週分の履歴蓄積中'
        };
      }
    },
    {
      id: 'p8',
      priority: 98,
      title: '⑧ 直前期の回転スピード不足',
      badge: '直前期モード',
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
          advice: hit
            ? `試験まで2週間以内（${nearestExam.name}まで残り${minDays}日）です。全範囲を丁寧に解き直すのではなく、「間違えた箇所・正答率60%以上の誤答」のみの高速回転へ切り替えましょう。`
            : undefined
        };
      }
    },
    {
      id: 'p9',
      priority: 88,
      title: '⑨ 計算の「着手前思考」不足',
      badge: '計算対策',
      advice: '計算ミスの70%以上が「論点誤認・注意点漏れ」です。電卓を叩く前に10秒だけ立ち止まり、前提条件・問われている数値を確認する「着手前10秒ルール」を徹底しましょう。',
      evaluate(ctx) {
        const calcTagged = ctx.mistakes.filter(m => ctx.getSubjectType(m.subject) === 'calc' && m.causeTag);
        const calcPreThink = calcTagged.filter(m => m.causeTag === '論点誤認・前提ミス' || m.causeTag === '注意点漏れ・ケアレス');
        const ratio = calcTagged.length ? (calcPreThink.length / calcTagged.length) : 0;
        return {
          triggered: calcTagged.length >= 2 && ratio >= 0.7,
          metric: calcTagged.length ? `論点誤認・注意点漏れ比率: ${Math.round(ratio * 100)}% (${calcPreThink.length}/${calcTagged.length}問)` : '計算タグ未蓄積'
        };
      }
    },
    {
      id: 'p10',
      priority: 87,
      title: '⑩ 理論の「線引き外・構造見落とし」過多',
      badge: '理論対策',
      advice: '理論ミスの60%以上が「線引き外の見落とし・関連知識不足」です。マーク箇所だけでなく前後1文を再読し、関連論点のページ番号をテキストへ書き込みましょう。',
      evaluate(ctx) {
        const theoryTagged = ctx.mistakes.filter(m => ctx.getSubjectType(m.subject) === 'theory' && m.causeTag);
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
    return { patterns, matrix };
  }

  global.CPA_COACH_RULES = CPA_COACH_RULES;
  global.evaluateCpaCoachRules = evaluateCpaCoachRules;
  global.computeCpaSessionMatrix = computeSessionMatrix;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { CPA_COACH_RULES, evaluateCpaCoachRules, computeCpaSessionMatrix };
  }
})(typeof window !== 'undefined' ? window : globalThis);
