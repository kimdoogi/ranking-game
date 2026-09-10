#!/usr/bin/env python3
"""Fails if any localized page's window.T is missing a key its game's JS uses."""
import re
from pathlib import Path

LANGS = ['ko', 'en', 'zh', 'ja']
GAMES = ['monster-chase', 'obstacle-run', 'push-royale']

for slug in GAMES:
    js = open(f'{slug}.js', encoding='utf-8').read()
    used = set(re.findall(r'\bT\.(\w+)', js))
    if slug == 'obstacle-run':
        effects = Path('obstacle-run-fx.js').read_text(encoding='utf-8')
        used.update(re.findall(r'\bthis\.text\.(\w+)', effects))
    for lang in LANGS:
        f = f'{slug}.html' if lang == 'ko' else f'{slug}-{lang}.html'
        block = re.search(r'window\.T = \{(.*?)\n\};', open(f, encoding='utf-8').read(), re.S).group(1)
        have = set(re.findall(r'(?:^\s{2}|, )(\w+):', block, re.M))
        missing, unused = sorted(used - have), sorted(have - used - {'shareUrl'})
        assert not missing, f'{f} missing T keys: {missing}'
        print(f'{f}: ok ({len(have)} keys)' + (f' — unused: {unused}' if unused else ''))

print('all pages in sync')
