"""在服务器恢复上一健康镜像；--original 恢复本次任务开始前镜像。"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

os.umask(0o077)

CURRENT = Path('/home/ubuntu/sub2api-creation-mainstream-release-20261028')
ORIGINAL = Path('/home/ubuntu/sub2api-creation-release-20261028')
COMPOSE = Path('/home/ubuntu/sub2api-v11-prod/compose.yaml')


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('回滚命令失败，未输出业务配置原文')
    return result.stdout


def main():
    """先核对配置摘要和目标镜像，避免覆盖发布后的其他改动。"""
    if any(value not in {'--original', '--check'} for value in sys.argv[1:]):
        raise RuntimeError('仅支持 --original、--check 参数')
    target = ORIGINAL if '--original' in sys.argv else CURRENT
    release = json.loads((CURRENT / 'output/deployment.json').read_text(encoding='utf8'))
    backup = (target / 'rollback/compose.yaml').read_bytes()
    current = COMPOSE.read_bytes()
    if current == backup:
        print('已经是目标 Compose，未重复重建容器。')
        return
    if hashlib.sha256(current).hexdigest() != release['compose_sha256_after']:
        raise RuntimeError('Compose 在发布后又被修改，拒绝覆盖；请先核对新改动')
    image = json.loads((target / 'rollback/image.json').read_text(encoding='utf8'))
    actual = json.loads(run(['docker', 'image', 'inspect', image['name']]))[0]
    if actual['Id'] != image['id']:
        raise RuntimeError('目标镜像标签已变化，拒绝使用未知镜像')
    if '--check' in sys.argv:
        print(json.dumps({'read_only_check': True, 'compose_unchanged_since_release': True, 'target_image': image['name'], 'target_image_id': image['id']}, ensure_ascii=False))
        return
    command = ['docker', 'compose', '--project-name', 'sub2api-v11-prod', '--file', str(COMPOSE)]
    COMPOSE.write_bytes(backup)
    try:
        run(command + ['config', '--quiet'])
        run(command + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'app'])
        for _ in range(45):
            info = json.loads(run(['docker', 'inspect', 'sub2api-v11-prod-app']))[0]
            if info['Image'] == image['id'] and info['State'].get('Health', {}).get('Status') == 'healthy':
                print('已恢复目标镜像并通过容器健康检查；数据库和 Redis 未重建。')
                return
            time.sleep(2)
        raise RuntimeError('目标镜像健康检查未通过，需要检查运行状态')
    except Exception:
        # 保留当前发布配置副本，后续排查仍可恢复本次发布。
        (CURRENT / 'output/compose.before-manual-rollback.yaml').write_bytes(current)
        COMPOSE.write_bytes(current)
        run(command + ['up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'app'])
        raise


if __name__ == '__main__':
    main()
