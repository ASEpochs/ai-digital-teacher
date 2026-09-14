$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

$venvPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $venvPython)) {
    Write-Host '[1/4] 创建 Python 虚拟环境…' -ForegroundColor Cyan
    python -m venv .venv
}

Write-Host '[2/4] 安装后端依赖…' -ForegroundColor Cyan
& $venvPython -m pip install -r backend\requirements.txt

Write-Host '[3/4] 安装前端依赖…' -ForegroundColor Cyan
$npmCache = Join-Path $PSScriptRoot '.npm-cache'
npm install --cache $npmCache
npm --prefix frontend install --cache $npmCache

Write-Host '[4/4] 启动后端 http://localhost:8000 与前端 http://localhost:5173' -ForegroundColor Green
$env:Path = "$(Join-Path $PSScriptRoot '.venv\Scripts');$env:Path"
npm run dev
