"""只读读取线上视频配置和上游目录；凭据始终留在服务器内存。"""
import json
import subprocess
import urllib.request
from pathlib import Path

def run(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE).decode().strip()

app = json.loads(run(['docker', 'inspect', 'sub2api-v11-prod-app']))[0]
pg = json.loads(run(['docker', 'inspect', 'sub2api-v11-prod-postgres']))[0]
env = dict(v.split('=', 1) for v in pg['Config']['Env'] if '=' in v)
def sql(q):
    return run(['docker', 'exec', pg['Name'].lstrip('/'), 'psql', '-U', env['POSTGRES_USER'], '-d', env.get('POSTGRES_DB', env['POSTGRES_USER']), '-Atc', q])

account = json.loads(sql("SELECT row_to_json(a) FROM accounts a WHERE id=13 AND deleted_at IS NULL"))
headers = {'Authorization': 'Bearer ' + account['credentials']['api_key']}
base = account['credentials']['base_url'].rstrip('/')
def upstream(path):
    with urllib.request.urlopen(urllib.request.Request(base + path, headers=headers), timeout=90) as response:
        return json.load(response)

models = upstream('/models')
print(json.dumps({'image': app['Config']['Image'], 'healthy': app['State'].get('Health'), 'account': {k: account[k] for k in ['id','name','platform','status','concurrency']}, 'models': models, 'groups': json.loads(sql("SELECT json_agg(json_build_object('id',g.id,'name',g.name,'platform',g.platform,'status',g.status,'gate',g.allow_koko_video_generation,'model_allowlist',g.model_allowlist)) FROM groups g JOIN account_groups ag ON ag.group_id=g.id WHERE ag.account_id=13 AND g.deleted_at IS NULL")), 'task_counts': sql("SELECT status,count(*) FROM video_tasks GROUP BY status"), 'koko_enabled': [v for v in app['Config']['Env'] if 'KOKO' in v], 'server_arch': run(['uname','-m'])}, ensure_ascii=False, indent=2))
