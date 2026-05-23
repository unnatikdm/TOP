# Enterprise Agent Setup Script (Windows)

Write-Host "--- Enterprise Agent Setup ---" -ForegroundColor Cyan

# 1. Check for Coral
if (!(Get-Command coral -ErrorAction SilentlyContinue)) {
    Write-Host "Coral not found. Installing Coral..." -ForegroundColor Yellow
    # Note: On Windows, installation usually involves downloading a binary or using WSL.
    # We'll point the user to the website for now as there isn't a direct powershell installer mentioned.
    Write-Host "Please visit https://withcoral.com to download the Windows binary." -ForegroundColor Red
} else {
    Write-Host "Coral is already installed." -ForegroundColor Green
}

# 2. Setup Python environment
Write-Host "Setting up Python environment..." -ForegroundColor Cyan
pip install -r backend/requirements.txt

# 3. Setup Frontend
Write-Host "Setting up Frontend..." -ForegroundColor Cyan
cd frontend
npm install
cd ..

Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "To start the Mission Control Dashboard:" -ForegroundColor Cyan
Write-Host "1. In terminal 1: cd backend; python main.py"
Write-Host "2. In terminal 2: cd frontend; npm run dev"
Write-Host "3. Open browser at http://localhost:5173"
