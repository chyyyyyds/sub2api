"""P3-A 只读核对；仅允许固定 GET 和只读 SQL，没有收费请求解锁入口。"""
import json
import os
from pathlib import Path
import subprocess


# 中文说明：凭证只在服务器进程内读取，不传回本机，不写入证据。
REMOTE = r'''
import json, subprocess, urllib.request, urllib.error, datetime

def run(args):
    p = subprocess.run(args, text=True, capture_output=True, timeout=30)
    if p.returncode:
        raise RuntimeError('只读命令失败：' + args[0])
    return p.stdout

def query(db, sql):
    # 中文说明：固定只读事务，禁止执行传入参数或外部文件中的 SQL。
    d = json.loads(run(['docker', 'inspect', db]))[0]
    env = dict(e.split('=', 1) for e in d['Config']['Env'] if '=' in e)
    transaction = "BEGIN READ ONLY; SET LOCAL statement_timeout=5000; SELECT COALESCE(json_agg(x),'[]'::json) FROM (" + sql + ") x; ROLLBACK;"
    return json.loads(run(['docker','exec',db,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',env['POSTGRES_USER'],'-d',env['POSTGRES_DB'],'-c',transaction]))

out = {'checked_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'paid_requests_allowed': False}
for db in ['sub2api-v11-prod-postgres', 'sub2api-stage7-postgres']:
    stage = db == 'sub2api-stage7-postgres'
    data = {}
    data['users'] = query(db, 'SELECT id,role,status,balance,frozen_balance,concurrency,deleted_at IS NOT NULL AS deleted FROM users WHERE id=2 OR id IN (27,29) ORDER BY id')
    data['keys'] = query(db, 'SELECT id,user_id,group_id,status,quota,quota_used,expires_at,rate_limit_5h,rate_limit_1d,rate_limit_7d,usage_5h,usage_1d,usage_7d,ip_whitelist,ip_blacklist,deleted_at IS NOT NULL AS deleted FROM api_keys WHERE user_id=2 OR user_id IN (27,29) ORDER BY id')
    data['groups'] = query(db, 'SELECT id,name,platform,status,rate_multiplier,image_rate_independent,image_rate_multiplier,image_price_1k,image_price_2k,image_price_4k,allow_image_generation,model_allowlist,claude_code_only,allow_messages_dispatch,default_mapped_model,messages_dispatch_model_config,model_routing_enabled,model_routing,fallback_group_id,fallback_group_id_on_invalid_request,peak_rate_enabled,peak_start,peak_end,peak_rate_multiplier,max_reasoning_effort,reasoning_effort_mappings,model_pricing FROM groups WHERE deleted_at IS NULL ORDER BY id')
    data['channels'] = query(db, 'SELECT c.id,c.name,c.status,c.model_mapping,c.billing_model_source,c.restrict_models,(SELECT json_agg(group_id) FROM channel_groups WHERE channel_id=c.id) AS groups FROM channels c ORDER BY id')
    data['accounts'] = query(db, "SELECT a.id,a.platform,a.type,a.status,a.schedulable,a.rate_multiplier,a.concurrency,a.expires_at,a.rate_limit_reset_at,a.overload_until,a.temp_unschedulable_until,a.error_message IS NOT NULL AND a.error_message<>'' AS has_error,credentials->'model_mapping' AS model_mapping,credentials->'api_protocol' AS api_protocol,credentials->'protocol_rules' AS protocol_rules,credentials->'pool_mode' AS pool_mode,credentials->'pool_mode_retry_count' AS pool_mode_retry_count,extra->'openai_responses_supported' AS responses_supported,extra->'openai_responses_mode' AS responses_mode,extra->'openai_long_context_billing_enabled' AS long_context_billing,(SELECT json_agg(group_id) FROM account_groups WHERE account_id=a.id) AS groups FROM accounts a WHERE a.deleted_at IS NULL ORDER BY id")
    data['user_rates'] = query(db, 'SELECT * FROM user_group_rate_multipliers WHERE user_id=2')
    data['pricing_schema'] = query(db, "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('channel_model_pricing','channel_pricing_intervals','billing_usage_entries') ORDER BY table_name,ordinal_position")
    data['channel_prices'] = query(db, 'SELECT * FROM channel_model_pricing ORDER BY id')
    data['channel_intervals'] = query(db, 'SELECT * FROM channel_pricing_intervals ORDER BY id')
    data['history'] = query(db, "SELECT id,api_key_id,account_id,channel_id,request_id,requested_model,upstream_model,model,rate_multiplier,total_cost,actual_cost,input_tokens,output_tokens,image_count,billing_mode,inbound_endpoint,upstream_endpoint,created_at FROM usage_logs WHERE user_id=2 ORDER BY id DESC LIMIT 12")
    data['fallback_settings'] = query(db, "SELECT key,value FROM settings WHERE key IN ('enable_model_fallback','fallback_model_openai','fallback_model_anthropic')")
    out[db] = data

# 中文说明：只向既有 Sub2API 用户网关发 GET，不访问供应商，也不发送任何 POST。
secret_rows = query('sub2api-v11-prod-postgres', 'SELECT key FROM api_keys WHERE id=1 AND user_id=2 AND deleted_at IS NULL')
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None
opener = urllib.request.build_opener(NoRedirect())
catalog = []
for path in ['/v1/models', '/v1/sub2api/billing']:
    req = urllib.request.Request('http://127.0.0.1:18083'+path, method='GET', headers={'Authorization':'Bearer '+secret_rows[0]['key']})
    try:
        with opener.open(req, timeout=20) as response:
            value = json.load(response)
            if path == '/v1/models':
                catalog = [m['id'] for m in value.get('data', [])]
                value = {'models': catalog}
            else:
                # 中文说明：余额接口仅保留已知的非敏感费用字段。
                value = {k:v for k,v in value.items() if k in ['object','schema_version','billing_scope','group_rate_multiplier','user_rate_multiplier','resolved_rate_multiplier','peak_rate_enabled','effective_rate_multiplier','observed_at']}
                if 'data' in value and isinstance(value['data'], dict):
                    value['data'] = {k:v for k,v in value['data'].items() if k in ['balance','quota','quota_used','quota_remaining','expires_at','rate_multiplier','group_name','status']}
            out[path] = {'status':response.status, 'result':value}
    except urllib.error.HTTPError as error:
        out[path] = {'status':error.code}
del secret_rows

models = set(catalog) | {'gpt-image-2','gpt-4o-mini','gpt-5.3-codex','gpt-6-sol','gpt-5.6-terra'}
for app in ['sub2api-v11-prod-app','sub2api-stage7-test-app']:
    data = {}
    for filename in ['model_pricing.json','model_pricing_overrides.json']:
        try:
            pricing = json.loads(run(['docker','exec',app,'cat','/app/data/'+filename]))
            data[filename] = {k:v for k,v in pricing.items() if k in models}
        except Exception:
            data[filename] = {'unavailable': True}
    d = json.loads(run(['docker','inspect',app]))[0]
    env = dict(e.split('=',1) for e in d['Config']['Env'] if '=' in e)
    data['safe_env'] = {k:v for k,v in env.items() if k.startswith(('GATEWAY_','VITE_CREATION_','TOKEN_REFRESH_'))}
    out[app] = data
print(json.dumps(out, ensure_ascii=False))
'''


def main():
    """固定参数只读核对；返回值只写入脱敏 JSON 证据。"""
    root = Path(__file__).resolve().parents[1]
    evidence = root / '.codex' / 'creation-p3a-evidence'
    evidence.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-i',
         str(Path(os.environ['USERPROFILE']) / 'Desktop' / 'ssh-key-2026-08-08.key'),
         'ubuntu@100.65.138.78', 'python3', '-'],
        input=REMOTE, text=True, encoding='utf-8', capture_output=True, timeout=180,
    )
    if result.returncode:
        raise SystemExit('只读核对失败；未输出服务器异常原文，避免凭证泄漏。')
    data = json.loads(result.stdout)
    (evidence / 'readonly-snapshot.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    print('只读核对完成；收费请求数量 0；脱敏证据：' + str(evidence / 'readonly-snapshot.json'))


if __name__ == '__main__':
    main()
