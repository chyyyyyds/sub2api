"""对迁移批次逐条只读核对，报告中不输出用户名、邮箱、密码哈希或可用秘钥。"""
import argparse
from decimal import Decimal
import json
import os
from pathlib import Path

from newapi_migration import prepare, psql, SOURCE_SYSTEM


def verify(args):
    snapshot=json.loads(args.snapshot.read_text(encoding="utf-8"))
    entities, expected_summary=prepare(snapshot)
    sql="""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
'users',(SELECT coalesce(json_agg(json_build_object('source_id',m.source_id,'target_id',u.id,'email',u.email,
    'username',u.username,'password_hash',u.password_hash,'balance',u.balance::text,'role',u.role,'status',u.status,
    'login_username',l.username,'identity_user',a.user_id,'identity_source',a.metadata->>'source')),'[]')
    FROM newapi_migration_entities m JOIN users u ON u.id=m.target_id
    LEFT JOIN legacy_login_usernames l ON l.user_id=u.id
    LEFT JOIN auth_identities a ON a.provider_type='email' AND a.provider_key='email' AND a.provider_subject=lower(u.email)
    WHERE m.source_system='oracle-newapi-main' AND m.kind='user'),
'keys',(SELECT coalesce(json_agg(json_build_object('source_id',m.source_id,'target_id',k.id,'user_id',k.user_id,
    'key',k.key,'name',k.name,'group_id',k.group_id,'status',k.status,'quota',k.quota::text,'quota_used',k.quota_used::text,
    'expires_at',extract(epoch FROM k.expires_at)::bigint,'deleted',k.deleted_at IS NOT NULL)),'[]')
    FROM newapi_migration_entities m JOIN api_keys k ON k.id=m.target_id WHERE m.source_system='oracle-newapi-main' AND m.kind='key'),
'codes',(SELECT coalesce(json_agg(json_build_object('source_id',m.source_id,'target_id',c.id,'code',c.code,
    'value',c.value::text,'status',c.status,'used_by',c.used_by,'type',c.type,
    'used_at',extract(epoch FROM c.used_at)::bigint,'expires_at',extract(epoch FROM c.expires_at)::bigint)),'[]')
    FROM newapi_migration_entities m JOIN redeem_codes c ON c.id=m.target_id WHERE m.source_system='oracle-newapi-main' AND m.kind='code'),
'excluded_user_maps',(SELECT count(*) FROM newapi_migration_entities WHERE source_system='oracle-newapi-main' AND kind='user' AND source_id IN (1,2)),
'native_users',(SELECT count(*) FROM users u WHERE u.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM newapi_migration_entities m WHERE m.source_system='oracle-newapi-main' AND m.kind='user' AND m.target_id=u.id)),
'total_users',(SELECT count(*) FROM users WHERE deleted_at IS NULL),
'total_keys',(SELECT count(*) FROM api_keys WHERE deleted_at IS NULL),
'total_codes',(SELECT count(*) FROM redeem_codes));
COMMIT;
"""
    actual=json.loads(psql(args.target_container,args.target_user,args.target_db,sql,args.directory))
    users={row['source_id']:row for row in actual['users']}
    targets={sid:row['target_id'] for sid,row in users.items()}
    keys={row['source_id']:row for row in actual['keys']}
    codes={row['source_id']:row for row in actual['codes']}
    if len(users)!=expected_summary['users'] or len(keys)!=expected_summary['keys'] or len(codes)!=expected_summary['codes']:
        raise RuntimeError('迁移对象数量不一致')
    if actual['excluded_user_maps']:
        raise RuntimeError('排除账号出现了迁移映射')
    for entity in entities:
        row=entity['payload']
        if entity['kind']=='user':
            target=users[row['source_id']]
            for field in ['email','username','password_hash','status']:
                if row[field]!=target[field]: raise RuntimeError('用户字段不一致：'+field)
            if Decimal(row['balance'])!=Decimal(target['balance']): raise RuntimeError('用户余额不一致')
            if target['role']!='user' or target['login_username']!=row['username'] or target['identity_user']!=target['target_id'] or target['identity_source']!='newapi_migration':
                raise RuntimeError('用户登录映射或权限异常')
        elif entity['kind']=='key':
            target=keys[row['source_id']]
            for field in ['key','name','group_id','status']:
                if row[field]!=target[field]: raise RuntimeError('Key 字段不一致：'+field)
            if target['deleted'] or target['user_id']!=targets[row['user_source_id']]: raise RuntimeError('Key 归属异常')
            for field in ['quota','quota_used']:
                if Decimal(row[field])!=Decimal(target[field]): raise RuntimeError('Key 配额不一致')
            expiry=row['expires_at'] if row['expires_at']>0 else None
            if target['expires_at']!=expiry: raise RuntimeError('Key 过期时间不一致')
        else:
            target=codes[row['source_id']]
            for field in ['code','status']:
                if row[field]!=target[field]: raise RuntimeError('兑换码字段不一致：'+field)
            if Decimal(row['value'])!=Decimal(target['value']) or target['type']!='balance': raise RuntimeError('兑换码金额或类型不一致')
            if target['used_by']!=targets.get(row['user_source_id']): raise RuntimeError('兑换码兑换人对应关系异常')
            for field in ['used_at','expires_at']:
                expected=row[field] if row[field]>0 else None
                if target[field]!=expected: raise RuntimeError('兑换码时间不一致：'+field)
    report=dict(result='passed',source_system=SOURCE_SYSTEM,snapshot_at=snapshot['snapshot_at'],
                checked_users=len(users),password_hashes_preserved=len(users),username_logins_preserved=len(users),
                checked_keys=len(keys),checked_codes=len(codes),excluded_accounts_absent=True,
                user_balance_total=expected_summary['user_balance_total'],unused_code_value_total=expected_summary['unused_code_value_total'],
                native_users=actual['native_users'],total_users=actual['total_users'],total_keys=actual['total_keys'],total_codes=actual['total_codes'])
    (args.directory/'verification-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return report


if __name__=='__main__':
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot',type=Path,required=True)
    parser.add_argument('--directory',type=Path,required=True)
    parser.add_argument('--target-container',default='sub2api-v11-prod-postgres')
    parser.add_argument('--target-user',default='sub2api_v11')
    parser.add_argument('--target-db',default='sub2api_v11')
    args=parser.parse_args()
    args.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
    print(json.dumps(verify(args),ensure_ascii=False))
