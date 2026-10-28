"""服务器侧固定只读对账；不导出用户、账号或供应商凭证。"""
import json
import subprocess


def run(args):
    """执行只读命令；异常禁止包含原始业务输出。"""
    result = subprocess.run(args, text=True, capture_output=True, timeout=45)
    if result.returncode:
        raise RuntimeError('只读对账命令失败')
    return result.stdout


def query(sql):
    """固定生产库只读事务，返回允许公开的计费字段。"""
    info = json.loads(run(['docker', 'inspect', 'sub2api-v11-prod-postgres']))[0]
    env = dict(item.split('=', 1) for item in info['Config']['Env'] if '=' in item)
    statement = 'BEGIN READ ONLY; SET LOCAL statement_timeout=5000; SELECT COALESCE(json_agg(x),\'[]\'::json) FROM (' + sql + ') x; ROLLBACK;'
    return json.loads(run(['docker', 'exec', 'sub2api-v11-prod-postgres', 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', env['POSTGRES_USER'], '-d', env['POSTGRES_DB'], '-c', statement]))


result = {}
result['balance'] = query('SELECT id,balance,frozen_balance FROM users WHERE id=2')
result['ops_errors'] = query("SELECT id,request_id,client_request_id,account_id,status_code,upstream_status_code,error_phase,error_type,created_at FROM ops_error_logs WHERE api_key_id=1 AND created_at > '2026-10-28T02:10:00Z' ORDER BY id")
result['usage'] = query('SELECT id,user_id,api_key_id,group_id,channel_id,account_id,request_id,upstream_request_id,requested_model,upstream_model,model,model_mapping_chain,inbound_endpoint,upstream_endpoint,billing_mode,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,image_count,image_size,total_cost,actual_cost,rate_multiplier,account_rate_multiplier,created_at FROM usage_logs WHERE user_id=2 AND id>174 ORDER BY id')
result['ops_schema'] = query("SELECT column_name FROM information_schema.columns WHERE table_name='ops_error_logs' ORDER BY ordinal_position")
# 只保留与本轮客户端标识相关的结构化调度日志，禁止输出原始请求及错误正文。
logs = subprocess.run(['docker', 'logs', '--since', '2026-10-28T02:10:00Z', 'sub2api-v11-prod-app'], text=True, capture_output=True, timeout=45)
events = []
allowed = {'time', 'ts', 'level', 'request_id', 'client_request_id', 'account_id', 'account_type', 'model', 'status', 'status_code', 'switch_count', 'max_switches', 'retry_count', 'retry_limit', 'upstream_request_id', 'path', 'method', 'latency', 'duration_ms'}
for line in (logs.stdout + logs.stderr).splitlines():
    if not any(token in line for token in ['creation-prod-', 'dea613db-19f7-4430-b57a-19845bddc88b', '/v1/chat/completions', '/v1/responses', '/v1/images/']):
        continue
    try:
        # 生产默认 console 编码在末尾附带 JSON 字段，与纯 JSON 编码均可只读解析。
        start = line.find('{')
        entry = json.loads(line[start:]) if start >= 0 else {}
        safe = {key: value for key, value in entry.items() if key in allowed}
        message = entry.get('msg', line[:start].split('\t')[-2] if start > 0 else '')
        if isinstance(message, str) and len(message) < 140 and all(c.isalnum() or c in '._ -' for c in message):
            safe['event'] = message
        events.append(safe)
    except ValueError:
        continue
result['events'] = events
print(json.dumps(result, ensure_ascii=False))
