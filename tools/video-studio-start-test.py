"""启动克隆数据库上的候选站；测试会话和 Key 只写服务器私有文件。"""
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path

os.umask(0o077)
root=Path('/home/ubuntu/sub2api-video-studio-20261030')
out=root/'output'
def run(args):
 p=subprocess.run(args,capture_output=True)
 if p.returncode:
  (out/'start-private.log').write_bytes(p.stdout+p.stderr)
  raise RuntimeError('测试环境操作失败：'+args[0])
 return p.stdout.decode().strip()
def sql(q): return run(['docker','exec','sub2api-koko-c2-pg','psql','-U','postgres','-d','video_studio_20261030','-Atc',q])
def inspect(name): return json.loads(run(['docker','inspect',name]))[0]
app=inspect('sub2api-v11-prod-app')
env=dict(v.split('=',1) for v in app['Config']['Env'] if '=' in v)
env.update({'DATABASE_HOST':'sub2api-koko-c2-pg','DATABASE_USER':'postgres','DATABASE_PASSWORD':'koko-test-only','DATABASE_DBNAME':'video_studio_20261030','DATABASE_PORT':'5432','DATABASE_SSLMODE':'disable','REDIS_HOST':'sub2api-video-studio-redis','REDIS_DB':'0','REDIS_PASSWORD':'','KOKO_VIDEO_ENABLED':'true','BATCH_IMAGE_ENABLED':'false','BATCH_IMAGE_QUEUE_ENABLED':'false','IMAGE_STORAGE_ENABLED':'false','SERVER_PORT':'8080','SERVER_HOST':'0.0.0.0'})
data=root/'test-data';data.mkdir(exist_ok=True)
try:
 config_exists=(data/'config.yaml').exists()
except PermissionError:
 # 应用入口会收紧数据目录权限；已经初始化的配置通过 Docker 挂载继续复用。
 config_exists=True
if not config_exists:
 run(['docker','cp','sub2api-v11-prod-app:/app/data/config.yaml',str(data/'config.yaml')])
sql("UPDATE accounts SET extra=COALESCE(extra,'{}'::jsonb)||'{\"upstream_billing_probe_enabled\":false}'::jsonb; UPDATE groups SET status='active',allow_koko_video_generation=true WHERE id=7;")
name='sub2api-video-studio-test'
if subprocess.run(['docker','inspect',name],capture_output=True).returncode==0:
 run(['docker','rm','-f',name])
args=['docker','run','-d','--name',name,'--network','sub2api-koko-c2','--memory=1g','--cpus=1','-p','127.0.0.1:18089:8080','-v',str(data)+':/app/data']
for k,v in env.items(): args.extend(['-e',k+'='+v])
run(args+['sub2api-v11-prod:video-studio-20261030-v666'])
(out/'test-env.json').write_text(json.dumps(env),encoding='utf-8')
print('候选测试站已启动：127.0.0.1:18089',flush=True)

def token(email=None):
 args=['docker','run','--rm','--network','sub2api-koko-c2','--volumes-from',name+':ro','-v','/home/ubuntu/sub2api-koko-c2/output/jwtgen:/app/jwtgen:ro','--entrypoint','/app/jwtgen']
 for k,v in env.items(): args.extend(['-e',k+'='+v])
 raw=run(args+[app['Config']['Image']]+(['-email',email] if email else []))
 return re.search(r'^JWT=(.+)$',raw,re.M).group(1)
admin_token=token()
(out/'admin-token.private').write_text(admin_token,encoding='utf-8')
test_email='video-studio-test-20261030@local.invalid'
sql("INSERT INTO users(email,password_hash,role,balance,concurrency,status) SELECT '"+test_email+"','test-disabled-password','user',100,2,'active' WHERE NOT EXISTS(SELECT 1 FROM users WHERE email='"+test_email+"')")
(out/'user-token.private').write_text(token(test_email),encoding='utf-8')
print('隔离用户与管理会话已准备，未发起生成请求',flush=True)
