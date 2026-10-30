"""候选站只读与权限验收；绝不创建视频。"""
import json
import os
import urllib.error
import urllib.request
from pathlib import Path

os.umask(0o077)
root=Path('/home/ubuntu/sub2api-video-studio-20261030')
out=root/'output'
base='http://127.0.0.1:18089'
admin=(out/'admin-token.private').read_text()
user=(out/'user-token.private').read_text()
def call(path,token,method='GET',body=None):
 data=json.dumps(body,ensure_ascii=False).encode() if body is not None else None
 request=urllib.request.Request(base+path,data=data,method=method,headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'})
 try:
  with urllib.request.urlopen(request,timeout=180) as response:return response.status,json.load(response)
 except urllib.error.HTTPError as error:return error.code,json.load(error)
def panel(path,token,method='GET',body=None):
 status,data=call(path,token,method,body);assert status==200,(path,status);assert data.get('code',0)==0,(path,data.get('message'));return data.get('data',data)

assert urllib.request.urlopen(base+'/health',timeout=10).status==200
snapshot=panel('/api/v1/admin/accounts/13/koko/refresh',admin,'POST',{})
allowed=[m for m in snapshot['models'] if m['studio_enabled']]
assert len(allowed)==1 and allowed[0]['id']=='oo-sd25-1080p'
assert allowed[0]['requires_image'] is False
assert allowed[0]['resolutions']==['1080p']
assert allowed[0]['durations']==[30]
assert '4:3' in allowed[0]['ratio']
me=panel('/api/v1/auth/me',user)
admin_me=panel('/api/v1/auth/me',admin)
assert me['role']=='user'
(out/'browser-auth.private.json').write_text(json.dumps({'user':{'access_token':user,'user':me},'admin':{'access_token':admin,'user':admin_me}},ensure_ascii=False),encoding='utf-8')
report={'healthy':True,'only_model':'oo-sd25-1080p','live_parameters':{k:allowed[0][k] for k in ['durations','resolutions','ratio','reference_images','reference_audios','max_prompt_length']},'real_video_posts':0}
(out/'api-check.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False),flush=True)
