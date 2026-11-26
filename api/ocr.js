module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'Method Not Allowed' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      status: 'error',
      message: 'Vercelの環境変数「GEMINI_API_KEY」が未設定です。Vercel管理画面の Settings → Environment Variables に追加して再デプロイしてください。'
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { base64Data, mimeType, fileName, subjects, mode } = body;

    if (!base64Data || !mimeType) {
      return res.status(400).json({ status: 'error', message: 'ファイルデータが不足しています' });
    }

    const baseSubjects = Array.isArray(subjects) && subjects.length
      ? [...subjects]
      : ['財務(計算)', '財務(理論)', '財務会計論（計算＋理論）', '管理会計', '監査論', '企業法', '租税法', '選択科目', '英語', '数学', '国語', '物理', '化学'];
    if ((baseSubjects.includes('財務(計算)') || baseSubjects.includes('財務(理論)')) && !baseSubjects.includes('財務会計論（計算＋理論）')) {
      baseSubjects.push('財務会計論（計算＋理論）');
    }
    if (!baseSubjects.includes('総合・模試')) baseSubjects.push('総合・模試');
    const subjectList = baseSubjects;

    const todayStr = new Date().toISOString().slice(0, 10);
    const isQuestionMode = mode === 'exam_questions';
    const cpaFinanceRule = '   - 公認会計士試験の財務会計論で、小テストやレギュラー答練等のように計算・理論が分かれている場合は「財務(計算)」「財務(理論)」、本番形式（短答直前答練・模擬試験・論文答練等）で合算されている場合は「財務会計論（計算＋理論）」としてください。';
    const prompt = isQuestionMode
      ? [
        'あなたは日本のあらゆる試験（公認会計士、大学受験・共通テスト模試、税理士、行政書士、社労士など）の模試・答練・定期テストの個人成績表を解析する高精度OCRエンジンです。',
        'アップロードされた画像またはPDF（複数ページ・複数科目含む）から、成績サマリーと問題別の正誤・正答率データをすべて抽出し、指定されたJSONフォーマットのみを出力してください。',
        '',
        '【解析・変換ルール】',
        '1. 複数科目の分割:',
        '   - 1枚の画像や複数ページに複数科目（例：英語・数学・物理、または簿記論・財務諸表論、憲法・行政法・民法など）が含まれる場合は、必ず科目ごとにオブジェクトを分割して `subjects` 配列に格納してください。',
        '   - 社労士試験のように「選択式」と「択一式」が分かれている場合は、科目名を「社労士（選択式）」「社労士（択一式）」のように分けて抽出してください。',
        cpaFinanceRule,
        `   - 登録済み科目リスト（該当するものがあれば表記を合わせる）: ${subjectList.join('、')}`,
        '',
        '2. サマリー情報の抽出:',
        `   - \`exam_title\`: 模試・答練の正式名称（例：「第1回 全統共通テスト模試」「全国統一公開模試」「短答直前答練 第2回」）。不明な場合は「${fileName || '模試・答練'}」。`,
        '   - `date`: 実施日を `YYYY-MM-DD` 形式で抽出。記載がない場合は `null`。',
        '   - `subject`: 科目名（例：「財務(計算)」「財務会計論（計算＋理論）」「英語」「簿記論」「行政法」）。',
        '   - `score` / `max_score`: 素点と満点（数値）。満点の記載がない場合、共通テストや資格試験の標準満点（100や200など）または設問配点の合計から推測し、それも不明なら `100` とする。',
        '   - `rank`: 偏差値・順位・合格判定をまとめた文字列（例：「偏差値 62.4 / A判定 / 1,240位」「上位12.5% / A」）。',
        '',
        '3. 問題別明細（`questions` 配列）の抽出と表記ゆれ吸収:',
        '   - 成績表の「設問別成績」「正答率表」「問題別正誤」の表を1問ずつすべて抽出してください。問題別明細が画像内に存在しない場合は空配列 `[]` にしてください。',
        '   - `q_no`（文字列）: 問題番号。階層がある場合はハイフンで繋ぐ（例：`第1問 問2` → `"1-2"`、`問15` → `"15"`、`選択 労基 A` → `"選択-労基-A"`）。',
        '   - `is_correct`（真偽値）: 「○」「〇」「1」「正解」、または「得点 == 配点（満点）」の場合は `true`。「×」「0」「不正解」、または満点未満の部分点（例：配点5点中3点）はすべて復習対象として `false` にする（正誤記載がなく判別不能なら `true`）。',
        '   - `accuracy`（数値 0〜100）: 全体正答率（%）。`%` 記号は取り除いて数値化（例：`"82.4%"` → `82.4`）。大学受験模試などで「全体正答率」の列がなく「全国平均点」と「配点」のみ記載されている場合は、必ず `(全国平均点 ÷ 配点) × 100` を計算して小数第1位まで格納する。',
        '   - `official_rank`（文字列または `null`）: 予備校が記載している難易度ランク（`"A"`, `"B"`, `"C"`, `"易"`, `"普"`, `"難"` など）があればそのまま抽出。記載がない場合は `null`。',
        '   - `points`（数値）: 配点。記載があればその数値、記載がない場合（1問1点の択一式など）は `1` とする。',
        '   - `q_type`（任意文字列）: 計算問題なら `"calc"`、理論問題なら `"theory"`、判別不要/不明なら `""`。',
        '',
        '【出力JSONスキーマ（JSONのみ・余計な説明やコードブロック記号不要）】',
        '{',
        '  "exam_title": "string",',
        '  "date": "YYYY-MM-DD | null",',
        '  "subjects": [',
        '    {',
        '      "subject": "string",',
        '      "score": 0,',
        '      "max_score": 100,',
        '      "rank": "string",',
        '      "questions": [',
        '        {',
        '          "q_no": "string",',
        '          "is_correct": true,',
        '          "accuracy": 82.4,',
        '          "official_rank": "A",',
        '          "points": 5,',
        '          "q_type": ""',
        '        }',
        '      ]',
        '    }',
        '  ]',
        '}'
      ].join('\n')
      : [
        '添付された模試・答練・定期テストの成績表（PDFまたは画像）から成績情報を正確に読み取り、JSONで返してください。',
        '1枚の成績表に複数科目の点数が記載されている場合は、科目ごと（および総合があれば総合も）に配列へ分けて出力してください。',
        cpaFinanceRule,
        '',
        `【選択可能な科目リスト】${subjectList.join('、')}`,
        `【ファイル名参考】${fileName || '不明'}`,
        `【日付が読み取れない場合のデフォルト】${todayStr}`,
        '',
        '以下のJSON形式のみで返答してください（余計な説明文やコードブロック記号は不要）：',
        '{',
        '  "results": [',
        '    {',
        '      "date": "YYYY-MM-DD",',
        '      "subject": "選択可能な科目リストから最も近いもの1つ",',
        '      "title": "模試・答練・テスト名（例：全統共通テスト模試、短答直前答練 第2回）",',
        '      "score": 78,',
        '      "maxScore": 100,',
        '      "rank": "偏差値や判定・順位（例：偏差値 58.2 / A判定、なければ空文字）",',
        '      "note": "弱点分野・失点ポイント・講評の短い要約（40文字以内、なければ空文字）"',
        '    }',
        '  ]',
        '}'
      ].join('\n');

    const models = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'];
    const payload = JSON.stringify({
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType,
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json'
      }
    });

    let geminiRes = null;
    let geminiJson = null;
    let lastErrorMsg = 'Gemini API Error';

    for (const model of models) {
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      try {
        geminiRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload
        });
        geminiJson = await geminiRes.json();
        if (geminiRes.ok) {
          break;
        }
        lastErrorMsg = geminiJson?.error?.message || `Gemini API Error (${geminiRes.status})`;
      } catch (e) {
        lastErrorMsg = e?.message || 'Gemini API request failed';
        geminiRes = null;
      }
    }

    if (!geminiRes || !geminiRes.ok) {
      return res.status(502).json({ status: 'error', message: lastErrorMsg });
    }

    const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);

    if (isQuestionMode) {
      const normQuestions = (rawQs) => Array.isArray(rawQs)
        ? rawQs
          .filter(q => q && (q.q_no !== undefined || q.qNo !== undefined || q.number !== undefined))
          .map((q, idx) => {
            const accRaw = Number(String(q.accuracy ?? q.rate ?? 50).replace(/%/g, ''));
            const accuracy = Number.isFinite(accRaw) ? Math.max(0, Math.min(100, Math.round(accRaw * 10) / 10)) : 50;
            const isWrong = (q.is_correct !== undefined)
              ? !Boolean(q.is_correct)
              : Boolean(q.isWrong === true || q.isWrong === 'true' || q.result === '×' || q.result === '✕' || q.result === '誤');
            const qTypeRaw = q.q_type || q.qType || '';
            return {
              qNo: String(q.q_no ?? q.qNo ?? q.number ?? `${idx + 1}`),
              accuracy,
              points: Number(q.points || 0) || 1,
              officialRank: (q.official_rank ?? q.officialRank) ? String(q.official_rank ?? q.officialRank) : null,
              qType: (qTypeRaw === 'calc' || qTypeRaw === 'theory') ? qTypeRaw : '',
              isWrong
            };
          })
        : [];

      const topTitle = String(parsed?.exam_title || fileName || '模試・答練');
      const topDate = parsed?.date ? String(parsed.date).replace(/\//g, '-') : todayStr;
      const rawList = Array.isArray(parsed?.subjects)
        ? parsed.subjects
        : Array.isArray(parsed?.exams)
          ? parsed.exams
          : [{ ...(parsed?.exam || {}), questions: parsed?.questions || [] }];

      const normalizedExams = rawList
        .map(ex => {
          const qs = normQuestions(ex?.questions);
          const subj = String(ex?.subject || subjectList[0]);
          const sumPts = qs.reduce((s, q) => s + (Number(q.points) || 0), 0);
          return {
            date: String(ex?.date || topDate || todayStr).replace(/\//g, '-'),
            subject: subj,
            title: String(ex?.title || topTitle || '模試・答練'),
            score: Number(ex?.score) || 0,
            maxScore: Number(ex?.max_score ?? ex?.maxScore) || (sumPts > 0 ? sumPts : (subj.includes('計算＋理論') ? 200 : 100)),
            rank: String(ex?.rank || ''),
            questions: qs
          };
        })
        .filter(ex => ex.subject);

      if (!normalizedExams.length) {
        return res.status(422).json({ status: 'error', message: '成績データを読み取れませんでした。表がはっきり写っている画像またはPDFでお試しください。' });
      }
      return res.status(200).json({
        status: 'ok',
        exam_title: topTitle,
        date: parsed?.date || null,
        subjects: parsed?.subjects || null,
        exams: normalizedExams,
        exam: normalizedExams[0],
        questions: normalizedExams[0].questions
      });
    }

    const items = Array.isArray(parsed?.results)
      ? parsed.results
      : (parsed && typeof parsed === 'object' ? [parsed] : []);

    const normalized = items
      .filter(it => it && (it.title || it.subject) && it.score !== undefined && it.score !== null)
      .map((it, idx) => ({
        id: `ex_ocr_${Date.now()}_${idx}`,
        date: String(it.date || todayStr).replace(/\//g, '-'),
        subject: String(it.subject || subjectList[0]),
        title: String(it.title || fileName || '模試・テスト'),
        score: Number(it.score) || 0,
        maxScore: Number(it.maxScore) || 100,
        rank: String(it.rank || ''),
        note: String(it.note || ''),
        source: 'AI OCR'
      }));

    if (!normalized.length) {
      return res.status(422).json({
        status: 'error',
        message: '成績データを読み取れませんでした。点数がはっきり写っているPDFまたは画像でお試しください。'
      });
    }

    return res.status(200).json({ status: 'ok', results: normalized });
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: err?.message || 'OCR解析中にエラーが発生しました'
    });
  }
}
