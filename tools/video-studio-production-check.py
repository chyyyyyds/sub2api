"""正式站发布后只读验收：入口、构建资源、媒体策略和视频配置，不生成视频。"""
import hashlib
import json
import re
import urllib.request
from pathlib import Path
root=Path('/home/ubuntu/sub2api-video-studio-20261030')
out=root/'output'
deployment=json.loads((out/'deployment.json').read_text());assert deployment['deployed']
dist=root/'source/backend/internal/web/dist'
entry=re.search(r'src="(/assets/[^\"]+\.js)"',(dist/'index.html').read_text()).group(1)
checks=[]
for origin in ['http://127.0.0.1:18083','https://chyyds.com']:
 for path in ['/health','/ai-creation/video','/ai-creation/image','/keys']:
  request=urllib.request.Request(origin+path,headers={'User-Agent':'Mozilla/5.0','Cache-Control':'no-cache'})
  with urllib.request.urlopen(request,timeout=30) as response:
   body=response.read();assert response.status==200
   if path!='/health':
    assert entry.encode() in body
    policies=response.headers.get_all('Content-Security-Policy') or []
    assert policies
    for policy in policies:
     media=next((part.strip() for part in policy.split(';') if part.strip().startswith('media-src ')),'')
     assert "'self'" in media and 'blob:' in media
   checks.append({'origin':origin,'path':path,'status':200})
 with urllib.request.urlopen(urllib.request.Request(origin+entry,headers={'User-Agent':'Mozilla/5.0'}),timeout=30) as response:
  assert hashlib.sha256(response.read()).hexdigest()==hashlib.sha256((dist/entry.lstrip('/')).read_bytes()).hexdigest()

token=(out/'admin-token.private').read_text()
def panel(path,method='GET'):
 request=urllib.request.Request('http://127.0.0.1:18083'+path,method=method,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},data=b'{}' if method=='POST' else None)
 with urllib.request.urlopen(request,timeout=180) as response:data=json.load(response)
 assert data['code']==0;return data['data']
group=panel('/api/v1/admin/groups/7')
assert group['platform']=='video' and group['status']=='active' and group['allow_koko_video_generation']
snapshot=panel('/api/v1/admin/accounts/13/koko/refresh','POST')
models=[m['id'] for m in snapshot['models'] if m['studio_enabled']]
assert models==['oo-sd25-1080p']
report={'passed':True,'version':'6.6.6','checks':checks,'asset_matches':True,'media_policy_ready':True,'video_group_active':True,'models':models,'generation_requests':0}
(out/'production-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
(out/'deploy-wait.json').write_text(json.dumps({'waiting':False,'deployed':True}),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False),flush=True)
