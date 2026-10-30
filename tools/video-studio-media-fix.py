"""修复并验证视频媒体 CSP，重建候选站；只读取已完成视频。"""
import json
import subprocess
import tarfile
from pathlib import Path
root=Path('/home/ubuntu/sub2api-video-studio-20261030')
with tarfile.open(root/'media-csp.tgz') as archive:archive.extractall(root/'source',filter='data')
args=['docker','run','--rm','--memory=5g','--cpus=2','-e','GOMAXPROCS=2','-e','GOGC=25','-e','GOMEMLIMIT=3GiB','-v',str(root/'source/backend')+':/work','-v','sub2api-canvas-phase1-gomod:/go/pkg/mod','-v','sub2api-canvas-phase1-gocache:/root/.cache/go-build','-w','/work','golang:1.27.3-alpine']
commands=[('media-format',['gofmt','-w','internal/config/config.go','internal/server/middleware/security_headers.go','internal/server/middleware/video_media_csp_test.go']),('media-tests',['go','test','-tags','unit','-p','1','-vet=off','./internal/server/middleware','./internal/config','-run','TestVideo|TestSecurityHeaders|TestEnhanceCSPPolicy|Test.*CSP','-count=1'])]
results=[]
for name,cmd in commands:
 with (root/'output'/f'{name}.log').open('w') as file:p=subprocess.run(args+cmd,stdout=file,stderr=subprocess.STDOUT)
 results.append({'name':name,'exit_code':p.returncode});print(name,p.returncode,flush=True)
 if p.returncode:print((root/'output'/f'{name}.log').read_text()[-4000:]);raise SystemExit(p.returncode)
(root/'output/media-tests.json').write_text(json.dumps(results),encoding='utf-8')
subprocess.run(['python3','-u',str(root/'video-studio-build-final.py')],check=True)
subprocess.run(['python3','-u',str(root/'video-studio-start-test.py')],check=True)
