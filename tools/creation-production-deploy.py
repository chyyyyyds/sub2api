"""服务器侧制作候选镜像、隔离静态验收并安全切换；健康失败恢复原 Compose。"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request

os.umask(0o077)
ROOT = Path('/home/ubuntu/sub2api-creation-mainstream-release-20261028')
COMPOSE = Path('/home/ubuntu/sub2api-v11-prod/compose.yaml')
APP = 'sub2api-v11-prod-app'
TAG = 'sub2api-v11-prod:creation-mainstream-20261028-v666'
ROLLBACK = 'sub2api-v11-prod:creation-mainstream-rollback-20261028'


def run(args):
    """命令错误只返回受控提示，原始输出留在服务器受保护发布目录。"""
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('发布命令失败：' + args[0])
    return result.stdout.strip()


def inspect(name):
    return json.loads(run(['docker', 'inspect', name]))[0]


def fetch(path, public=False):
    origin = 'https://sub2api.chyyds.com' if public else 'http://127.0.0.1:18083'
    request = urllib.request.Request(origin + path, headers={'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache'})
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.status, dict(response.headers), response.read()


def snapshot_others():
    ids = run(['docker', 'ps', '-q']).split()
    return {item['Name']: (item['Id'], item['State']['StartedAt']) for item in json.loads(run(['docker', 'inspect'] + ids)) if item['Name'] != '/' + APP}


def main():
    """只替换应用镜像；不修改环境变量、持久卷、网络或其他服务。"""
    assert json.loads((ROOT / 'output/build-result.json').read_text())['exit_code'] == 0, '候选二进制未构建成功'
    go_results = json.loads((ROOT / 'output/go-results.json').read_text())['results']
    assert len(go_results) == 3 and all(item['exit_code'] == 0 and item['passed'] > 0 for item in go_results), 'Go 回归尚未全部通过'
    assert json.loads((ROOT / 'output/credential-scan.json').read_text())['complete_user_key_matches'] == [], '候选凭证扫描未通过'
    baseline = json.loads((ROOT / 'rollback/image.json').read_text())
    old = inspect(APP)
    assert old['Image'] == baseline['id'] and old['Config']['Image'] == baseline['name'], '生产镜像基线已变化'
    assert old['State']['Health']['Status'] == 'healthy'
    assert json.loads(fetch('/health')[2])['status'] == 'ok'
    original = COMPOSE.read_bytes()
    assert original == (ROOT / 'rollback/compose.yaml').read_bytes(), 'Compose 基线已变化'
    binary = ROOT / 'output/sub2api'
    binary_sha = hashlib.sha256(binary.read_bytes()).hexdigest()
    image_dir = ROOT / 'image'
    image_dir.mkdir(exist_ok=True)
    shutil.copy2(binary, image_dir / 'sub2api')
    shutil.copytree(ROOT / 'source-final/backend/resources', image_dir / 'resources', dirs_exist_ok=True)
    shutil.copy2(ROOT / 'source-final/canvas/LICENSE', image_dir / 'infinite-canvas-LICENSE')
    (image_dir / 'Dockerfile').write_text('FROM ' + ROLLBACK + '\nCOPY --chmod=755 sub2api /app/sub2api\nCOPY resources /app/resources\nCOPY infinite-canvas-LICENSE /app/licenses/infinite-canvas-LICENSE\nLABEL org.opencontainers.image.version="6.6.6" com.chyyds.creation.release="20261028"\n', encoding='utf8')
    build = subprocess.run(['docker', 'build', '--network=none', '--pull=false', '-t', TAG, str(image_dir)], capture_output=True, text=True)
    (ROOT / 'output/image-build.log').write_text(build.stdout + build.stderr, encoding='utf8')
    assert build.returncode == 0, '候选镜像构建失败'
    candidate = json.loads(run(['docker', 'image', 'inspect', TAG]))[0]
    assert candidate['Architecture'] == 'arm64' and candidate['Os'] == 'linux'
    version = run(['docker', 'run', '--rm', '--network', 'none', '--entrypoint', '/app/sub2api', TAG, '-version'])
    assert '6.6.6' in version and 'creation-20261028' in version
    dist = ROOT / 'source-final/backend/internal/web/dist'
    assets = {('/' + file.relative_to(dist).as_posix()): hashlib.sha256(file.read_bytes()).hexdigest() for file in dist.rglob('*') if file.is_file() and file.suffix in {'.js', '.css'} and '/assets/' in '/' + file.relative_to(dist).as_posix()}
    vue_html = (dist / 'index.html').read_text(encoding='utf8')
    canvas_html = (dist / 'canvas/index.html').read_text(encoding='utf8')
    entry = re.search(r'src="(/assets/[^\"]+\.js)"', vue_html).group(1)
    canvas_entry = re.search(r'src="(/canvas/assets/[^\"]+\.js)"', canvas_html).group(1)
    smoke = 'sub2api-creation-smoke-20261028'
    run(['docker', 'run', '--rm', '-d', '--name', smoke, '--network', 'none', '--read-only', '--memory', '512m', '--cpus', '1', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--tmpfs', '/app/data:rw', '--tmpfs', '/tmp:rw', '-e', 'SERVER_HOST=127.0.0.1', '-e', 'SERVER_PORT=8080', '--entrypoint', '/app/sub2api', TAG])
    smoke_checks = []
    try:
        for _ in range(30):
            ready = subprocess.run(['docker', 'exec', smoke, 'wget', '-q', '-T', '2', '-O', '-', 'http://127.0.0.1:8080/ai-creation/chat'], capture_output=True, text=True)
            if ready.returncode == 0 and entry in ready.stdout:
                break
            time.sleep(1)
        else:
            raise RuntimeError('无网络候选静态服务未启动')
        for path in ['/ai-creation/chat', '/ai-creation/image', '/admin/dashboard', '/login', '/dashboard', '/keys']:
            value = run(['docker', 'exec', smoke, 'wget', '-q', '-T', '5', '-O', '-', 'http://127.0.0.1:8080' + path])
            assert entry in value, path
            smoke_checks.append(path)
        result = subprocess.run(['docker', 'exec', smoke, 'wget', '-S', '-O', '-', 'http://127.0.0.1:8080/canvas/image'], capture_output=True, text=True)
        assert result.returncode == 0 and canvas_entry in result.stdout
        assert 'SAMEORIGIN' in result.stderr and "frame-ancestors 'self'" in result.stderr and 'no-store' in result.stderr
        smoke_checks.append('/canvas/image + CSP + no-store')
        for path, expected in assets.items():
            result = subprocess.run(['docker', 'exec', smoke, 'wget', '-q', '-T', '5', '-O', '-', 'http://127.0.0.1:8080' + path], capture_output=True)
            assert result.returncode == 0 and hashlib.sha256(result.stdout).hexdigest() == expected, path
        smoke_checks.append(str(len(assets)) + ' 个双前端资源逐项摘要校验')
    finally:
        subprocess.run(['docker', 'rm', '-f', smoke], capture_output=True)
    (ROOT / 'output/candidate-smoke.json').write_text(json.dumps({'image': TAG, 'architecture': 'arm64', 'binary_sha256': binary_sha, 'version': version, 'checks': smoke_checks, 'paid_requests': 0}, ensure_ascii=False, indent=2), encoding='utf8')
    before = snapshot_others()
    setting = 'image: ' + baseline['name']
    assert original.decode('utf8').count(setting) == 1
    updated = original.decode('utf8').replace(setting, 'image: ' + TAG)
    command = ['docker', 'compose', '--project-name', 'sub2api-v11-prod', '--file', str(COMPOSE)]
    try:
        assert inspect(APP)['Id'] == old['Id'] and COMPOSE.read_bytes() == original
        COMPOSE.write_text(updated, encoding='utf8')
        run(command + ['config', '--quiet'])
        run(command + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'app'])
        for _ in range(45):
            try:
                current = inspect(APP)
                if current['State'].get('Health', {}).get('Status') == 'healthy' and json.loads(fetch('/health')[2])['status'] == 'ok':
                    break
            except Exception:
                pass
            time.sleep(2)
        else:
            raise RuntimeError('切换后应用健康检查失败')
        assert current['Image'] == candidate['Id']
        assert sorted(current['Config']['Env']) == sorted(old['Config']['Env'])
        assert sorted(current['Mounts'], key=lambda item: item['Destination']) == sorted(old['Mounts'], key=lambda item: item['Destination'])
        assert set(current['NetworkSettings']['Networks']) == set(old['NetworkSettings']['Networks'])
        after = snapshot_others()
        assert all(after.get(name) == state for name, state in before.items()), '其他既有容器发生变化'
        assert run(['docker', 'exec', APP, 'sha256sum', '/app/sub2api']).split()[0] == binary_sha
        online = []
        # 新容器由 Nginx Docker DNS 重新解析；只重试无费用的健康 GET。
        for _ in range(15):
            try:
                if fetch('/health', True)[0] == 200:
                    break
            except Exception:
                pass
            time.sleep(2)
        else:
            raise RuntimeError('公网健康检查失败')
        for path in ['/', '/ai-creation/chat', '/ai-creation/image', '/dashboard', '/usage', '/keys', '/profile', '/admin/dashboard', '/login']:
            status, headers, body = fetch(path, True)
            assert status == 200 and entry in body.decode('utf8'), path
            online.append({'path': path, 'status': status, 'entry_matches': True, 'cf_cache_status': headers.get('cf-cache-status')})
        status, headers, body = fetch('/canvas/image', True)
        assert status == 200 and canvas_entry in body.decode('utf8') and headers.get('X-Frame-Options', headers.get('x-frame-options')) == 'SAMEORIGIN'
        online.append({'path': '/canvas/image', 'status': status, 'entry_matches': True})
        for path, expected in assets.items():
            status, _, value = fetch(path)
            assert status == 200 and hashlib.sha256(value).hexdigest() == expected, path
    except Exception:
        COMPOSE.write_bytes(original)
        run(command + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'app'])
        for _ in range(30):
            if inspect(APP)['State'].get('Health', {}).get('Status') == 'healthy':
                break
            time.sleep(2)
        (ROOT / 'output/rolled-back.json').write_text(json.dumps({'restored_image': baseline['name'], 'healthy': inspect(APP)['State'].get('Health', {}).get('Status') == 'healthy'}), encoding='utf8')
        raise
    result = {'version': '6.6.6', 'image': TAG, 'image_id': candidate['Id'], 'binary_sha256': binary_sha, 'health': 'healthy', 'assets_verified': len(assets), 'compose_sha256_before': hashlib.sha256(original).hexdigest(), 'compose_sha256_after': hashlib.sha256(COMPOSE.read_bytes()).hexdigest(), 'env_mounts_networks_preserved': True, 'other_existing_containers_unchanged': True, 'rollback_image': ROLLBACK, 'online': online, 'paid_requests': 0}
    (ROOT / 'output/deployment.json').write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf8')
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
