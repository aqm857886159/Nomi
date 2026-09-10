#!/usr/bin/env python3
"""Assemble existing media for visual review; never generates cover artwork."""
import argparse
import math
import re
from pathlib import Path

import yaml
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--trial', action='store_true')
args = parser.parse_args()
entries = []
for source in sorted((ROOT / 'skills').glob('*/SKILL.md')):
    front = yaml.safe_load(source.read_text().split('---', 2)[1])
    library = front.get('metadata', {}).get('nomi', {}).get('library')
    if not library:
        heading = re.search(r'^# (.+)$', source.read_text(), re.MULTILINE)
        label = front.get('metadata', {}).get('nomi', {}).get('label') or (heading.group(1) if heading else source.parent.name)
        library = {'title': {'zh-CN': label}}
    preview = library.get('preview')
    if not preview:
        if not args.trial:
            entries.append((library['title']['zh-CN'], source.parent.name, None, 'pending'))
        continue
    if args.trial and preview['provenance'] != 'illustration':
        continue
    entries.append((library['title']['zh-CN'], source.parent.name,
                    source.parent / preview['path'], preview['provenance']))
if args.trial:
    entries.insert(0, ('锚图 3 · 已拍板', 'anchor-3',
                      ROOT / 'docs/design/covers/anchors/anchor-3.png', 'reference'))
columns = 3 if args.trial else 5
width, height, gap, top = 360, 250, 16, 78
sheet = Image.new('RGB', (columns * (width + gap) + gap,
                         math.ceil(len(entries) / columns) * (height + gap) + top), '#eeece6')
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Songti.ttc', 18)
small = ImageFont.truetype('/System/Library/Fonts/Supplemental/Songti.ttc', 13)
illustrations = sum(item[3] == 'illustration' for item in entries)
real = sum(item[3] == 'upstream-output' for item in entries)
pending = sum(item[3] == 'pending' for item in entries)
title = f'封面 v1 · 试产与锚图对照 · {illustrations} 张' if args.trial else f'封面盘点 · {len(entries)} 条 · {real} 原始媒体 + {illustrations} 插画 + {pending} 待生成'
draw.text((gap, 16), title, font=font, fill='#252931')
draw.text((gap, 44), '标题仅标在接触表图外；各条目封面无文字。', font=small, fill='#555963')
for index, (label, name, filename, provenance) in enumerate(entries):
    x, y = gap + index % columns * (width + gap), top + index // columns * (height + gap)
    if filename:
        with Image.open(filename) as image:
            thumb = ImageOps.contain(image.convert('RGB'), (width, 202), Image.Resampling.LANCZOS)
            draw.rectangle((x, y, x + width, y + 202), fill='#f6f4e9')
            sheet.paste(thumb, (x + (width - thumb.width) // 2, y + (202 - thumb.height) // 2))
    else:
        draw.rectangle((x, y, x + width, y + 202), fill='#e0dfda')
        draw.text((x + 90, y + 86), '未生成 · 非封面', font=font, fill='#555963')
    draw.text((x, y + 207), label, font=font, fill='#252931')
    draw.text((x, y + 232), name, font=small, fill='#555963')
output = ROOT / 'docs/design/covers/contact-sheet-skill-ui-b.png'
sheet.save(output)
print(f'{output.relative_to(ROOT)}: {len(entries)} images, {sheet.width}×{sheet.height}')
