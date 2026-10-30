"""在已经通过后端测试的源码上嵌入最终前端，不改应用版本号。"""
import json
import subprocess
import tarfile
from pathlib import Path
root=Path('/home/ubuntu/sub2api-video-studio-20261030')
out=root/'output'
with tarfile.open(root/'frontend.tgz') as archive:archive.extractall(root/'source/backend/internal/web/dist',filter='data')
args=['docker','run','--rm','--memory=5g','--cpus=2','-e','GOMAXPROCS=2','-e','GOGC=25','-e','GOMEMLIMIT=3GiB','-e','CGO_ENABLED=0','-v',str(out)+':/evidence','-v',str(root/'source/backend')+':/work','-v','sub2api-canvas-phase1-gomod:/go/pkg/mod','-v','sub2api-canvas-phase1-gocache:/root/.cache/go-build','-w','/work','golang:1.27.3-alpine','go','build','-p','1','-tags','embed','-ldflags','-s -w -X main.Version=6.6.6 -X main.Commit=video-studio-20261030 -X main.BuildType=release','-o','/evidence/sub2api','./cmd/server']
with (out/'build-final.log').open('w') as f:p=subprocess.run(args,stdout=f,stderr=subprocess.STDOUT)
if p.returncode:print((out/'build-final.log').read_text()[-3500:]);raise SystemExit(p.returncode)
(out/'Dockerfile').write_text('FROM sub2api-v11-prod:video-studio-rollback-20261030\nCOPY --chmod=755 sub2api /app/sub2api\nLABEL org.opencontainers.image.version="6.6.6"\n',encoding='utf-8')
(out/'.dockerignore').write_text('*\n!sub2api\n!Dockerfile\n',encoding='utf-8')
with (out/'image-final.log').open('w') as f:subprocess.run(['docker','build','--network=none','--pull=false','-t','sub2api-v11-prod:video-studio-20261030-v666',str(out)],stdout=f,stderr=subprocess.STDOUT,check=True)
(out/'final-build.json').write_text(json.dumps({'exit_code':0,'version':'6.6.6'}),encoding='utf-8')
print('最终前端已嵌入，候选镜像构建成功',flush=True)
