#!/usr/bin/env python3
"""Generates every localized page (ko/en/zh/ja) plus sitemap.xml.

The HTML files are build output — edit this file and re-run it, not the pages.
Game logic and styles live in the shared <slug>.js / <slug>.css and are untouched.

    python3 build-pages.py
"""
from string import Template

BASE = 'https://kimdoogi.github.io/ranking-game/'
LANGS = ['ko', 'en', 'zh', 'ja']
HTML_LANG = {'ko': 'ko', 'en': 'en', 'zh': 'zh-Hans', 'ja': 'ja'}
OG_LOCALE = {'ko': 'ko_KR', 'en': 'en_US', 'zh': 'zh_CN', 'ja': 'ja_JP'}
SCHEMA_LANG = {'ko': 'ko-KR', 'en': 'en', 'zh': 'zh-Hans', 'ja': 'ja'}
GAMES = ['monster-chase', 'obstacle-run', 'push-royale']
EMOJI = {'': '🎮', 'monster-chase': '👾', 'obstacle-run': '🏁', 'push-royale': '🏆'}


def page_file(slug, lang):
    stem = slug or 'index'
    return f'{stem}.html' if lang == 'ko' else f'{stem}-{lang}.html'


def page_url(slug, lang):
    return BASE if (slug == '' and lang == 'ko') else BASE + page_file(slug, lang)


def hreflang_block(slug, indent=''):
    rows = [f'{indent}<link rel="alternate" hreflang="{lg}" href="{page_url(slug, lg)}" />' for lg in LANGS]
    rows.append(f'{indent}<link rel="alternate" hreflang="x-default" href="{page_url(slug, "ko")}" />')
    return '\n'.join(rows)


def alt_locales(lang, indent=''):
    return '\n'.join(f'{indent}<meta property="og:locale:alternate" content="{OG_LOCALE[lg]}" />'
                     for lg in LANGS if lg != lang)


GA_ID = 'G-TNX16BV3PS'
GA_TAG = """<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=%s"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', '%s');
</script>""" % (GA_ID, GA_ID)


def ga_tag(indent=''):
    return '\n'.join(indent + ln if ln else ln for ln in GA_TAG.split('\n'))

# ---------------------------------------------------------------- shared copy
SITE_NAME = {
    'ko': '미니게임 아케이드',
    'en': 'Minigame Arcade',
    'zh': '小游戏街机厅',
    'ja': 'ミニゲームアーケード',
}

# Roster UI is identical across the three games.
ROSTER = {
    'ko': dict(home='게임 목록', homeAria='게임 목록으로 돌아가기', mute='소리 끄기',
               addLabel='참가자 추가', addHint='<b>이름 * 4</b> 처럼 입력하고 추가하기 · 중복 OK',
               placeholder='예: 김두기 * 4', addBtn='추가하기', unit='명',
               clear='전체 지우기', start='▶ 시작!', again='🔄 다시하기'),
    'en': dict(home='Game list', homeAria='Back to the game list', mute='Mute',
               addLabel='Add players', addHint='type <b>name * 4</b> and hit Add · duplicates OK',
               placeholder='e.g. Alex * 4', addBtn='Add', unit=' players',
               clear='Clear all', start='▶ Start!', again='🔄 Play again'),
    'zh': dict(home='游戏列表', homeAria='返回游戏列表', mute='静音',
               addLabel='添加参与者', addHint='按 <b>名字 * 4</b> 输入后点添加 · 可重复',
               placeholder='例：小明 * 4', addBtn='添加', unit=' 人',
               clear='全部清空', start='▶ 开始！', again='🔄 再来一局'),
    'ja': dict(home='ゲーム一覧', homeAria='ゲーム一覧に戻る', mute='ミュート',
               addLabel='参加者を追加', addHint='<b>名前 * 4</b> の形で入力して追加 · 重複OK',
               placeholder='例：たろう * 4', addBtn='追加', unit='人',
               clear='すべて消す', start='▶ スタート！', again='🔄 もう一回'),
}

# ------------------------------------------------------------------ page meta
META = {
    '': {
        'ko': dict(
            title='미니게임 아케이드 🎮 | 브라우저 무료 미니게임 3종',
            desc='브라우저에서 바로 즐기는 무료 미니게임 아케이드. 먹보 괴물 대탈주, 장애물 대탈주 300, 밀어내기 배틀 로얄 등 미니게임 3종을 설치 없이 플레이하세요.',
            keywords='미니게임, 무료게임, 브라우저게임, HTML5 게임, 캐주얼 게임, 온라인 게임, 웹게임, 랜덤 뽑기, 사다리게임, 룰렛',
            ogTitle='미니게임 아케이드 🎮',
            ogDesc='브라우저에서 바로 즐기는 무료 미니게임 3종. 설치 없이 지금 플레이!',
            schemaDesc='브라우저에서 바로 즐기는 무료 미니게임 아케이드.',
            h1='미니게임 아케이드 🎮', sub='플레이할 게임을 골라보세요'),
        'en': dict(
            title='Minigame Arcade 🎮 | 3 Free Browser Minigames',
            desc='A free browser minigame arcade. Monster Munch Escape, Obstacle Run 300 and Push Royale — three minigames that run instantly, no install.',
            keywords='minigame, free game, browser game, HTML5 game, casual game, online game, web game, random name picker, ladder game, roulette',
            ogTitle='Minigame Arcade 🎮',
            ogDesc='Three free minigames that run right in your browser. No install, just play!',
            schemaDesc='A free browser minigame arcade that runs without any install.',
            h1='Minigame Arcade 🎮', sub='Pick a game to play'),
        'zh': dict(
            title='小游戏街机厅 🎮 | 3 款免费网页小游戏',
            desc='浏览器里直接玩的免费小游戏合集。大胃怪物大逃亡、障碍赛跑 300、推挤大逃杀，三款小游戏免安装即玩。',
            keywords='小游戏, 免费游戏, 网页游戏, HTML5 游戏, 休闲游戏, 在线游戏, 随机点名, 阶梯抽签, 轮盘',
            ogTitle='小游戏街机厅 🎮',
            ogDesc='浏览器里直接玩的三款免费小游戏。免安装，马上开玩！',
            schemaDesc='浏览器里直接玩的免费小游戏合集，免安装。',
            h1='小游戏街机厅 🎮', sub='选一款游戏开始玩'),
        'ja': dict(
            title='ミニゲームアーケード 🎮 | 無料ブラウザミニゲーム3本',
            desc='ブラウザですぐ遊べる無料ミニゲーム集。大食いモンスターから大脱走、障害物レース300、プッシュバトルロイヤルの3本をインストール不要でプレイ。',
            keywords='ミニゲーム, 無料ゲーム, ブラウザゲーム, HTML5ゲーム, カジュアルゲーム, オンラインゲーム, 名前 抽選, あみだくじ, ルーレット',
            ogTitle='ミニゲームアーケード 🎮',
            ogDesc='ブラウザですぐ遊べる無料ミニゲーム3本。インストール不要、今すぐプレイ！',
            schemaDesc='ブラウザですぐ遊べる無料ミニゲーム集。インストール不要。',
            h1='ミニゲームアーケード 🎮', sub='遊ぶゲームを選んでください'),
    },
    'monster-chase': {
        'ko': dict(
            name='먹보 괴물 대탈주',
            title='먹보 괴물 대탈주 👾 이름 넣고 돌리는 랜덤 생존 뽑기 | 무료 브라우저 미니게임',
            desc='이름을 넣으면 괴물에게 먹히지 않고 끝까지 살아남는 사람이 정해지는 랜덤 생존 미니게임. 벌칙·순서 정할 때 사다리게임이나 룰렛 대신 쓰세요. 설치 없이 무료 플레이.',
            keywords='먹보 괴물 대탈주, 랜덤 뽑기, 이름 뽑기, 사다리게임, 룰렛, 벌칙 정하기, 미니게임, 무료게임, 브라우저게임, 러너게임, 캐주얼 게임',
            ogTitle='먹보 괴물 대탈주 👾',
            ogDesc='괴물을 피해 끝까지 살아남기! 지금 바로 무료로 플레이.',
            schemaAlt='랜덤 생존 뽑기 미니게임',
            schemaDesc='이름을 넣고 돌리면 마지막 생존자가 정해지는 캐주얼 러너 게임.',
            schemaKeywords='랜덤 뽑기, 이름 뽑기, 사다리게임, 룰렛, 벌칙 정하기',
            titleHtml='먹보 괴물<br>대탈주',
            subtitle='먹히지 마라! 마지막 생존자가 우승 🏆',
            tagline='사다리게임·룰렛 대신 쓰는 이름 뽑기 — 벌칙·순서 정하기',
            hud='🏃 남은 인원', boom='🍔 야식 투척 ×3',
            snackHelp='경기 중 버튼이나 스페이스 키를 누르면 괴물에게 야식을 던집니다. 한 경기에서 3번 사용할 수 있습니다.'),
        'en': dict(
            name='Monster Munch Escape',
            title='Monster Munch Escape 👾 Random Survivor Picker — Ladder Game & Roulette Alternative | Free Browser Game',
            desc='Drop in names and the last one the monster fails to eat wins. A random picker to use instead of a ladder game or roulette wheel — decide penalties and turn order. Free, no install.',
            keywords='monster munch escape, random name picker, wheel of names, ladder game, roulette, decision maker, minigame, free game, browser game, runner game, casual game',
            ogTitle='Monster Munch Escape 👾',
            ogDesc='Outrun the monster and survive to the end! Play free right now.',
            schemaAlt='Random survivor picker minigame',
            schemaDesc='A casual runner where you drop in names and the last survivor wins.',
            schemaKeywords='random name picker, wheel of names, ladder game, roulette, decision maker',
            titleHtml='Monster Munch<br>Escape',
            subtitle="Don't get eaten! The last survivor wins 🏆",
            tagline='A random name picker instead of a ladder game or roulette wheel — penalties and turn order',
            hud='🏃 Left', boom='🍔 Throw snack ×3',
            snackHelp='During a match, press the button or the space key to throw a snack at the monster. Three uses per match.'),
        'zh': dict(
            name='大胃怪物大逃亡',
            title='大胃怪物大逃亡 👾 随机生存点名 — 替代阶梯抽签和轮盘 | 免费网页小游戏',
            desc='输入名字，没被怪物吃掉、活到最后的人获胜的随机小游戏。可以代替阶梯抽签或幸运轮盘来定惩罚、定顺序。免安装，免费玩。',
            keywords='大胃怪物大逃亡, 随机点名, 抽签工具, 阶梯抽签, 轮盘, 惩罚决定, 小游戏, 免费游戏, 网页游戏, 跑酷游戏, 休闲游戏',
            ogTitle='大胃怪物大逃亡 👾',
            ogDesc='躲开怪物活到最后！马上免费开玩。',
            schemaAlt='随机生存点名小游戏',
            schemaDesc='输入名字，活到最后的人获胜的休闲跑酷小游戏。',
            schemaKeywords='随机点名, 抽签工具, 阶梯抽签, 轮盘, 惩罚决定',
            titleHtml='大胃怪物<br>大逃亡',
            subtitle='别被吃掉！最后的幸存者获胜 🏆',
            tagline='代替阶梯抽签和轮盘的随机点名工具 — 定惩罚、定顺序',
            hud='🏃 剩余', boom='🍔 投喂夜宵 ×3',
            snackHelp='比赛中点击按钮或按空格键，就会向怪物投喂夜宵。每局可以使用 3 次。'),
        'ja': dict(
            name='大食いモンスターから大脱走',
            title='大食いモンスターから大脱走 👾 名前を入れて回すランダム抽選 — あみだくじ・ルーレット代わり | 無料ブラウザゲーム',
            desc='名前を入れると、モンスターに食べられず最後まで生き残った人が決まるランダム抽選ミニゲーム。罰ゲームや順番決めに、あみだくじやルーレットの代わりにどうぞ。インストール不要、無料。',
            keywords='大食いモンスターから大脱走, 名前 抽選, ランダム 抽選, あみだくじ, ルーレット, 罰ゲーム 決め, ミニゲーム, 無料ゲーム, ブラウザゲーム, ランゲーム, カジュアルゲーム',
            ogTitle='大食いモンスターから大脱走 👾',
            ogDesc='モンスターから逃げ切って生き残れ！今すぐ無料でプレイ。',
            schemaAlt='ランダム生き残り抽選ミニゲーム',
            schemaDesc='名前を入れて回すと最後の生存者が決まるカジュアルランゲーム。',
            schemaKeywords='名前 抽選, ランダム 抽選, あみだくじ, ルーレット, 罰ゲーム 決め',
            titleHtml='大食いモンスター<br>から大脱走',
            subtitle='食べられるな！最後の生存者が優勝 🏆',
            tagline='あみだくじ・ルーレット代わりの名前抽選 — 罰ゲームや順番決めに',
            hud='🏃 残り', boom='🍔 夜食投げ ×3',
            snackHelp='試合中にボタンかスペースキーを押すと、モンスターに夜食を投げます。1試合で3回まで使えます。'),
    },
    'obstacle-run': {
        'ko': dict(
            name='장애물 대탈주 300',
            title='장애물 대탈주 300 🏁 최대 300명 이름 레이스 뽑기 | 무료 브라우저 미니게임',
            desc='이름을 최대 300개까지 넣고 달려서 순위를 정하는 레이스 미니게임. 사다리게임·룰렛 대신 순서, 벌칙, 팀 나누기에 쓰세요. 설치 없이 무료 플레이.',
            keywords='장애물 대탈주 300, 랜덤 뽑기, 이름 뽑기, 순위 정하기, 사다리게임, 룰렛, 미니게임, 무료게임, 브라우저게임, 러닝게임, 캐주얼 게임',
            ogTitle='장애물 대탈주 300 🏁',
            ogDesc='장애물을 넘어 300m 완주에 도전! 지금 바로 무료로 플레이.',
            schemaAlt='이름 레이스 순위 뽑기',
            schemaDesc='최대 300명의 이름을 넣고 장애물을 넘어 순위를 가리는 러닝 게임.',
            schemaKeywords='랜덤 뽑기, 이름 뽑기, 순위 정하기, 사다리게임, 룰렛',
            titleHtml='장애물<br>대탈주',
            subtitle='해머, 크러셔, 진흙탕을 뚫고 결승선까지! 최대 300명 🏁',
            tagline='사다리게임·룰렛 대신 쓰는 순위 뽑기 — 순서·벌칙·팀 나누기',
            hud='🏁 완주', boom='🍌 바나나 비 ×3', ff='⏩ ×3 빨리감기',
            addHint='<b>이름 * 4</b> 처럼 입력하고 추가하기 · 최대 300명',
            presets=['봇 +12', '봇 +50', '봇 +100', '봇 +300'], start='▶ 출발!'),
        'en': dict(
            name='Obstacle Run 300',
            title='Obstacle Run 300 🏁 Race Up to 300 Names for a Ranking | Free Browser Game',
            desc='Drop in up to 300 names and race them for a full ranking. Use it instead of a ladder game or roulette wheel to set turn order, penalties or teams. Free, no install.',
            keywords='obstacle run 300, random name picker, ranking generator, ladder game, roulette, wheel of names, minigame, free game, browser game, running game, casual game',
            ogTitle='Obstacle Run 300 🏁',
            ogDesc='Hammers, crushers, mud — sprint 300m to the finish line! Play free.',
            schemaAlt='Name race ranking generator',
            schemaDesc='A running game that races up to 300 names past obstacles for a full ranking.',
            schemaKeywords='random name picker, ranking generator, ladder game, roulette, wheel of names',
            titleHtml='Obstacle<br>Run',
            subtitle='Hammers, crushers, mud — sprint to the tape! Up to 300 runners 🏁',
            tagline='A ranking picker instead of a ladder game or roulette wheel — turn order, penalties, teams',
            hud='🏁 Finished', boom='🍌 Banana rain ×3', ff='⏩ ×3 fast-forward',
            addHint='type <b>name * 4</b> and hit Add · up to 300 runners',
            presets=['Bots +12', 'Bots +50', 'Bots +100', 'Bots +300'], start='▶ Go!'),
        'zh': dict(
            name='障碍赛跑 300',
            title='障碍赛跑 300 🏁 最多 300 个名字排名抽签 | 免费网页小游戏',
            desc='最多输入 300 个名字，一起跑过障碍决出排名的赛跑小游戏。可以代替阶梯抽签或轮盘来定顺序、定惩罚、分组。免安装，免费玩。',
            keywords='障碍赛跑 300, 随机点名, 排名生成, 阶梯抽签, 轮盘, 抽签工具, 小游戏, 免费游戏, 网页游戏, 跑步游戏, 休闲游戏',
            ogTitle='障碍赛跑 300 🏁',
            ogDesc='穿过铁锤、粉碎机和泥潭，冲过 300 米终点线！免费开玩。',
            schemaAlt='名字赛跑排名工具',
            schemaDesc='最多 300 个名字越过障碍决出完整排名的跑步小游戏。',
            schemaKeywords='随机点名, 排名生成, 阶梯抽签, 轮盘, 抽签工具',
            titleHtml='障碍<br>赛跑',
            subtitle='穿过铁锤、粉碎机和泥潭冲向终点！最多 300 人 🏁',
            tagline='代替阶梯抽签和轮盘的排名工具 — 定顺序、定惩罚、分组',
            hud='🏁 完赛', boom='🍌 香蕉雨 ×3', ff='⏩ ×3 快进',
            addHint='按 <b>名字 * 4</b> 输入后点添加 · 最多 300 人',
            presets=['机器人 +12', '机器人 +50', '机器人 +100', '机器人 +300'], start='▶ 出发！'),
        'ja': dict(
            name='障害物レース300',
            title='障害物レース300 🏁 最大300人の名前で順位抽選 | 無料ブラウザゲーム',
            desc='名前を最大300件入れて走らせ、順位を決めるレースミニゲーム。あみだくじやルーレットの代わりに、順番決め・罰ゲーム・チーム分けにどうぞ。インストール不要、無料。',
            keywords='障害物レース300, 名前 抽選, 順位 決め, あみだくじ, ルーレット, ランダム 抽選, ミニゲーム, 無料ゲーム, ブラウザゲーム, レースゲーム, カジュアルゲーム',
            ogTitle='障害物レース300 🏁',
            ogDesc='ハンマーもクラッシャーも泥沼も越えて300m完走に挑戦！今すぐ無料でプレイ。',
            schemaAlt='名前レース順位抽選',
            schemaDesc='最大300人の名前が障害物を越えて順位を競うレースゲーム。',
            schemaKeywords='名前 抽選, 順位 決め, あみだくじ, ルーレット, ランダム 抽選',
            titleHtml='障害物<br>レース',
            subtitle='ハンマー、クラッシャー、泥沼を越えてゴールへ！最大300人 🏁',
            tagline='あみだくじ・ルーレット代わりの順位抽選 — 順番決め・罰ゲーム・チーム分け',
            hud='🏁 完走', boom='🍌 バナナの雨 ×3', ff='⏩ ×3 早送り',
            addHint='<b>名前 * 4</b> の形で入力して追加 · 最大300人',
            presets=['ボット +12', 'ボット +50', 'ボット +100', 'ボット +300'], start='▶ スタート！'),
    },
    'push-royale': {
        'ko': dict(
            name='밀어내기 배틀 로얄',
            title='밀어내기 배틀 로얄 🏆 사다리게임·룰렛 대신 이름 뽑기 | 무료 브라우저 미니게임',
            desc='이름을 넣고 돌리면 우승자와 꼴찌가 정해지는 랜덤 뽑기 미니게임. 사다리게임·룰렛 대신 벌칙, 순서, 내기 정할 때 쓰세요. 설치 없이 브라우저에서 무료 플레이.',
            keywords='사다리게임, 룰렛, 랜덤 뽑기, 이름 뽑기, 제비뽑기, 벌칙 정하기, 순서 정하기, 밀어내기 배틀 로얄, 미니게임, 무료게임, 브라우저게임, 배틀로얄, 캐주얼 게임',
            ogTitle='밀어내기 배틀 로얄 🏆 사다리게임·룰렛 대신 이름 뽑기',
            ogDesc='이름 넣고 돌리면 우승자와 꼴찌가 나온다! 벌칙·순서·내기 정할 때 무료로 바로 플레이.',
            schemaAlt='사다리게임·룰렛 대신 쓰는 이름 뽑기',
            schemaDesc='이름을 넣고 돌리면 우승자와 꼴찌가 정해지는 랜덤 뽑기 미니게임. 사다리게임이나 룰렛 대신 벌칙·순서·내기를 정할 때 사용합니다.',
            schemaKeywords='사다리게임, 룰렛, 랜덤 뽑기, 이름 뽑기, 제비뽑기, 벌칙 정하기, 순서 정하기',
            titleHtml='밀어내기<br>배틀 로얄',
            subtitle='야구방망이로 다 날려버려라! 마지막 1명이 우승 🏆',
            tagline='사다리게임·룰렛 대신 쓰는 이름 뽑기 — 벌칙·순서·내기 정하기',
            hud='🎯 남은 인원', shake='💥 흔들기!', share='📸 결과 카드 공유'),
        'en': dict(
            name='Push Royale',
            title='Push Royale 🏆 Random Name Picker — Ladder Game & Roulette Alternative | Free Browser Game',
            desc='Drop in names and one winner is left standing. A random name picker you can use instead of a ladder game or a roulette wheel — pick who pays, who goes first, who takes the penalty. Free, no install.',
            keywords='ladder game, roulette, wheel of names, random name picker, spin the wheel, name draw, decision maker, push royale, battle royale, minigame, free game, browser game, casual game',
            ogTitle='Push Royale 🏆 Random Name Picker',
            ogDesc='Drop in names, swing the bat, last one standing wins. Use it instead of a ladder game or roulette wheel. Free to play.',
            schemaAlt='Random name picker — ladder game and roulette alternative',
            schemaDesc='Drop in names and one winner is left standing. A random name picker to use instead of a ladder game or roulette wheel — decide who pays, who goes first, who takes the penalty.',
            schemaKeywords='ladder game, roulette, wheel of names, random name picker, spin the wheel, decision maker',
            titleHtml='Push<br>Royale',
            subtitle='Swing the bat, knock everyone off, last one standing wins 🏆',
            tagline='A random name picker instead of a ladder game or roulette wheel — penalties, turn order, who pays',
            hud='🎯 Left', shake='💥 Shake!', share='📸 Share result card'),
        'zh': dict(
            name='推挤大逃杀',
            title='推挤大逃杀 🏆 随机点名抽签 — 替代阶梯抽签和轮盘 | 免费网页小游戏',
            desc='输入名字，一棒挥出去，最后站着的人获胜。可以拿来代替阶梯抽签或幸运轮盘：决定谁买单、谁先来、谁接受惩罚。免安装，浏览器里免费玩。',
            keywords='阶梯抽签, 轮盘, 幸运轮盘, 随机点名, 抽签工具, 转盘抽奖, 随机选人, 推挤大逃杀, 大逃杀, 小游戏, 免费游戏, 网页游戏, 休闲游戏',
            ogTitle='推挤大逃杀 🏆 随机点名抽签',
            ogDesc='输入名字，一棒挥出去，最后站着的人获胜！代替阶梯抽签和轮盘，免费即玩。',
            schemaAlt='随机点名抽签 — 阶梯抽签和轮盘的替代工具',
            schemaDesc='输入名字，最后站着的人获胜的随机抽签小游戏。可以代替阶梯抽签或幸运轮盘，决定谁买单、谁先来、谁接受惩罚。',
            schemaKeywords='阶梯抽签, 轮盘, 幸运轮盘, 随机点名, 抽签工具, 转盘抽奖, 随机选人',
            titleHtml='推挤<br>大逃杀',
            subtitle='挥棒把对手全部打飞，最后一人获胜 🏆',
            tagline='代替阶梯抽签和轮盘的随机点名工具 — 定惩罚、定顺序、定谁买单',
            hud='🎯 剩余', shake='💥 摇一摇！', share='📸 分享结果卡'),
        'ja': dict(
            name='プッシュバトルロイヤル',
            title='プッシュバトルロイヤル 🏆 あみだくじ・ルーレット代わりの名前抽選 | 無料ブラウザゲーム',
            desc='名前を入れて回すと、優勝者とビリが決まるランダム抽選ミニゲーム。あみだくじやルーレットの代わりに、罰ゲーム・順番・おごりを決めるのに使えます。インストール不要、ブラウザで無料プレイ。',
            keywords='あみだくじ, ルーレット, 名前 抽選, ランダム 抽選, くじ引き, 罰ゲーム 決め, 順番 決め, プッシュバトルロイヤル, バトルロイヤル, ミニゲーム, 無料ゲーム, ブラウザゲーム, カジュアルゲーム',
            ogTitle='プッシュバトルロイヤル 🏆 名前抽選',
            ogDesc='名前を入れてバットで吹き飛ばせ！最後の1人が優勝。あみだくじ・ルーレット代わりに無料でプレイ。',
            schemaAlt='あみだくじ・ルーレット代わりの名前抽選',
            schemaDesc='名前を入れて回すと優勝者とビリが決まるランダム抽選ミニゲーム。あみだくじやルーレットの代わりに罰ゲーム・順番・おごりを決めるのに使います。',
            schemaKeywords='あみだくじ, ルーレット, 名前 抽選, ランダム 抽選, くじ引き, 罰ゲーム 決め, 順番 決め',
            titleHtml='プッシュ<br>バトルロイヤル',
            subtitle='バットで全員吹き飛ばせ！最後の1人が優勝 🏆',
            tagline='あみだくじ・ルーレット代わりの名前抽選 — 罰ゲーム・順番・おごり決め',
            hud='🎯 残り', shake='💥 シェイク！', share='📸 結果カードを共有'),
    },
}

CARDS = {
    'ko': ['괴물을 피해 끝까지 살아남기', '장애물을 넘어 300m 완주하기', '야구방망이로 날려버리고 최후의 1인이 되기'],
    'en': ['Outrun the monster and survive', 'Clear the obstacles, finish the 300m',
           'Swing the bat, be the last one standing'],
    'zh': ['躲开怪物活到最后', '越过障碍完成 300 米', '挥棒打飞对手，成为最后一人'],
    'ja': ['モンスターから逃げ切って生き残る', '障害物を越えて300m完走', 'バットで吹き飛ばして最後の1人に'],
}

# --------------------------------------------------------------- T dictionaries
T_PUSH = {
    'ko': """  gameName: '밀어내기 배틀 로얄',
  mute: '소리 끄기',
  unmute: '소리 켜기',
  clang: '깡!',
  homer: '홈런!',
  out: 'OUT!',
  doubleOut: '더블 아웃!!',
  monsterOut: '몬스터 아웃!!!',
  suddenDeath: '⚡ 서든데스!',
  finalRound: '결승!',
  save: '세이브!',
  special: '필살기!',
  cardTitle: '🏆 밀어내기 배틀 로얄',
  cardPlayers: n => `${n}명 참가`,
  cardLast: '💀 꼴 찌',
  cardCta: '설치 없이 바로 플레이 ▶',
  shareCaption: (win, loser) => `👑 우승 ${win}` + (loser ? ` · 💀 꼴찌 ${loser}` : ''),
  cardBuilding: '결과 카드를 만드는 중이에요…',
  cardFailed: '결과 카드를 만들지 못했어요 😢',
  cardCopied: '결과 카드를 복사했어요! 채팅방에 붙여넣기 하세요 📋',
  cardSaved: '결과 카드를 저장했어요 💾',
  shareFailed: '공유에 실패했어요 😢',
  rosterEmpty: '아직 참가자가 없어요',
  hintEmpty: '이름을 입력하고 추가하기를 누르세요',
  hintReady: n => `${n}명 참가 — 시작할 수 있어요!`,
  hintNeedMore: n => `${n}명 이상부터 시작할 수 있어요`,
  numName: n => n + '번'""",
    'en': """  gameName: 'Push Royale',
  mute: 'Mute',
  unmute: 'Unmute',
  clang: 'CLANG!',
  homer: 'HOMER!',
  out: 'OUT!',
  doubleOut: 'DOUBLE OUT!!',
  monsterOut: 'MONSTER OUT!!!',
  suddenDeath: '⚡ SUDDEN DEATH!',
  finalRound: 'FINAL!',
  save: 'SAVE!',
  special: 'SPECIAL!',
  cardTitle: '🏆 Push Royale',
  cardPlayers: n => `${n} players`,
  cardLast: '💀 LAST',
  cardCta: 'Play now, no install ▶',
  shareCaption: (win, loser) => `👑 Winner ${win}` + (loser ? ` · 💀 Last ${loser}` : ''),
  cardBuilding: 'Building the result card…',
  cardFailed: "Couldn't build the result card 😢",
  cardCopied: 'Result card copied! Paste it in your chat 📋',
  cardSaved: 'Result card saved 💾',
  shareFailed: 'Sharing failed 😢',
  rosterEmpty: 'No players yet',
  hintEmpty: 'Type a name and hit Add',
  hintReady: n => `${n} players — ready to start!`,
  hintNeedMore: n => `Needs at least ${n} players to start`,
  numName: n => '#' + n""",
    'zh': """  gameName: '推挤大逃杀',
  mute: '静音',
  unmute: '取消静音',
  clang: '铛！',
  homer: '全垒打！',
  out: 'OUT!',
  doubleOut: '双杀！！',
  monsterOut: '三杀！！！',
  suddenDeath: '⚡ 突然死亡！',
  finalRound: '决赛！',
  save: '救回来了！',
  special: '必杀技！',
  cardTitle: '🏆 推挤大逃杀',
  cardPlayers: n => `${n} 人参加`,
  cardLast: '💀 倒数第一',
  cardCta: '免安装，马上开玩 ▶',
  shareCaption: (win, loser) => `👑 冠军 ${win}` + (loser ? ` · 💀 垫底 ${loser}` : ''),
  cardBuilding: '正在生成结果卡…',
  cardFailed: '结果卡生成失败 😢',
  cardCopied: '结果卡已复制！粘贴到聊天里吧 📋',
  cardSaved: '结果卡已保存 💾',
  shareFailed: '分享失败 😢',
  rosterEmpty: '还没有参与者',
  hintEmpty: '输入名字后点添加',
  hintReady: n => `${n} 人参加 — 可以开始了！`,
  hintNeedMore: n => `至少要 ${n} 人才能开始`,
  numName: n => n + ' 号'""",
    'ja': """  gameName: 'プッシュバトルロイヤル',
  mute: 'ミュート',
  unmute: 'ミュート解除',
  clang: 'カキーン！',
  homer: 'ホームラン！',
  out: 'OUT!',
  doubleOut: 'ダブルアウト！！',
  monsterOut: 'モンスターアウト！！！',
  suddenDeath: '⚡ サドンデス！',
  finalRound: '決勝！',
  save: 'セーフ！',
  special: '必殺技！',
  cardTitle: '🏆 プッシュバトルロイヤル',
  cardPlayers: n => `${n}人参加`,
  cardLast: '💀 ビリ',
  cardCta: 'インストール不要ですぐプレイ ▶',
  shareCaption: (win, loser) => `👑 優勝 ${win}` + (loser ? ` · 💀 ビリ ${loser}` : ''),
  cardBuilding: '結果カードを作成中…',
  cardFailed: '結果カードを作成できませんでした 😢',
  cardCopied: '結果カードをコピーしました！チャットに貼り付けてください 📋',
  cardSaved: '結果カードを保存しました 💾',
  shareFailed: '共有に失敗しました 😢',
  rosterEmpty: 'まだ参加者がいません',
  hintEmpty: '名前を入力して追加を押してください',
  hintReady: n => `${n}人参加 — スタートできます！`,
  hintNeedMore: n => `${n}人以上からスタートできます`,
  numName: n => n + '番'""",
}

T_MONSTER = {
    'ko': """  mute: '소리 끄기',
  unmute: '소리 켜기',
  snack1: '새벽 2시 햄버거', snack1r: '다이어트는 내일부터!',
  snack2: '민트초코 피자', snack2r: '이 조합... 실화냐?',
  snack3: '불닭 10배', snack3r: '맵다 매워!!!',
  snack4: '전설의 닭다리', snack4r: '뼈까지 냠!',
  snack5: '무지개 도넛', snack5r: '당 충전 완료!',
  snackCombo: n => `🔥 야식 콤보 ×${n}`,
  snackGone: '야식 순삭!',
  nom: '냠!',
  firstNom: '첫 냠!',
  darkNom: '어둠 속의 냠!',
  suddenDeath: '⚡ 서든데스!!',
  pillarFall: '기둥 붕괴!',
  finalTwo: '최후의 2인!',
  deliveryFail: '배달 실패!',
  closeCall: '아슬아슬!',
  survived: '살았다!',
  doubleNom: '더블 냠!!',
  tripleNom: '트리플 냠!!!',
  bonk: '띵~',
  oops: '아이쿠!',
  monsterWoke: '괴물이 깨어났다!',
  throwSnack: n => `🍔 야식 투척 ×${n}`,
  delivering: '배달 중…',
  snackSoldOut: '🍽️ 야식 완판',
  seconds: n => `${n}초`,
  snackCooldown: n => `야식 투척 재사용까지 ${n}초`,
  delivered: '배달!',
  rosterEmpty: '아직 참가자가 없어요',
  hintEmpty: '이름을 입력하고 추가하기를 누르세요',
  hintReady: n => `${n}명 참가 — 시작할 수 있어요!`,
  hintNeedMore: n => `${n}명 이상부터 시작할 수 있어요`,
  numName: n => n + '번'""",
    'en': """  mute: 'Mute',
  unmute: 'Unmute',
  snack1: '2 a.m. burger', snack1r: 'The diet starts tomorrow!',
  snack2: 'Mint choco pizza', snack2r: 'That combo... seriously?',
  snack3: '10x fire noodles', snack3r: 'HOT HOT HOT!!!',
  snack4: 'Legendary drumstick', snack4r: 'Bones and all!',
  snack5: 'Rainbow donut', snack5r: 'Sugar rush complete!',
  snackCombo: n => `🔥 Snack combo ×${n}`,
  snackGone: 'Gone in one bite!',
  nom: 'NOM!',
  firstNom: 'First bite!',
  darkNom: 'A bite in the dark!',
  suddenDeath: '⚡ SUDDEN DEATH!!',
  pillarFall: 'Pillar collapse!',
  finalTwo: 'FINAL TWO!',
  deliveryFail: 'Delivery failed!',
  closeCall: 'Close call!',
  survived: 'Made it!',
  doubleNom: 'DOUBLE NOM!!',
  tripleNom: 'TRIPLE NOM!!!',
  bonk: 'BONK~',
  oops: 'Oops!',
  monsterWoke: 'The monster woke up!',
  throwSnack: n => `🍔 Throw snack ×${n}`,
  delivering: 'Delivering…',
  snackSoldOut: '🍽️ Snacks sold out',
  seconds: n => `${n}s`,
  snackCooldown: n => `${n}s until the next snack throw`,
  delivered: 'Delivered!',
  rosterEmpty: 'No players yet',
  hintEmpty: 'Type a name and hit Add',
  hintReady: n => `${n} players — ready to start!`,
  hintNeedMore: n => `Needs at least ${n} players to start`,
  numName: n => '#' + n""",
    'zh': """  mute: '静音',
  unmute: '取消静音',
  snack1: '凌晨两点的汉堡', snack1r: '减肥明天再说！',
  snack2: '薄荷巧克力披萨', snack2r: '这搭配……认真的？',
  snack3: '十倍辣火鸡面', snack3r: '辣辣辣！！！',
  snack4: '传说中的鸡腿', snack4r: '连骨头都吃掉！',
  snack5: '彩虹甜甜圈', snack5r: '糖分补满！',
  snackCombo: n => `🔥 夜宵连击 ×${n}`,
  snackGone: '夜宵秒光！',
  nom: '啊呜！',
  firstNom: '第一口！',
  darkNom: '黑暗中的一口！',
  suddenDeath: '⚡ 突然死亡！！',
  pillarFall: '柱子塌了！',
  finalTwo: '最后两人！',
  deliveryFail: '投喂失败！',
  closeCall: '好险！',
  survived: '活下来了！',
  doubleNom: '双吃！！',
  tripleNom: '三连吃！！！',
  bonk: '咚～',
  oops: '哎哟！',
  monsterWoke: '怪物醒了！',
  throwSnack: n => `🍔 投喂夜宵 ×${n}`,
  delivering: '配送中…',
  snackSoldOut: '🍽️ 夜宵售罄',
  seconds: n => `${n}秒`,
  snackCooldown: n => `距离下次投喂还有 ${n} 秒`,
  delivered: '送到！',
  rosterEmpty: '还没有参与者',
  hintEmpty: '输入名字后点添加',
  hintReady: n => `${n} 人参加 — 可以开始了！`,
  hintNeedMore: n => `至少要 ${n} 人才能开始`,
  numName: n => n + ' 号'""",
    'ja': """  mute: 'ミュート',
  unmute: 'ミュート解除',
  snack1: '深夜2時のハンバーガー', snack1r: 'ダイエットは明日から！',
  snack2: 'ミントチョコピザ', snack2r: 'この組み合わせ…マジ？',
  snack3: '激辛10倍ラーメン', snack3r: '辛い辛い辛い！！！',
  snack4: '伝説の骨付き肉', snack4r: '骨までパクッ！',
  snack5: 'レインボードーナツ', snack5r: '糖分チャージ完了！',
  snackCombo: n => `🔥 夜食コンボ ×${n}`,
  snackGone: '夜食を一瞬で完食！',
  nom: 'パクッ！',
  firstNom: '最初のひと口！',
  darkNom: '暗闇のひと口！',
  suddenDeath: '⚡ サドンデス！！',
  pillarFall: '柱が崩れた！',
  finalTwo: '最後の2人！',
  deliveryFail: '配達失敗！',
  closeCall: 'あぶない！',
  survived: '助かった！',
  doubleNom: 'ダブルパク！！',
  tripleNom: 'トリプルパク！！！',
  bonk: 'ゴツン〜',
  oops: 'おっと！',
  monsterWoke: 'モンスターが目を覚ました！',
  throwSnack: n => `🍔 夜食投げ ×${n}`,
  delivering: '配達中…',
  snackSoldOut: '🍽️ 夜食完売',
  seconds: n => `${n}秒`,
  snackCooldown: n => `次の夜食投げまで ${n} 秒`,
  delivered: '配達！',
  rosterEmpty: 'まだ参加者がいません',
  hintEmpty: '名前を入力して追加を押してください',
  hintReady: n => `${n}人参加 — スタートできます！`,
  hintNeedMore: n => `${n}人以上からスタートできます`,
  numName: n => n + '番'""",
}

T_OBSTACLE = {
    'ko': """  mute: '소리 끄기',
  unmute: '소리 켜기',
  slip: '미끌!',
  oops: '아이쿠!',
  thud: '퍽!',
  leadChange: '선두 교체!',
  finalStretch: '마지막 직선!',
  photoFinish: '포토 피니시!',
  rankNo: n => `${n}위`,
  winner: '우승!',
  finalGate: '⚠ 최종 관문 ⚠',
  reverseLane: '◀ 역방향 레인 ▶',
  pushLane: '≫ 옆으로 미는 레인 ≫',
  reviewing: '판독중…',
  racersStart: n => `${n}명 출발!`,
  botName: '봇',
  bananaRain: n => `🍌 바나나 비 ×${n}`,
  bananaRainBanner: '바나나 비!!',
  rosterEmpty: '아직 참가자가 없어요',
  hintEmpty: '이름을 입력하고 추가하기를 누르세요',
  hintReady: n => `${n}명 참가 — 시작할 수 있어요!`,
  hintNeedMore: n => `${n}명 이상부터 시작할 수 있어요`,
  numName: n => n + '번'""",
    'en': """  mute: 'Mute',
  unmute: 'Unmute',
  slip: 'Slip!',
  oops: 'Oops!',
  thud: 'THUD!',
  leadChange: 'New leader!',
  finalStretch: 'Final stretch!',
  photoFinish: 'Photo finish!',
  rankNo: n => `#${n}`,
  winner: 'Winner!',
  finalGate: '⚠ FINAL GATE ⚠',
  reverseLane: '◀ REVERSE LANE ▶',
  pushLane: '≫ SIDE-PUSH LANE ≫',
  reviewing: 'Reviewing…',
  racersStart: n => `${n} runners off!`,
  botName: 'Bot',
  bananaRain: n => `🍌 Banana rain ×${n}`,
  bananaRainBanner: 'BANANA RAIN!!',
  rosterEmpty: 'No players yet',
  hintEmpty: 'Type a name and hit Add',
  hintReady: n => `${n} players — ready to start!`,
  hintNeedMore: n => `Needs at least ${n} players to start`,
  numName: n => '#' + n""",
    'zh': """  mute: '静音',
  unmute: '取消静音',
  slip: '滑倒！',
  oops: '哎哟！',
  thud: '砰！',
  leadChange: '领先易主！',
  finalStretch: '最后直道！',
  photoFinish: '撞线争议！',
  rankNo: n => `第${n}名`,
  winner: '冠军！',
  finalGate: '⚠ 最终关卡 ⚠',
  reverseLane: '◀ 逆向赛道 ▶',
  pushLane: '≫ 侧推赛道 ≫',
  reviewing: '判定中…',
  racersStart: n => `${n} 人出发！`,
  botName: '机器人',
  bananaRain: n => `🍌 香蕉雨 ×${n}`,
  bananaRainBanner: '香蕉雨！！',
  rosterEmpty: '还没有参与者',
  hintEmpty: '输入名字后点添加',
  hintReady: n => `${n} 人参加 — 可以开始了！`,
  hintNeedMore: n => `至少要 ${n} 人才能开始`,
  numName: n => n + ' 号'""",
    'ja': """  mute: 'ミュート',
  unmute: 'ミュート解除',
  slip: 'ツルッ！',
  oops: 'おっと！',
  thud: 'ドンッ！',
  leadChange: 'トップ交代！',
  finalStretch: '最後の直線！',
  photoFinish: '写真判定！',
  rankNo: n => `${n}位`,
  winner: '優勝！',
  finalGate: '⚠ 最終関門 ⚠',
  reverseLane: '◀ 逆走レーン ▶',
  pushLane: '≫ 横押しレーン ≫',
  reviewing: '判定中…',
  racersStart: n => `${n}人スタート！`,
  botName: 'ボット',
  bananaRain: n => `🍌 バナナの雨 ×${n}`,
  bananaRainBanner: 'バナナの雨！！',
  rosterEmpty: 'まだ参加者がいません',
  hintEmpty: '名前を入力して追加を押してください',
  hintReady: n => `${n}人参加 — スタートできます！`,
  hintNeedMore: n => `${n}人以上からスタートできます`,
  numName: n => n + '番'""",
}

T = {'monster-chase': T_MONSTER, 'obstacle-run': T_OBSTACLE, 'push-royale': T_PUSH}

# ------------------------------------------------------------------- templates
GAME_HEAD = Template("""<!DOCTYPE html>
<html lang="$htmlLang">
<head>
$gaTag
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>$title</title>

<!-- SEO -->
<meta name="description" content="$desc" />
<meta name="keywords" content="$keywords" />
<meta name="author" content="kimdoogi" />
<meta name="robots" content="index, follow" />
<meta name="theme-color" content="#0a0a16" />
<link rel="canonical" href="$url" />
$hreflang
<link rel="icon" href='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">$emoji</text></svg>' />

<!-- Open Graph -->
<meta property="og:type" content="website" />
<meta property="og:site_name" content="$siteName" />
<meta property="og:locale" content="$ogLocale" />
$altLocales
<meta property="og:title" content="$ogTitle" />
<meta property="og:description" content="$ogDesc" />
<meta property="og:url" content="$url" />
<meta property="og:image" content="${base}assets/og-image.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />

<!-- Twitter -->
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="$ogTitle" />
<meta name="twitter:description" content="$ogDesc" />
<meta name="twitter:image" content="${base}assets/og-image.png" />

<!-- Structured data -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "VideoGame",
  "name": "$name",
  "alternateName": "$schemaAlt",
  "url": "$url",
  "image": "${base}assets/og-image.png",
  "description": "$schemaDesc",
  "keywords": "$schemaKeywords",
  "inLanguage": "$schemaLang",
  "genre": "Casual",
  "gamePlatform": "Web browser",
  "applicationCategory": "Game",
  "operatingSystem": "Any (web browser)",
  "author": { "@type": "Person", "name": "kimdoogi" },
  "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" }
}
</script>

<link rel="stylesheet" href="$slug.css" />
</head>
""")

UTIL_BAR = Template("""<div id="utilBar">
  <a href="$homeHref" title="$home" aria-label="$homeAria">🏠</a>
  <button id="muteBtn" type="button" aria-pressed="false" aria-label="$mute" title="$mute">🔊</button>
</div>
""")

ROSTER_BLOCK = Template("""  <div class="control">
    <label>$addLabel <span class="hint">$addHint</span></label>
    <div class="addRow">
      <input id="nameInput" type="text" placeholder="$placeholder" autocomplete="off" />
      <button id="addBtn" class="addBtn">$addBtn</button>
    </div>
$presets    <div class="rosterWrap">
      <div class="rosterList" id="rosterList"></div>
      <div class="rosterFoot">
        <span class="lobbyCount"><span id="countVal">0</span>$unit</span>
        <button id="clearBtn" class="clearBtn">$clear</button>
      </div>
    </div>
    <div class="lobbyHint" id="lobbyHint"></div>
  </div>
""")

WIN_SCREEN = Template("""<div class="overlay hidden" id="winScreen">
  <div class="crown">$crown</div>
  <div style="font-weight:800;color:#b8b8d8;letter-spacing:2px;">WINNER</div>
  <div id="winName">-</div>
  <ul class="rankList" id="rankList"></ul>
  <button class="playBtn win" id="againBtn">$again</button>
$extra</div>
""")


def game_page(slug, lang):
    m = META[slug][lang]
    r = dict(ROSTER[lang])
    r['addHint'] = m.get('addHint', r['addHint'])
    head = GAME_HEAD.substitute(
        gaTag=ga_tag(), htmlLang=HTML_LANG[lang], ogLocale=OG_LOCALE[lang], schemaLang=SCHEMA_LANG[lang],
        base=BASE, url=page_url(slug, lang), slug=slug, emoji=EMOJI[slug],
        siteName=SITE_NAME[lang], hreflang=hreflang_block(slug), altLocales=alt_locales(lang),
        title=m['title'], desc=m['desc'], keywords=m['keywords'],
        ogTitle=m['ogTitle'], ogDesc=m['ogDesc'], name=m['name'],
        schemaAlt=m['schemaAlt'], schemaDesc=m['schemaDesc'], schemaKeywords=m['schemaKeywords'])

    presets = ''
    if 'presets' in m:
        rows = '\n'.join(f'      <button class="preset" data-n="{n}">{lab}</button>'
                         for n, lab in zip([12, 50, 100, 300], m['presets']))
        presets = f'    <div class="presets">\n{rows}\n    </div>\n'

    if slug == 'monster-chase':
        hud = (f'<div id="hud">\n  <div class="pill">{m["hud"]} <span class="big" id="aliveCount">0</span></div>\n'
               f'  <button id="boomBtn" type="button" aria-keyshortcuts="Space" aria-describedby="snackHelp">{m["boom"]}</button>\n</div>\n'
               f'<div id="snackCombo" role="status" aria-live="polite" hidden></div>\n'
               f'<span id="snackHelp" class="srOnly">{m["snackHelp"]}</span>\n')
        crown, extra = '👑', ''
    elif slug == 'obstacle-run':
        hud = (f'<div id="hud">\n  <div class="pill">{m["hud"]} <span class="big" id="finCount">0</span>'
               f'<span id="totCount" style="opacity:.6">/300</span></div>\n'
               f'  <button id="boomBtn">{m["boom"]}</button>\n</div>\n'
               f'<div id="ffChip">{m["ff"]}</div>\n<div id="ticker"></div>\n')
        crown, extra = '🏆', ''
    else:
        hud = (f'<div id="hud">\n  <div class="pill">{m["hud"]} <span class="big" id="aliveCount">0</span></div>\n'
               f'  <button id="shakeBtn">{m["shake"]}</button>\n</div>\n')
        crown = '👑'
        extra = f'  <button class="shareBtn" id="shareBtn" type="button">{m["share"]}</button>\n'

    toast = '<div id="toast" role="status" aria-live="polite"></div>\n' if slug == 'push-royale' else ''
    share_url = f"  shareUrl: '{page_url(slug, lang)}',\n" if slug == 'push-royale' else ''

    return head + f"""<body>
<canvas id="game"></canvas>

""" + UTIL_BAR.substitute(homeHref=page_file('', lang), **r) + f"""
{hud}
<div id="countdown"></div>

<div class="overlay" id="startScreen">
  <div class="title">{m['titleHtml']}</div>
  <div class="subtitle">{m['subtitle']}
    <span class="tagline">{m['tagline']}</span>
  </div>
""" + ROSTER_BLOCK.substitute(presets=presets, **r) + f"""  <button class="playBtn" id="startBtn">{m.get('start', r['start'])}</button>
</div>

""" + WIN_SCREEN.substitute(crown=crown, again=r['again'], extra=extra) + f"""
{toast}<script>
window.T = {{
{share_url}{T[slug][lang]}
}};
</script>
<script src="{slug}.js"></script>
</body>
</html>
"""


INDEX = Template("""<!DOCTYPE html>
<html lang="$htmlLang">
<head>
$gaTag
  <meta name="google-site-verification" content="D44tLBWbmoVG9Eu1X8DfGF1uaaMVOPQJl4oe-grzMiw" />
  <meta name="naver-site-verification" content="004f6f44faf5d8536fa5e666773cca57ed9753cd" />
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>$title</title>

  <!-- SEO -->
  <meta name="description" content="$desc" />
  <meta name="keywords" content="$keywords" />
  <meta name="author" content="kimdoogi" />
  <meta name="robots" content="index, follow" />
  <meta name="theme-color" content="#0a0a16" />
  <link rel="canonical" href="$url" />
$hreflang
  <link rel="icon" href='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎮</text></svg>' />

  <!-- Open Graph -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="$siteName" />
  <meta property="og:locale" content="$ogLocale" />
$altLocales
  <meta property="og:title" content="$ogTitle" />
  <meta property="og:description" content="$ogDesc" />
  <meta property="og:url" content="$url" />
  <meta property="og:image" content="${base}assets/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />

  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="$ogTitle" />
  <meta name="twitter:description" content="$ogDesc" />
  <meta name="twitter:image" content="${base}assets/og-image.png" />

  <!-- Structured data -->
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": "$siteName",
    "url": "$url",
    "inLanguage": "$schemaLang",
    "description": "$schemaDesc",
    "hasPart": [
$hasPart
    ]
  }
  </script>

  <link rel="stylesheet" href="index.css" />
</head>
<body>
  <h1>$h1</h1>
  <p class="sub">$sub</p>

  <div class="grid">
$cards  </div>

  <p class="langLinks">$langLabel
$langLinks  </p>

  <footer>Made with 🕹️ · <a href="https://github.com/kimdoogi/ranking-game">GitHub</a></footer>
</body>
</html>
""")

LANG_LABEL = {'ko': '다른 언어:', 'en': 'Other languages:', 'zh': '其他语言：', 'ja': '他の言語:'}
LANG_NAME = {'ko': '한국어', 'en': 'English', 'zh': '中文', 'ja': '日本語'}


def index_page(lang):
    m = META[''][lang]
    cards = ''
    for slug, desc in zip(GAMES, CARDS[lang]):
        cards += (f'    <a class="card" href="{page_file(slug, lang)}">\n'
                  f'      <div class="emoji">{EMOJI[slug]}</div>\n'
                  f'      <div class="meta">\n'
                  f'        <div class="name">{META[slug][lang]["name"]}</div>\n'
                  f'        <div class="desc">{desc}</div>\n'
                  f'      </div>\n'
                  f'      <div class="arrow">›</div>\n'
                  f'    </a>\n\n')
    others = [lg for lg in LANGS if lg != lang]
    links = ' ·\n'.join(f'    <a href="{page_file("", lg)}" hreflang="{HTML_LANG[lg]}">{LANG_NAME[lg]}</a>'
                        for lg in others) + '\n'
    parts = ',\n'.join(f'      {{ "@type": "VideoGame", "name": "{META[s][lang]["name"]}", '
                       f'"url": "{page_url(s, lang)}" }}' for s in GAMES)
    return INDEX.substitute(
        gaTag=ga_tag('  '), htmlLang=HTML_LANG[lang], ogLocale=OG_LOCALE[lang], schemaLang=SCHEMA_LANG[lang],
        base=BASE, url=page_url('', lang), siteName=SITE_NAME[lang],
        hreflang=hreflang_block('', '  '), altLocales=alt_locales(lang, '  '),
        title=m['title'], desc=m['desc'], keywords=m['keywords'], ogTitle=m['ogTitle'],
        ogDesc=m['ogDesc'], schemaDesc=m['schemaDesc'], h1=m['h1'], sub=m['sub'],
        hasPart=parts, cards=cards, langLabel=LANG_LABEL[lang], langLinks=links)


def sitemap(lastmod='2026-08-11'):
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
           '        xmlns:xhtml="http://www.w3.org/1999/xhtml">']
    for slug in [''] + GAMES:
        alts = '\n'.join(
            f'    <xhtml:link rel="alternate" hreflang="{lg}" href="{page_url(slug, lg)}"/>' for lg in LANGS)
        alts += f'\n    <xhtml:link rel="alternate" hreflang="x-default" href="{page_url(slug, "ko")}"/>'
        for lang in LANGS:
            out += ['  <url>', f'    <loc>{page_url(slug, lang)}</loc>',
                    f'    <lastmod>{lastmod}</lastmod>', '    <changefreq>monthly</changefreq>',
                    f'    <priority>{"1.0" if slug == "" else "0.8"}</priority>', alts, '  </url>']
    out.append('</urlset>')
    return '\n'.join(out) + '\n'


if __name__ == '__main__':
    written = []
    for lang in LANGS:
        open(page_file('', lang), 'w', encoding='utf-8').write(index_page(lang))
        written.append(page_file('', lang))
        for slug in GAMES:
            open(page_file(slug, lang), 'w', encoding='utf-8').write(game_page(slug, lang))
            written.append(page_file(slug, lang))
    open('sitemap.xml', 'w', encoding='utf-8').write(sitemap())
    written.append('sitemap.xml')
    print(f'{len(written)} files written:\n  ' + '\n  '.join(written))
