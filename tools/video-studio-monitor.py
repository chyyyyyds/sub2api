"""每五分钟检查测试库原任务；只下载既有成片，永不重新提交收费生成。"""
import hashlib
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

os.umask(0o077)
root=Path('/home/ubuntu/sub2api-video-studio-20261030')
out=root/'output'
task=json.loads((root/'real-task.json').read_text())
task_id=task['id']
assert task_id.startswith('vtsk_') and task_id.replace('_','').isalnum()
def sql(q):return subprocess.check_output(['docker','exec','sub2api-koko-c2-pg','psql','-U','postgres','-d','video_studio_20261030','-Atc',q],stderr=subprocess.PIPE).decode().strip()
for attempt in range(145):
 view=json.loads(sql("SELECT json_build_object('status',t.status,'billing_state',f.state,'submit_attempts',t.submit_attempts,'poll_attempts',t.poll_attempts,'error_code',t.last_error_code,'created_at',t.created_at,'updated_at',t.updated_at,'upstream_bound',t.upstream_id IS NOT NULL) FROM video_tasks t JOIN video_financial_reservations f ON f.task_id=t.id WHERE t.public_id='"+task_id+"'"))
 view['monitor_checks']=attempt+1
 (out/'real-status.json').write_text(json.dumps(view,ensure_ascii=False,indent=2),encoding='utf-8')
 if view['status']=='FAILED':
  print(json.dumps(view,ensure_ascii=False),flush=True)
  raise SystemExit('真实生成失败；停止，不自动重提')
 if view['status']=='COMPLETED' and view['billing_state']=='CAPTURED':break
 if attempt==0:print('原任务生成中；监测间隔五分钟，实际生成状态由候选站自动更新。',flush=True)
 time.sleep(300)
else:raise SystemExit('生成仍未完成；保留原任务，不重新生成')
assert view['submit_attempts']==1
key=sql("SELECT k.key FROM api_keys k JOIN video_tasks t ON t.api_key_id=k.id WHERE t.public_id='"+task_id+"'")
request=urllib.request.Request('http://127.0.0.1:18089/v1/videos/'+task_id+'/content',headers={'Authorization':'Bearer '+key})
target=out/'real-video.mp4'
digest=hashlib.sha256();size=0;head=b''
with urllib.request.urlopen(request,timeout=600) as response, (out/'real-video.mp4.part').open('wb') as file:
 assert response.status==200
 content_type=response.headers.get('Content-Type','')
 while True:
  block=response.read(1024*1024)
  if not block:break
  if not head:head=block[:32]
  file.write(block);digest.update(block);size+=len(block)
assert size>10000 and (b'ftyp' in head or head.startswith(b'\x1aE\xdf\xa3'))
(out/'real-video.mp4.part').replace(target)
count=int(sql("SELECT count(*) FROM usage_logs WHERE video_task_id='"+task_id+"'"))
assert count==1
result={**view,'task_id':task_id,'download_bytes':size,'sha256':digest.hexdigest(),'content_type':content_type,'usage_records':count,'paid_generation_posts':1}
(out/'real-validation.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(result,ensure_ascii=False),flush=True)
