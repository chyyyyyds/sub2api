"""在甲骨文建立隔离测试环境并编译，保留生产镜像与数据库备份。"""
import json
import os
import shutil
import subprocess
import tarfile
from pathlib import Path

os.umask(0o077)
root = Path('/home/ubuntu/sub2api-video-studio-20261030')
out = root / 'output'
out.mkdir(parents=True, exist_ok=True)
def run(args, **kwargs):
    p = subprocess.run(args, capture_output=True, **kwargs)
    if p.returncode:
        (out / 'private-error.log').write_bytes(p.stdout + p.stderr)
        raise RuntimeError('操作失败，详细信息保存在服务器私有日志：' + args[0])
    return p.stdout.decode().strip()
def inspect(name): return json.loads(run(['docker','inspect',name]))[0]

app = inspect('sub2api-v11-prod-app')
pg = inspect('sub2api-v11-prod-postgres')
env = dict(v.split('=',1) for v in pg['Config']['Env'] if '=' in v)
backup = root / 'rollback'
backup.mkdir(exist_ok=True)
if not (backup / 'app.json').exists():
    (backup / 'app.json').write_text(json.dumps(app),encoding='utf-8')
    shutil.copy2('/home/ubuntu/sub2api-v11-prod/compose.yaml', backup / 'compose.yaml')
    run(['docker','tag',app['Image'],'sub2api-v11-prod:video-studio-rollback-20261030'])
    with (backup / 'database.dump').open('wb') as f:
        subprocess.run(['docker','exec',pg['Name'].lstrip('/'),'pg_dump','-U',env['POSTGRES_USER'],'-d',env.get('POSTGRES_DB',env['POSTGRES_USER']),'-Fc'],stdout=f,stderr=subprocess.PIPE,check=True)
    print('生产镜像和数据库已备份',flush=True)

testpg = 'sub2api-koko-c2-pg'
dbname = 'video_studio_20261030'
exists = run(['docker','exec',testpg,'psql','-U','postgres','-d','postgres','-Atc',f"SELECT 1 FROM pg_database WHERE datname='{dbname}'"])
if not exists:
    run(['docker','exec',testpg,'createdb','-U','postgres',dbname])
    with (backup/'database.dump').open('rb') as f:
        p = subprocess.run(['docker','exec','-i',testpg,'pg_restore','-U','postgres','-d',dbname,'--no-owner','--no-acl','--exit-on-error'],stdin=f,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if p.returncode:
        (out/'restore.log').write_bytes(p.stdout+p.stderr)
        raise RuntimeError('测试库恢复失败')
    # 克隆生产配置后先关闭定时业务和其他账号，仅保留本次视频账号可调度。
    run(['docker','exec',testpg,'psql','-U','postgres','-d',dbname,'-v','ON_ERROR_STOP=1','-c',"UPDATE accounts SET schedulable=false WHERE id<>13; UPDATE groups SET status='active',allow_koko_video_generation=true WHERE id=7; UPDATE settings SET value='false' WHERE key IN ('upstream_billing_probe_enabled','scheduled_tests_enabled');"])
    print('生产数据库已恢复至独立测试库',flush=True)
redis = 'sub2api-video-studio-redis'
if subprocess.run(['docker','inspect',redis],capture_output=True).returncode:
    run(['docker','run','-d','--name',redis,'--network','sub2api-koko-c2','--memory','256m','redis:8.4-alpine'])

source = root/'source'
source.mkdir(exist_ok=True)
with tarfile.open(root/'source.tgz') as archive: archive.extractall(source,filter='data')
if (source/'frontend.tgz').exists():
    with tarfile.open(source/'frontend.tgz') as archive: archive.extractall(source/'backend/internal/web/dist',filter='data')
print('候选源码已解包',flush=True)
args = ['docker','run','--rm','--network','sub2api-koko-c2','--memory=5g','--cpus=2','-e','GOMAXPROCS=2','-e','GOGC=25','-e','GOMEMLIMIT=3GiB','-e','CGO_ENABLED=0','-e','KOKO_C2_FIXTURE=isolated-only','-v',str(out)+':/evidence','-v',str(source/'backend')+':/work','-v',str(source/'frontend')+':/frontend:ro','-v','sub2api-canvas-phase1-gomod:/go/pkg/mod','-v','sub2api-canvas-phase1-gocache:/root/.cache/go-build','-w','/work','golang:1.27.3-alpine']
commands = [
 ('format',['sh','-c','gofmt -w internal/service/video*.go internal/service/koko_video_provider.go internal/repository/video*.go internal/domain/platforms.go internal/domain/constants.go internal/domain/platforms_test.go internal/service/domain_constants.go']),
 ('unit',['go','test','-tags','unit','-p','1','-vet=off','./internal/domain','./internal/service','./internal/repository','./internal/handler','./internal/server/middleware','./internal/server/routes','-run','TestKoko|TestVideo|TestPlatform|TestFrontendBuiltinPlatformCatalog|TestGrokVideo|TestSeedance','-count=1']),
 ('integration',['go','test','-tags','integration,koko','-p','1','-vet=off','./internal/repository','-run','TestKoko','-count=1','-v']),
 ('build',['go','build','-p','1','-tags','embed','-ldflags','-s -w -X main.Version=6.6.6 -X main.Commit=video-studio-20261030 -X main.BuildType=release','-o','/evidence/sub2api','./cmd/server']),
]
results=[]
for name,cmd in commands:
    with (out/(name+'.log')).open('w') as f: p=subprocess.run(args+cmd,stdout=f,stderr=subprocess.STDOUT)
    results.append({'name':name,'exit_code':p.returncode})
    (out/'build-results.json').write_text(json.dumps(results),encoding='utf-8')
    print(name,p.returncode,flush=True)
    if p.returncode:
        print((out/(name+'.log')).read_text()[-5500:],flush=True)
        raise SystemExit(p.returncode)
dockerfile=out/'Dockerfile'
dockerfile.write_text('FROM sub2api-v11-prod:video-studio-rollback-20261030\nCOPY --chmod=755 sub2api /app/sub2api\nLABEL org.opencontainers.image.version="6.6.6"\n',encoding='utf-8')
with (out/'image.log').open('w') as f:
    subprocess.run(['docker','build','--network=none','--pull=false','-t','sub2api-v11-prod:video-studio-20261030-v666',str(out)],stdout=f,stderr=subprocess.STDOUT,check=True)
print('候选镜像已就绪',flush=True)
