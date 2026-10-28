"""仅清理迁移对象的目标鉴权、余额和 Key 用量缓存，不清空整库 Redis。"""
import argparse
import json
import os
from pathlib import Path
import subprocess

from newapi_migration import psql


def inspect(name):
    return json.loads(subprocess.check_output(['docker','inspect',name],stderr=subprocess.PIPE))[0]


def resp(parts):
    values=[str(part).encode('utf-8') for part in parts]
    result=b'*'+str(len(values)).encode()+b'\r\n'
    for value in values:
        result+=b'$'+str(len(value)).encode()+b'\r\n'+value+b'\r\n'
    return result


def invalidate(args):
    if not args.target_container.startswith('sub2api-') or not args.target_app.startswith('sub2api-') or not args.target_redis.startswith('sub2api-'):
        raise ValueError('只允许指定 sub2api 目标容器，禁止旧 newapi')
    app,db,redis=[inspect(name) for name in [args.target_app,args.target_container,args.target_redis]]
    env=dict(item.split('=',1) for item in app['Config']['Env'])
    if env.get('DATABASE_DBNAME')!=args.target_db or env.get('DATABASE_USER')!=args.target_user:
        raise ValueError('应用数据库配置与指定目标不一致')
    # 核对应用、数据库和 Redis 在同一网络，且主机名确实指向指定目标。
    def related(service,hostname):
        for network,settings in service['NetworkSettings']['Networks'].items():
            if network not in app['NetworkSettings']['Networks']:
                continue
            aliases=(settings.get('Aliases') or [])+(settings.get('DNSNames') or [])+[service['Name'].lstrip('/')]
            if hostname in aliases:
                return True
        return False
    if not related(db,env.get('DATABASE_HOST')) or not related(redis,env.get('REDIS_HOST')):
        raise ValueError('容器网络或目标主机名核对失败，拒绝清缓存')
    sql="""SELECT json_build_object(
      'users',(SELECT coalesce(json_agg(target_id),'[]') FROM newapi_migration_entities WHERE source_system='oracle-newapi-main' AND kind='user'),
      'keys',(SELECT coalesce(json_agg(json_build_object('id',k.id,'digest',encode(sha256(convert_to(k.key,'UTF8')),'hex'))),'[]')
              FROM newapi_migration_entities m JOIN api_keys k ON k.id=m.target_id WHERE m.source_system='oracle-newapi-main' AND m.kind='key'))"""
    data=json.loads(psql(args.target_container,args.target_user,args.target_db,sql,args.directory))
    commands=[]
    if env.get('REDIS_PASSWORD'):
        commands.append(['AUTH',env['REDIS_PASSWORD']])
    commands.append(['SELECT',int(env.get('REDIS_DB','0'))])
    cache_keys=['billing:balance:'+str(user) for user in data['users']]
    for key in data['keys']:
        cache_keys+=['apikey:rate:'+str(key['id']),'apikey:auth:'+key['digest']]
    if cache_keys:
        commands.append(['DEL']+cache_keys)
    for key in data['keys']:
        commands.append(['PUBLISH','auth:cache:invalidate',key['digest']])
    # 认证口令只通过 stdin 传递，不放到环境变量、命令行或日志。
    result=subprocess.run(['docker','exec','-i',args.target_redis,'redis-cli','--pipe'],
                          input=b''.join(resp(command) for command in commands),capture_output=True)
    if result.returncode or b'errors: 0' not in result.stdout:
        (args.directory/'private-cache-error.log').write_bytes(result.stdout+result.stderr)
        raise RuntimeError('目标缓存刷新失败，诊断保存在私有目录')
    report=dict(result='passed',migrated_users=len(data['users']),migrated_keys=len(data['keys']),
                scope='target migration objects only',whole_redis_flush=False)
    (args.directory/'cache-invalidation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report


if __name__=='__main__':
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--target-app',required=True)
    parser.add_argument('--target-redis',required=True)
    parser.add_argument('--target-container',default='sub2api-v11-prod-postgres')
    parser.add_argument('--target-user',default='sub2api_v11')
    parser.add_argument('--target-db',default='sub2api_v11')
    args=parser.parse_args()
    args.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    print(json.dumps(invalidate(args),ensure_ascii=False))
