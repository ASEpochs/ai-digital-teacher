$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    throw '未找到 .venv，请先运行 .\start.ps1 完成依赖安装。'
}

Write-Host '运行后端测试…' -ForegroundColor Cyan
& $venvPython -m pytest backend\tests
Write-Host '运行前端同步测试…' -ForegroundColor Cyan
npm --prefix frontend test
Write-Host '执行前端生产构建…' -ForegroundColor Cyan
npm --prefix frontend run build
Write-Host '全部验证通过。' -ForegroundColor Green

