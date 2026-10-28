"""在无网络、无业务数据挂载的 Go 1.27.3 容器验证当前后端源码。"""
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import tarfile


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / '.codex' / 'creation-p3a-evidence'
SSH = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-i',
       str(Path(os.environ['USERPROFILE']) / 'Desktop' / 'ssh-key-2026-08-08.key'),
       'ubuntu@100.65.138.78']


def main():
    """只上传代码副本；容器禁止外网和真实数据库访问，不执行集成测试。"""
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    archive = EVIDENCE / 'backend-source.tar.gz'
    manifest = {}
    source_files = []
    for directory, folders, files in os.walk(ROOT / 'backend'):
        folders[:] = [f for f in folders if f not in {'target','bin','obj','.idea','.git','node_modules','data','dist'}]
        for name in files:
            file = Path(directory) / name
            if file.suffix not in {'.go','.mod','.sum','.sql','.json','.html','.txt'} and name != 'VERSION':
                continue
            relative = file.relative_to(ROOT / 'backend').as_posix()
            manifest[relative] = hashlib.sha256(file.read_bytes()).hexdigest()
            source_files.append((file, relative))
    old_manifest = EVIDENCE / 'go-source-manifest.json'
    reuse = archive.exists() and old_manifest.exists() and json.loads(old_manifest.read_text(encoding='utf-8')) == manifest
    if not reuse:
        with tarfile.open(archive, 'w:gz') as bundle:
            for file, relative in source_files:
                bundle.add(file, arcname=relative)
    source_id = hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()[:12]
    remote = '/home/ubuntu/sub2api-p3a-isolated-' + source_id
    (EVIDENCE / 'go-source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    subprocess.run(SSH + ['mkdir -p ' + remote + '/backend'],check=True,timeout=30)
    expected_hash = hashlib.sha256(archive.read_bytes()).hexdigest()
    check = subprocess.run(SSH + ['sha256sum '+remote+'/backend-source.tar.gz'],text=True,capture_output=True,timeout=30)
    if not check.stdout.split() or check.stdout.split()[0] != expected_hash:
        print('上传当前源码副本：' + str(archive.stat().st_size) + ' 字节',flush=True)
        scp = ['scp','-q','-o','BatchMode=yes','-o','ConnectTimeout=10','-i',SSH[-2],str(archive),'ubuntu@100.65.138.78:'+remote+'/backend-source.tar.gz']
        subprocess.run(scp,check=True,timeout=300)
    actual_hash = subprocess.check_output(SSH + ['sha256sum '+remote+'/backend-source.tar.gz'],text=True,timeout=30).split()[0]
    if actual_hash != expected_hash:
        raise SystemExit('源码归档摘要不一致，停止测试。')
    subprocess.run(SSH + ['tar -xzf '+remote+'/backend-source.tar.gz -C '+remote+'/backend'],check=True,timeout=60)
    module_volume = 'sub2api-p3a-gomod-' + source_id
    seed = ['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL',
            '--security-opt','no-new-privileges','-v','sub2api-canvas-phase1-gomod:/seed:ro',
            '-v',module_volume+':/modules','golang:1.27.3-alpine','cp','-an','/seed/.','/modules/']
    subprocess.run(SSH+[shlex.join(seed)],check=True,timeout=120)
    # 中文说明：联网容器只下载并校验go.mod/go.sum中的依赖，不执行测试，不加载任何业务凭证。
    download = ['docker','run','--rm','--network','bridge','--read-only','--cap-drop','ALL',
                '--security-opt','no-new-privileges','--memory','1g','--cpus','1',
                '--tmpfs','/tmp:rw,size=256m','-v',remote+'/backend:/work:ro',
                '-v',module_volume+':/go/pkg/mod','-w','/work','-e','GOTOOLCHAIN=local',
                '-e','GOPROXY=https://proxy.golang.org','-e','GOSUMDB=sum.golang.org',
                'golang:1.27.3-alpine','go','mod','download']
    print('独立模块缓存：仅下载依赖，随后断网执行测试。',flush=True)
    with (EVIDENCE/'go-dependencies.log').open('w',encoding='utf-8') as log:
        deps = subprocess.run(SSH+[shlex.join(download)],stdout=log,stderr=subprocess.STDOUT,timeout=600)
    if deps.returncode:
        raise SystemExit('独立依赖准备失败，测试仍阻塞；查看go-dependencies.log。')
    # 中文说明：模块缓存只读复用；编译缓存和临时文件写入独立卷，禁止挂载数据库与 Docker socket。
    command = [
        'docker','run','--rm','--network','none','--read-only','--cap-drop','ALL',
        '--security-opt','no-new-privileges','--memory','4g','--cpus','2','--pids-limit','256',
        '--tmpfs','/tmp:rw,exec,size=512m',
        '-v',remote+'/backend:/work:ro',
        '-v',module_volume+':/go/pkg/mod:ro',
        '-v','sub2api-p3a-gocache-'+source_id+':/go-cache',
        '-v','sub2api-p3a-gowork-'+source_id+':/go-work',
        '-w','/work','-e','GOTOOLCHAIN=local','-e','GOPROXY=off','-e','GOSUMDB=off',
        '-e','GOCACHE=/go-cache','-e','GOTMPDIR=/go-work','-e','TMPDIR=/go-work',
        '-e','GOMAXPROCS=2','-e','GOMEMLIMIT=2500MiB','-e','GOGC=50','-e','CGO_ENABLED=0',
        'golang:1.27.3-alpine','go','test','-json','-mod=readonly','-tags=unit','-p=1','-parallel=2','-count=1','-timeout=180s',
    ]
    cases = [
        ('apicompat', ['./internal/pkg/apicompat']),
        ('service', ['-run','^(TestResolveUpstreamProtocol|TestParseModelProtocolCatalog|TestDetectOpenAIImageResultSize|TestCodexDirectImagesPricingAndUsage|TestCalculateImageCost.*|TestModelProtocolCatalog.*|TestProtocolRulesWithProtocolSets)$','./internal/service']),
        ('billing-handler', ['-run','^(TestGatewayHandlerKeyBillingInfo.*|TestBuildKeyBillingInfo.*|TestKeyBillingInfoJSON.*)$','./internal/handler']),
    ]
    results = []
    previous_path = EVIDENCE/'go-results.json'
    previous = json.loads(previous_path.read_text(encoding='utf-8')) if previous_path.exists() else {}
    for label, args in cases:
        if previous.get('source_id') == source_id and any(r['suite']==label and r['exit_code']==0 for r in previous.get('results',[])):
            results.append({'suite':label,'exit_code':0,'reused_verified_same_source':True})
            continue
        with (EVIDENCE / ('go-'+label+'.log')).open('w',encoding='utf-8') as log:
            # 中文说明：SSH 会经远端 shell 解析命令，正则必须按 POSIX shell 安全引用。
            process = subprocess.run(SSH + [shlex.join(command + args)], stdout=log, stderr=subprocess.STDOUT, text=True, encoding='utf-8', timeout=1200)
        results.append({'suite':label,'exit_code':process.returncode})
        print(label + ' exit=' + str(process.returncode), flush=True)
        if process.returncode:
            # 中文说明：首组阻塞即停止，不重复编译同一依赖，也不自动提高容器资源限制。
            remaining = [name for name, _ in cases if name not in {r['suite'] for r in results}]
            results.extend({'suite':name,'exit_code':None,'status':'blocked_after_prior_failure'} for name in remaining)
            break
    (EVIDENCE / 'go-results.json').write_text(json.dumps({'source_id':source_id,'remote_source':remote,'files':len(manifest),'isolation':'network=none; source/module-cache readonly; no DB/socket/credentials; unit tag only','results':results},ensure_ascii=False,indent=2),encoding='utf-8')
    (EVIDENCE / 'go-source-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')


if __name__ == '__main__':
    main()
