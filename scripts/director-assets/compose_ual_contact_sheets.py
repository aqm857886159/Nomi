from __future__ import annotations
import argparse,json,os
from PIL import Image,ImageDraw,ImageFont

def main():
 p=argparse.ArgumentParser(); p.add_argument('--manifest',required=True); p.add_argument('--out-dir',required=True); a=p.parse_args(); data=json.load(open(a.manifest)); font_path='/System/Library/Fonts/Supplemental/Arial Unicode.ttf'; font=ImageFont.truetype(font_path,16) if os.path.exists(font_path) else ImageFont.load_default(); small=ImageFont.truetype(font_path,12) if os.path.exists(font_path) else ImageFont.load_default(); cell_w,cell_h=320,270; cols=3; rows_per=15
 for page,start in enumerate(range(0,len(data['actions']),rows_per),1):
  subset=data['actions'][start:start+rows_per]; sheet=Image.new('RGB',(cell_w*cols,cell_h*len(subset)),(20,24,31)); draw=ImageDraw.Draw(sheet)
  for row,action in enumerate(subset):
   for col,sample in enumerate(action['samples']):
    im=Image.open(sample['image']).convert('RGB').resize((cell_w,240)); x=col*cell_w; y=row*cell_h; sheet.paste(im,(x,y)); draw.rectangle((x,y+240,x+cell_w,y+cell_h),fill=(24,29,38)); txt=f"{action['id']} · {sample['label']} · f={sample['frame']} · foot={sample['footMinCm']}cm"; draw.text((x+6,y+246),txt,fill=(235,240,248),font=small)
  out=os.path.join(a.out_dir,f'ual-actions-contact-{page:02d}.png'); sheet.save(out); print(out)
if __name__=='__main__': main()
