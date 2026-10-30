"""格式化本次改动的 Go 文件，导出供本地同步；不启动任何业务请求。"""
import json
import subprocess
import tarfile
from pathlib import Path
root=Path('/home/ubuntu/sub2api-video-studio-20261030')
names=['internal/domain/constants.go','internal/domain/platforms.go','internal/domain/platforms_test.go','internal/service/domain_constants.go','internal/service/account.go','internal/service/admin_group.go','internal/service/upstream_billing_probe.go','internal/service/koko_video_provider.go','internal/service/video_service.go','internal/service/video_models.go','internal/service/video_studio_test.go','internal/service/video_download.go','internal/repository/video_task_repo.go','internal/repository/video_quota_repo.go','internal/repository/video_integration_test.go','internal/server/routes/gateway.go','internal/server/middleware/video_platform.go','internal/server/middleware/video_platform_test.go','internal/service/platform_list_test.go']
subprocess.run(['docker','run','--rm','--network','none','--memory=256m','-v',str(root/'source/backend')+':/work','-w','/work','golang:1.27.3-alpine','gofmt','-w']+names,check=True)
with tarfile.open(root/'output/formatted-go.tgz','w:gz') as archive:
 for name in names:archive.add(root/'source/backend'/name,arcname='backend/'+name)
print(json.dumps({'formatted_files':len(names)}),flush=True)
