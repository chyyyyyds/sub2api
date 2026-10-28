"""只运行无网络、无生产挂载的临时容器，校验实际 Go 镜像静态路由。"""
import json
import re
import subprocess
import time

name = 'sub2api-canvas-phase1-final-smoke'
subprocess.run(['docker', 'run', '-d', '--name', name, '--network', 'none', 'sub2api-canvas-phase1:20261027'], check=True, stdout=subprocess.DEVNULL)

def request(path):
    result = subprocess.run(['docker', 'exec', name, 'wget', '-S', '-O', '-', 'http://127.0.0.1:8080' + path], capture_output=True, text=True)
    status = re.search(r'HTTP/1.1 (\d+)', result.stderr)
    return int(status.group(1)) if status else 0, result.stderr, result.stdout

try:
    for _ in range(20):
        if request('/canvas/image')[0] == 200:
            break
        time.sleep(0.5)
    checks = []
    status, headers, body = request('/canvas/image')
    assert status == 200 and 'X-Frame-Options: SAMEORIGIN' in headers
    assert "frame-ancestors 'self'" in headers and 'Cache-Control: no-store' in headers
    nonce = re.search(r"'nonce-([^']+)'", headers).group(1)
    assert f'<script nonce="{nonce}">' in body
    checks.append('Canvas HTML 独立路由、同源嵌入、nonce 与 no-store')
    asset = re.search(r'src="(/canvas/assets/[^\"]+\.js)"', body).group(1)
    status, headers, _ = request(asset)
    assert status == 200 and 'immutable' in headers
    checks.append('真实构建资源可访问且使用哈希缓存')
    for path in ['/canvas/video', '/canvas/config', '/canvas/assets/not-found.js']:
        assert request(path)[0] == 404
        checks.append(path + ' 返回404')
    status, headers, _ = request('/admin/dashboard')
    assert status == 200 and 'X-Frame-Options: DENY' in headers and "frame-ancestors 'none'" in headers
    checks.append('后台保持原有禁止嵌入策略')
    print(json.dumps({'passed': len(checks), 'checks': checks}, ensure_ascii=False))
finally:
    subprocess.run(['docker', 'rm', '-f', name], check=True, stdout=subprocess.DEVNULL)
