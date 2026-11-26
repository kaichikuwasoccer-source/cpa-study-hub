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
    const cpaFinanceRule = '※公認会計士試験の財務会計論について：小テストやレギュラー答練等で「計算」「理論」が分かれて記載されている場合は「財務(計算)」「財務(理論)」を選択し、短答直前答練・模擬試験・論文答練等の本番形式で計算と理論が合算（1科目）になっている場合は「財務会計論（計算＋理論）」を選択してください。';
    const prompt = isQuestionMode
      ? [
        '添付された答練・模試の成績表（問題別正答率表の画像またはPDF）から、記載されているすべての科目について基本情報と各問題の「問題番号」「全体正答率(%)」「配点(分かれば)」「計算/理論区分(calcまたはtheory、分かれば)」「本人の正誤(isWrong: 誤答・不正解・×・△・0点・正答と解答番号不一致ならtrue、正解・○または判別不能ならfalse)」を正確に抽出し、JSONのみで返してください。',
        '1つの画像/PDFに複数科目（例：財務会計論・管理会計・監査論・企業法など）が載っている場合は、必ず科目ごとに exams 配列へ分けて出力してください。',
        cpaFinanceRule,
        `【選択可能な科目リスト】${subjectList.join('、')}`,
        `【ファイル名参考】${fileName || '不明'}`,
        `【日付デフォルト】${todayStr}`,
        '以下のJSON形式のみで返答してください：',
        '{',
        '  "exams": [',
        '    {',
        '      "date": "YYYY-MM-DD",',
        '      "subject": "科目リストから1つ",',
        '      "title": "答練・模試名",',
        '      "score": 72,',
        '      "maxScore": 100,',
        '      "rank": "判定や偏差値（なければ空文字）",',
        '      "questions": [ { "qNo": "問1", "accuracy": 82, "points": 5, "qType": "calc または theory（不明なら空文字）", "isWrong": false } ]',
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
          .filter(q => q && (q.qNo !== undefined || q.number !== undefined))
          .map((q, idx) => ({
            qNo: String(q.qNo ?? q.number ?? `問${idx + 1}`),
            accuracy: Math.max(0, Math.min(100, Number(q.accuracy ?? q.rate ?? 50) || 0)),
            points: Number(q.points || 0) || 0,
            qType: (q.qType === 'calc' || q.qType === 'theory') ? q.qType : '',
            isWrong: Boolean(q.isWrong === true || q.isWrong === 'true' || q.result === '×' || q.result === '✕' || q.result === '誤')
          }))
        : [];

      const rawExams = Array.isArray(parsed?.exams)
        ? parsed.exams
        : [{ ...(parsed?.exam || {}), questions: parsed?.questions || [] }];

      const normalizedExams = rawExams
        .map(ex => {
          const qs = normQuestions(ex?.questions);
          return {
            date: String(ex?.date || todayStr).replace(/\//g, '-'),
            subject: String(ex?.subject || subjectList[0]),
            title: String(ex?.title || fileName || '答練'),
            score: Number(ex?.score) || 0,
            maxScore: Number(ex?.maxScore) || (String(ex?.subject || '').includes('計算＋理論') ? 200 : 100),
            rank: String(ex?.rank || ''),
            questions: qs
          };
        })
        .filter(ex => ex.questions.length > 0);

      if (!normalizedExams.length) {
        return res.status(422).json({ status: 'error', message: '問題番号・正答率を読み取れませんでした。表がはっきり写っている画像でお試しください。' });
      }
      return res.status(200).json({
        status: 'ok',
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
