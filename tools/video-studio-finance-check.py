"""核验唯一真实任务的测试钱包、Key 额度和结算流水，不发生成请求。"""
import json
import subprocess
from decimal import Decimal
from pathlib import Path
root=Path('/home/ubuntu/sub2api-video-studio-20261030')
task=json.loads((root/'real-task.json').read_text())
task_id=task['id']
assert task_id.startswith('vtsk_') and task_id.replace('_','').isalnum()
sql="""SELECT json_build_object('billing_state',f.state,'amount',f.amount::text,'user_balance',u.balance::text,'user_frozen',u.frozen_balance::text,'key_used',k.quota_used::text,'usage_count',(SELECT count(*) FROM usage_logs l WHERE l.video_task_id=t.public_id),'capture_events',(SELECT count(*) FROM video_billing_events e WHERE e.task_id=t.id AND e.operation='CAPTURE'),'actual_cost',(SELECT actual_cost::text FROM usage_logs l WHERE l.video_task_id=t.public_id)) FROM video_tasks t JOIN video_financial_reservations f ON f.task_id=t.id JOIN users u ON u.id=t.user_id JOIN api_keys k ON k.id=t.api_key_id WHERE t.public_id='"""+task_id+"'"
raw=subprocess.check_output(['docker','exec','sub2api-koko-c2-pg','psql','-U','postgres','-d','video_studio_20261030','-Atc',sql],stderr=subprocess.PIPE).decode().strip()
view=json.loads(raw)
assert view['billing_state']=='CAPTURED'
assert view['usage_count']==view['capture_events']==1
assert Decimal(view['amount'])==Decimal(view['actual_cost'])==Decimal(view['key_used'])==Decimal('8')
assert Decimal(view['user_frozen'])==0 and Decimal(view['user_balance'])==Decimal('92')
view['passed']=True
(root/'output/real-finance.json').write_text(json.dumps(view,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(view,ensure_ascii=False))
