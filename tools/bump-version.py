#!/usr/bin/env python3
"""Stamp a fresh version on every script/style URL so browsers never mix cached files
from different releases. Run before committing:  python3 tools/bump-version.py"""
import pathlib, re, time

root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M%S')

# all relative module imports inside js/
for f in (root / 'js').glob('*.js'):
    s = f.read_text()
    s2 = re.sub(r"""(from\s+['"])(\.{1,2}/[^'"?]+\.js)(\?v=\w+)?(['"])""", lambda m: f"{m[1]}{m[2]}?v={v}{m[4]}", s)
    s2 = re.sub(r"""(import\(\s*['"])(\.{1,2}/[^'"?]+\.js)(\?v=\w+)?(['"])""", lambda m: f"{m[1]}{m[2]}?v={v}{m[4]}", s2)
    if s2 != s:
        f.write_text(s2)

html = root / 'index.html'
s = html.read_text()
s = re.sub(r'(src="js/main\.js)(\?v=\w+)?(")', rf'\g<1>?v={v}\3', s)
s = re.sub(r'(href="css/style\.css)(\?v=\w+)?(")', rf'\g<1>?v={v}\3', s)
s = re.sub(r"(window\.GAME_VERSION = ')[^']*(')", rf"\g<1>{v}\2", s)
html.write_text(s)
print('version', v)
