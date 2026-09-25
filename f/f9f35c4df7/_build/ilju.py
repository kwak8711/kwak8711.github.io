#!/usr/bin/env python3
"""오늘(또는 지정일)의 일진과, 계수(癸水) 일간 기준 십성을 계산한다.

    python3 ilju.py            # 서울 기준 오늘
    python3 ilju.py 2026-09-25

기준점: 2000-01-01 = 무오일(戊午). 60갑자는 60일 주기이므로 이 한 점에서
모든 날짜를 역산할 수 있다. 2026-09-25 = 임인일로 만세력과 대조 검증했다.
"""
import sys, json
from datetime import date, datetime, timedelta, timezone

STEMS = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계']
BRANCHES = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해']
STEM_HAN = dict(zip(STEMS, '甲乙丙丁戊己庚辛壬癸'))
BRANCH_HAN = dict(zip(BRANCHES, '子丑寅卯辰巳午未申酉戌亥'))

# 천간의 오행
STEM_EL = {'갑': 'wood', '을': 'wood', '병': 'fire', '정': 'fire', '무': 'earth',
           '기': 'earth', '경': 'metal', '신': 'metal', '임': 'water', '계': 'water'}
# 지지의 오행
BRANCH_EL = {'자': 'water', '축': 'earth', '인': 'wood', '묘': 'wood', '진': 'earth',
             '사': 'fire', '오': 'fire', '미': 'earth', '신': 'metal', '유': 'metal',
             '술': 'earth', '해': 'water'}

# 일간 계수(癸) 기준 십성. 지지는 지장간의 정기(본기)로 판정한다.
STEM_GOD = {'갑': '상관', '을': '식신', '병': '정재', '정': '편재', '무': '정관',
            '기': '편관', '경': '정인', '신': '편인', '임': '겁재', '계': '비견'}
BRANCH_GOD = {'자': '비견', '축': '편관', '인': '상관', '묘': '식신', '진': '정관',
              '사': '정재', '오': '편재', '미': '편관', '신': '정인', '유': '편인',
              '술': '정관', '해': '겁재'}

EL_KO = {'wood': '나무', 'fire': '불', 'earth': '흙', 'metal': '쇠', 'water': '물'}
DOW = ['월', '화', '수', '목', '금', '토', '일']

ANCHOR = date(2000, 1, 1)
ANCHOR_STEM, ANCHOR_BRANCH = 4, 6          # 무(戊), 오(午)


def pillar(d: date):
    diff = d.toordinal() - ANCHOR.toordinal()
    return STEMS[(ANCHOR_STEM + diff) % 10], BRANCHES[(ANCHOR_BRANCH + diff) % 12]


if __name__ == '__main__':
    if len(sys.argv) > 1:
        d = datetime.strptime(sys.argv[1], '%Y-%m-%d').date()
    else:
        d = datetime.now(timezone(timedelta(hours=9))).date()   # 서울 기준

    s, b = pillar(d)
    print(json.dumps({
        'date': d.isoformat(),
        'dateKo': f'{d.year}년 {d.month}월 {d.day}일 {DOW[d.weekday()]}요일',
        'ilju': {
            'ko': s + b,
            'han': STEM_HAN[s] + BRANCH_HAN[b],
            'stem':   {'han': STEM_HAN[s], 'el': STEM_EL[s],
                       'name': EL_KO[STEM_EL[s]] + '의 기운', 'sipseong': STEM_GOD[s]},
            'branch': {'han': BRANCH_HAN[b], 'el': BRANCH_EL[b],
                       'name': EL_KO[BRANCH_EL[b]] + '의 기운', 'sipseong': BRANCH_GOD[b]},
        },
    }, ensure_ascii=False, indent=2))
