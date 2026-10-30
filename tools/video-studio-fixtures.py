"""为上传验收制作无个人信息的测试画面和六秒音频。"""
import math
import struct
import wave
import zlib
from pathlib import Path

out=Path(__file__).resolve().parents[1]/'.codex/video-studio'
width,height=640,360
raw=bytearray()
for y in range(height):
 raw.append(0)
 for x in range(width):
  color=(int(190-y*.13),int(215-y*.07),225) if y<210 else (45,110+int((y-210)*.13),140)
  if (x-470)**2+(y-94)**2<38**2: color=(255,219,152)
  if 140<y<215 and y>200-70*max(0,1-abs(x-200)/180): color=(77,120,125)
  if y>195 and y<217 and y>210-60*max(0,1-abs(x-430)/160): color=(59,102,111)
  if 250<y<264 and 268+(y-250)<x<365-(y-250): color=(47,57,58)
  if 158<y<249 and 318-(y-158)*.45<x<318: color=(248,241,222)
  if 161<y<249 and 322<x<322+(y-161)*.32: color=(221,157,107)
  raw.extend(color)
def chunk(kind,data): return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(bytes(raw)))+chunk(b'IEND',b'')
(out/'reference-lake.png').write_bytes(png)
with wave.open(str(out/'reference-ambient.wav'),'wb') as audio:
 audio.setnchannels(1);audio.setsampwidth(2);audio.setframerate(16000)
 audio.writeframes(b''.join(struct.pack('<h',int(2200*math.sin(2*math.pi*220*n/16000)*min(1,n/8000,(96000-n)/8000))) for n in range(96000)))
print('测试素材已生成')
