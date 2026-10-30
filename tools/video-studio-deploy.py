"""真实生成验收后，仅在线上连续空闲时切换应用镜像；保留 6.6.6 和回滚文件。"""
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path

os.umask(0o077)
root=Path('/home/ubuntu/sub2api-video-studio-20261030')
spec=importlib.util.spec_from_file_location('video_studio_idle',root/'video-studio-idle.py')
idle_module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(idle_module)
snapshot=idle_module.snapshot
out=root/'output'
compose=Path('/home/ubuntu/sub2api-v11-prod/compose.yaml')
tag='sub2api-v11-prod:video-studio-20261030-v666'
def run(args):
 p=subprocess.run(args,capture_output=True)
 if p.returncode:
  (out/'deploy-private-error.log').write_bytes(p.stdout+p.stderr)
  raise RuntimeError('发布操作失败：'+args[0])
 return p.stdout.decode().strip()
def inspect(name):return json.loads(run(['docker','inspect',name]))[0]
def healthy():
 with urllib.request.urlopen('http://127.0.0.1:18083/health',timeout=10) as response:return json.load(response)['status']=='ok'

assert all(item['exit_code']==0 for item in json.loads((out/'build-results.json').read_text()))
assert json.loads((out/'final-build.json').read_text())['exit_code']==0
assert all(item['exit_code']==0 for item in json.loads((out/'media-tests.json').read_text()))
validation=json.loads((out/'real-validation.json').read_text())
assert validation['status']=='COMPLETED' and validation['billing_state']=='CAPTURED' and validation['paid_generation_posts']==1 and validation['usage_records']==1
assert json.loads((out/'real-finance.json').read_text())['passed'] is True
playback=json.loads((out/'browser-playback.json').read_text())
assert playback['width']==1920 and playback['height']==1080 and playback['duration']>=29
old=inspect('sub2api-v11-prod-app')
baseline=json.loads((root/'rollback/app.json').read_text())
assert old['Image']==baseline['Image'],'生产镜像已变化，停止切换'
original=compose.read_bytes()
assert original==(root/'rollback/compose.yaml').read_bytes(),'生产 Compose 已变化，停止切换'
assert healthy()
version=run(['docker','run','--rm','--network','none','--entrypoint','/app/sub2api',tag,'-version'])
assert '6.6.6' in version
candidate=inspect(tag)
assert candidate['Architecture']=='arm64'

# 等待既有用户调用结束；每分钟检查，不抢占、不终止正在处理的请求。
def idle(value):return value['healthy'] and value['active_slots']==0 and value['waiting_requests']==0 and value['pending_video_tasks']==0 and value['seconds_since_last_usage']>=120
checks=[]
for attempt in range(720):
 value=snapshot();checks.append(value)
 (out/'deploy-wait.json').write_text(json.dumps({'checks':checks[-5:],'waiting':True}),encoding='utf-8')
 if idle(value):
  time.sleep(30)
  second=snapshot();checks.append(second)
  if idle(second):break
 time.sleep(60)
else:raise RuntimeError('线上仍有调用，保留候选版本，未切换生产')
assert inspect('sub2api-v11-prod-app')['Id']==old['Id'] and compose.read_bytes()==original

pg=inspect('sub2api-v11-prod-postgres')
pg_env=dict(v.split('=',1) for v in pg['Config']['Env'] if '=' in v)
def sql(q):return run(['docker','exec','sub2api-v11-prod-postgres','psql','-U',pg_env['POSTGRES_USER'],'-d',pg_env.get('POSTGRES_DB',pg_env['POSTGRES_USER']),'-v','ON_ERROR_STOP=1','-Atc',q])
with (root/'rollback/database-before-switch.dump').open('wb') as file:subprocess.run(['docker','exec','sub2api-v11-prod-postgres','pg_dump','-U',pg_env['POSTGRES_USER'],'-d',pg_env.get('POSTGRES_DB',pg_env['POSTGRES_USER']),'-Fc'],stdout=file,stderr=subprocess.PIPE,check=True)
group=json.loads(sql('SELECT row_to_json(g) FROM groups g WHERE id=7'))
(root/'rollback/video-group.json').write_text(json.dumps(group),encoding='utf-8')
all_before={v['Name']:(v['Id'],v['State']['StartedAt']) for v in json.loads(run(['docker','inspect']+run(['docker','ps','-q']).split())) if v['Name']!='/sub2api-v11-prod-app'}
text=original.decode('utf-8')
old_image=old['Config']['Image']
assert text.count('image: '+old_image)==1
text=text.replace('image: '+old_image,'image: '+tag)
app_block=re.search(r'(?ms)^  app:\n.*?(?=^  [A-Za-z0-9_-]+:|\Z)',text)
assert app_block,'未找到独立 app 服务'
block=app_block.group()
if 'KOKO_VIDEO_ENABLED' in block:
 block=re.sub(r'(?m)^(\s*(?:-\s*)?KOKO_VIDEO_ENABLED\s*[:=]\s*).+$',r'\g<1>"true"',block)
else:
 match=re.search(r'(?m)^(\s+)environment:\s*\n',block);assert match
 rest=block[match.end():]
 list_style=bool(re.match(r'\s+-\s',rest))
 indent=match.group(1)+'  '
 entry=indent+('- KOKO_VIDEO_ENABLED=true' if list_style else 'KOKO_VIDEO_ENABLED: "true"')+'\n'
 block=block[:match.end()]+entry+rest
text=text[:app_block.start()]+block+text[app_block.end():]
command=['docker','compose','--project-name','sub2api-v11-prod','--file',str(compose)]
try:
 compose.write_text(text,encoding='utf-8')
 run(command+['config','--quiet'])
 # 最后一次检查紧挨切换；若有新请求到达则恢复 Compose，继续等待后重跑。
 assert idle(snapshot()),'切换前检测到新请求，未执行替换'
 run(command+['up','-d','--no-deps','--no-build','--pull','never','app'])
 for _ in range(40):
  try:
   current=inspect('sub2api-v11-prod-app')
   if current['State'].get('Health',{}).get('Status')=='healthy' and healthy():break
  except Exception:pass
  time.sleep(2)
 else:raise RuntimeError('候选应用健康检查失败')
 assert current['Image']==candidate['Id']
 assert sorted(current['Mounts'],key=lambda x:x['Destination'])==sorted(old['Mounts'],key=lambda x:x['Destination'])
 old_env=dict(v.split('=',1) for v in old['Config']['Env'] if '=' in v)
 new_env=dict(v.split('=',1) for v in current['Config']['Env'] if '=' in v)
 assert {k:v for k,v in new_env.items() if k!='KOKO_VIDEO_ENABLED'}=={k:v for k,v in old_env.items() if k!='KOKO_VIDEO_ENABLED'}
 assert new_env['KOKO_VIDEO_ENABLED']=='true'
 assert set(current['NetworkSettings']['Networks'])==set(old['NetworkSettings']['Networks'])
 expected=hashlib.sha256((out/'sub2api').read_bytes()).hexdigest()
 assert run(['docker','exec','sub2api-v11-prod-app','sha256sum','/app/sub2api']).split()[0]==expected
 assert sql("SELECT platform FROM groups WHERE id=7")=='video'
 assert sql("SELECT platform FROM accounts WHERE id=13")=='video'
 # 通过原管理服务开放分组，触发既有分组与 Key 缓存失效流程。
 args=['docker','run','--rm','--network',current['HostConfig']['NetworkMode'],'--volumes-from','sub2api-v11-prod-app:ro','-v','/home/ubuntu/sub2api-koko-c2/output/jwtgen:/app/jwtgen:ro','--entrypoint','/app/jwtgen']
 for env in current['Config']['Env']:args+=['-e',env]
 raw=run(args+[tag]);token=re.search(r'^JWT=(.+)$',raw,re.M).group(1)
 request=urllib.request.Request('http://127.0.0.1:18083/api/v1/admin/groups/7',method='PUT',headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'},data=json.dumps({'status':'active','allow_koko_video_generation':True}).encode())
 with urllib.request.urlopen(request,timeout=60) as response:assert json.load(response)['code']==0
 all_after={v['Name']:(v['Id'],v['State']['StartedAt']) for v in json.loads(run(['docker','inspect']+run(['docker','ps','-q']).split())) if v['Name']!='/sub2api-v11-prod-app'}
 assert all(all_after.get(k)==v for k,v in all_before.items()),'其他既有容器发生变化'
 result={'deployed':True,'version':'6.6.6','image':tag,'binary_sha256':expected,'idle_checks':checks[-2:],'production_database_preserved':True,'only_model':'oo-sd25-1080p','other_containers_unchanged':True}
 (out/'deployment.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(result,ensure_ascii=False),flush=True)
except Exception:
 compose.write_bytes(original)
 if inspect('sub2api-v11-prod-app')['Image']!=old['Image']:
  # 回滚仅恢复原应用；业务数据库和当前余额不回滚，避免丢失刚发生的真实消费。
  run(command+['up','-d','--no-deps','--no-build','--pull','never','app'])
 raise
