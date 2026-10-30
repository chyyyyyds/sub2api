"""只读检查生产并发和待处理任务，输出汇总而不输出请求或凭据。"""
import json
import subprocess
import time
from pathlib import Path

root=Path('/home/ubuntu/sub2api-video-studio-20261030')
def run(args): return subprocess.check_output(args,stderr=subprocess.PIPE).decode().strip()
def inspect(name): return json.loads(run(['docker','inspect',name]))[0]
app=inspect('sub2api-v11-prod-app')
pg=inspect('sub2api-v11-prod-postgres')
pg_env=dict(v.split('=',1) for v in pg['Config']['Env'] if '=' in v)
def sql(q):return run(['docker','exec','sub2api-v11-prod-postgres','psql','-U',pg_env['POSTGRES_USER'],'-d',pg_env.get('POSTGRES_DB',pg_env['POSTGRES_USER']),'-Atc',q])
redis=inspect('sub2api-v11-prod-redis')
redis_env=dict(v.split('=',1) for v in redis['Config']['Env'] if '=' in v)
password=redis_env.get('REDIS_PASSWORD','')
cmd=redis['Config'].get('Cmd') or []
if not password and '--requirepass' in cmd:password=cmd[cmd.index('--requirepass')+1]
app_env=dict(v.split('=',1) for v in app['Config']['Env'] if '=' in v)
if not password:password=app_env.get('REDIS_PASSWORD','')
def redis_call(*args):
 command=['docker','exec']
 if password:command+=['-e','REDISCLI_AUTH='+password]
 command+=['sub2api-v11-prod-redis','redis-cli','--raw','-n',app_env.get('REDIS_DB','0')]+list(args)
 return run(command)

def snapshot():
 total=0
 # 只扫描并发命名空间，按 Redis 服务器时间过滤过期槽位；不修改在线状态。
 now=int(redis_call('TIME').splitlines()[0])
 for pattern,age in [('concurrency:account:*',900),('concurrency:live:account:*',60),('concurrency:openai_ws_ingress:api_key:*',60)]:
  keys=redis_call('--scan','--pattern',pattern).splitlines()
  for key in keys:
   if key.endswith('active_index'):continue
   if redis_call('TYPE',key)=='zset':total+=int(redis_call('ZCOUNT',key,str(now-age),'+inf'))
 waits=0
 for pattern in ['concurrency:wait:*','wait:account:*']:
  for key in redis_call('--scan','--pattern',pattern).splitlines():
   if redis_call('TYPE',key)=='string':waits+=max(0,int(redis_call('GET',key) or '0'))
 pending=int(sql("SELECT count(*) FROM video_tasks WHERE status NOT IN('COMPLETED','FAILED')"))
 last=sql('SELECT COALESCE(EXTRACT(EPOCH FROM (now()-max(created_at)))::bigint,999999) FROM usage_logs')
 return {'active_slots':total,'waiting_requests':waits,'pending_video_tasks':pending,'seconds_since_last_usage':int(last),'healthy':inspect('sub2api-v11-prod-app')['State'].get('Health',{}).get('Status')=='healthy'}

if __name__=='__main__':print(json.dumps(snapshot()),flush=True)
