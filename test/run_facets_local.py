"""ビッグファイブ 30ファセットを Decisions API で一括採点できるか検証するローカル実験スクリプト。"""
import json
import os
import time
import urllib.error
import urllib.request

from run_decisions_local import MODEL, DECISION_ENDPOINT, format_qa_history, get_cases, load_api_key

# IPIP-NEO 準拠 30ファセット定義（各因子6ファセット）
FACETS = [
    ("E1", "外向性", "親しみやすさ", "初対面や周囲に対して温かく打ち解けやすい度合い"),
    ("E2", "外向性", "社交性", "大人数の場や人との交流を積極的に楽しむ度合い"),
    ("E3", "外向性", "自己主張", "自分の意見をはっきり伝え、場をリード・仕切る度合い"),
    ("E4", "外向性", "活動性", "テンポよく忙しく動き回り、エネルギーを使う度合い"),
    ("E5", "外向性", "刺激追求", "スリルや非日常・新しい刺激を求める度合い"),
    ("E6", "外向性", "明朗性", "ポジティブで明るく楽しむ気持ちを表に出す度合い"),
    ("O1", "開放性", "想像力", "空想やアイデア・まだ形のない可能性を広げる度合い"),
    ("O2", "開放性", "芸術的関心", "音楽・絵・表現・美的な世界に関心を寄せる度合い"),
    ("O3", "開放性", "情動の豊かさ", "自分の感情の動きや心の揺れを深く味わう度合い"),
    ("O4", "開放性", "冒険心", "未経験のやり方や新しい変化を試すことを好む度合い"),
    ("O5", "開放性", "知的好奇心", "抽象的な議論や仕組みの探求・学ぶことを楽しむ度合い"),
    ("O6", "開放性", "柔軟性", "固定観念やルールにとらわれず多角的に捉える度合い"),
    ("C1", "誠実性", "自己効力感", "課題を自分でやり遂げられるという手応え・有能感の度合い"),
    ("C2", "誠実性", "秩序・計画性", "段取り・スケジュール・マイルストーンを整えて進める度合い"),
    ("C3", "誠実性", "責任感", "約束や締め切り・役割をきっちり守ろうとする度合い"),
    ("C4", "誠実性", "達成努力", "高い目標や成果に向けて粘り強く取り組む度合い"),
    ("C5", "誠実性", "自己規律", "疲れていてもやるべきことを先送りせずやり切る度合い"),
    ("C6", "誠実性", "慎重性", "決断や行動の前にリスクや手順をよく考えてから動く度合い"),
    ("A1", "協調性", "信頼", "他者の善意や誠実さを前提に信じやすい度合い"),
    ("A2", "協調性", "率直さ", "建前や仮面を使わず本音や事実をストレートに出す度合い"),
    ("A3", "協調性", "利他・思いやり", "相手の気持ちを汲み取り、寄り添って助けようとする度合い"),
    ("A4", "協調性", "協調・調和", "角が立たないよう空気を読み、対立を避けて合わせる度合い"),
    ("A5", "協調性", "謙虚さ", "自分を誇示せず控えめに振る舞う度合い"),
    ("A6", "協調性", "共感性", "他者の悩みや感情に心を寄せて一緒に感じる度合い"),
    ("N1", "神経症傾向", "不安", "先のことや失敗への心配・落ち着かなさを抱えやすい度合い"),
    ("N2", "神経症傾向", "怒り・苛立ち", "思い通りにいかないときにイライラや不満を感じやすい度合い"),
    ("N3", "神経症傾向", "落ち込み", "失敗や疲労を引きずり、気力が下がりやすい度合い"),
    ("N4", "神経症傾向", "自意識・気遣い疲れ", "人目や評価を気にして神経をすり減らしやすい度合い"),
    ("N5", "神経症傾向", "衝動性", "その場の気分や衝動に任せて行動・後回しにしやすい度合い"),
    ("N6", "神経症傾向", "ストレス脆弱性", "プレッシャーや疲労が重なったときに負荷を受けやすい度合い"),
]


def build_facet_questions():
    q = {}
    for code, domain, name, desc in FACETS:
        q[f"facet_{code.lower()}"] = {
            "type": "score",
            "instructions": f"ビッグファイブ【{domain}】のファセット「{name}」（{desc}）を評価してください。根拠が回答にない場合は必ず中庸にしてください。",
            "criteria": [
                f"非常に低い：{name}の傾向が明らかに逆（低い）である根拠が回答にある。",
                f"やや低い：{name}が控えめ・低いことがうかがえる。",
                "中庸・判定材料なし：回答に明確な根拠がない、または中程度。",
                f"やや高い：{name}が高いことがうかがえる。",
                f"非常に高い：{name}が極めて強い根拠が回答にある。",
            ],
        }
    return q


def call_facets(api_key, qa_list):
    payload = {
        "model": MODEL,
        "input": format_qa_history(qa_list),
        "questions": build_facet_questions(),
    }
    req = urllib.request.Request(
        DECISION_ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": api_key},
        method="POST",
    )
    t0 = time.time()
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return time.time() - t0, data


def main():
    api_key = load_api_key()
    cases = [c for c in get_cases() if c[0].startswith(("Case1", "Case4", "Case8:"))]
    for name, qa in cases:
        print("=" * 60)
        print(f"▶ {name}")
        sec, res = call_facets(api_key, qa)
        usage = res.get("usage", {})
        ans = res.get("answers", {})
        print(f"⏱ {sec*1000:.0f} ms | in_tokens={usage.get('total_input_tokens')}")
        highs, lows, mids = [], [], []
        for code, domain, fname, _ in FACETS:
            sc = ans[f"facet_{code.lower()}"]["score"]
            pct = round((sc / 4.0) * 100)
            label = f"{code}:{fname}({pct})"
            if sc >= 2.7:
                highs.append(label)
            elif sc <= 1.3:
                lows.append(label)
            else:
                mids.append(label)
        print(f"  ▲ 高め ({len(highs)}): {', '.join(highs) if highs else 'なし'}")
        print(f"  ▼ 低め ({len(lows)}): {', '.join(lows) if lows else 'なし'}")
        print(f"  ・ 中庸/不明 ({len(mids)}): {', '.join(mids[:6])}...")


if __name__ == "__main__":
    main()
