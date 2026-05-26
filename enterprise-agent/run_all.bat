@echo off
pushd "%~dp0\backend"
start "" python main.py
popd
pushd "%~dp0\frontend"
npm install
start "" npm run dev
popd
