# 仅供隔离验收进程通过匿名管道读取现有密码；不得直接在终端运行。
$path = Join-Path $env:USERPROFILE '.codex\credentials\sub2api-creation-production-password.dpapi'
$secure = ConvertTo-SecureString -String ([IO.File]::ReadAllText($path, [Text.Encoding]::UTF8))
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
